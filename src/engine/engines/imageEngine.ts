import * as Comlink from "comlink";
import { createWorkerHost } from "../workerHost";
import { FORMATS, type FormatId } from "../formats";
import { ConversionError, type ConvertOptions, type Engine, type ProgressUpdate } from "../types";
import type { ImagesWorkerApi } from "../workers/images.worker";

/**
 * Image engine — decode to pixels, optionally resize, re-encode.
 *
 * One worker is created lazily and reused. Spawning per job would re-download
 * and re-instantiate every wasm codec each time, which on a 50-file batch is the
 * difference between seconds and minutes.
 */

const host = createWorkerHost<ImagesWorkerApi>(
  () =>
    new Worker(new URL("../workers/images.worker.ts", import.meta.url), {
      type: "module",
      name: "onhand-images",
    }),
  "image",
);

/** Drop the worker so a crashed instance doesn't poison every later job. */
export function resetImageWorker(): void {
  host.reset();
}

/**
 * Buffer-level conversion, for engines that need pixels re-encoded mid-pipeline.
 *
 * The PDF engine uses this: pdf.js renders pages to PNG, and if the user asked
 * for JPEG or WebP those pages come back through here. Sharing the one worker
 * means the PDF path never grows a second, drifting copy of the encoders.
 */
export async function convertImageBuffer(
  buffer: ArrayBuffer,
  source: FormatId,
  target: FormatId,
  mime: string,
  options: ConvertOptions,
): Promise<ArrayBuffer> {
  return host.call((api) =>
    api.convert(Comlink.transfer(buffer, [buffer]), source, target, mime, options),
  );
}

/**
 * An absolute ceiling on a single image conversion.
 *
 * Unlike video, an image job has no intermediate progress to watch — the codecs
 * are one-shot, so there is no silence to detect, only elapsed time. And unlike
 * video, the work is genuinely bounded: the memory guardrail already refuses
 * anything over ~90 MB, and decoding plus re-encoding that much never
 * approaches two minutes on hardware from this decade.
 *
 * This matters more since the queue runs a fixed number of jobs at once. Before
 * that, a job that never settled blocked only itself; now it holds a pool slot,
 * so everything queued behind it waits too. Bounding it means one stuck file
 * costs one failure rather than the rest of the batch.
 */
const IMAGE_DEADLINE_MS = 120_000;

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`image conversion exceeded ${ms / 1000}s`)), ms);
    }),
  ]).finally(() => clearTimeout(timer)) as Promise<T>;
}

const IMAGE_SOURCES: ReadonlySet<FormatId> = new Set([
  "jpeg",
  "png",
  "webp",
  "avif",
  "heic",
  "gif",
  "bmp",
  "ico",
  "svg",
  "tiff",
]);

const IMAGE_TARGETS: ReadonlySet<FormatId> = new Set(["jpeg", "png", "webp", "avif"]);

export const imageEngine: Engine = {
  id: "images",
  cost: 1,

  canHandle(source, target) {
    return IMAGE_SOURCES.has(source) && IMAGE_TARGETS.has(target);
  },

  async convert(
    file: File,
    source: FormatId,
    target: FormatId,
    options: ConvertOptions,
    onProgress: (u: ProgressUpdate) => void,
    signal?: AbortSignal,
  ): Promise<{ blob: Blob }> {
    if (signal?.aborted) throw new ConversionError("internal", "Cancelled");

    // Image codecs are one-shot: they give no intermediate progress, so we report
    // indeterminate rather than inventing a percentage that creeps convincingly.
    // Fake progress bars are one of the dark patterns named on /why.
    onProgress({ progress: null });

    const buffer = await file.arrayBuffer();

    try {
      const out = await withDeadline(
        host.call((api) =>
          api.convert(
            Comlink.transfer(buffer, [buffer]),
            source,
            target,
            file.type || FORMATS[source].mime,
            options,
          ),
        ),
        IMAGE_DEADLINE_MS,
      );
      onProgress({ progress: 1 });
      return { blob: new Blob([out], { type: FORMATS[target].mime }) };
    } catch (cause) {
      // Deliberately NOT resetting the worker here.
      //
      // The worker is shared across concurrent jobs. Terminating it because ONE
      // file failed to decode kills every conversion running alongside it — and
      // those calls never settle, so a batch containing a single corrupt file
      // hangs forever rather than reporting one failure. Measured: a 5-file
      // batch with 2 corrupt files timed out at 60s instead of finishing in
      // under a second with 3 successes.
      //
      // A codec throwing on bad input is normal and leaves the worker perfectly
      // healthy. Only a genuine worker-level failure warrants a reset, and that
      // is handled by the worker's own error handler in getWorker().
      const message = cause instanceof Error ? cause.message : String(cause);

      if (/exceeded \d+s/.test(message)) {
        throw new ConversionError(
          "internal",
          `Converting this ${FORMATS[source].label} took too long and was stopped.`,
          {
            suggestion: "Try it on its own, or reduce the dimensions first.",
            cause,
          },
        );
      }
      if (/no decoder|could not be rasterised|held no image/i.test(message)) {
        throw new ConversionError(
          "corrupt",
          `This ${FORMATS[source].label} file could not be read.`,
          {
            suggestion: "It may be damaged, or use a variant we don't support yet.",
            cause,
          },
        );
      }
      if (/memory|allocation|out of bounds/i.test(message)) {
        throw new ConversionError(
          "too-large",
          "This image is too large to convert in the browser.",
          {
            suggestion: "Try reducing the dimensions first, or use a smaller source file.",
            cause,
          },
        );
      }
      throw new ConversionError(
        "internal",
        `Converting ${FORMATS[source].label} to ${FORMATS[target].label} failed.`,
        { cause },
      );
    }
  },
};

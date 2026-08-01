import * as Comlink from "comlink";
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

let workerHandle: { worker: Worker; api: Comlink.Remote<ImagesWorkerApi> } | null = null;

function getWorker() {
  if (!workerHandle) {
    const worker = new Worker(new URL("../workers/images.worker.ts", import.meta.url), {
      type: "module",
      name: "onhand-images",
    });
    // A worker-level failure (OOM kill, module load error) is the ONLY case that
    // justifies discarding the instance. Per-file decode errors must not, since
    // the worker is shared and terminating it strands every concurrent job.
    worker.addEventListener("error", () => {
      if (workerHandle?.worker === worker) workerHandle = null;
      worker.terminate();
    });
    workerHandle = { worker, api: Comlink.wrap<ImagesWorkerApi>(worker) };
  }
  return workerHandle;
}

/** Drop the worker so a crashed instance doesn't poison every later job. */
export function resetImageWorker(): void {
  workerHandle?.worker.terminate();
  workerHandle = null;
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
  const { api } = getWorker();
  return api.convert(Comlink.transfer(buffer, [buffer]), source, target, mime, options);
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
    const { api } = getWorker();

    try {
      const out = await api.convert(
        Comlink.transfer(buffer, [buffer]),
        source,
        target,
        file.type || FORMATS[source].mime,
        options,
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
        throw new ConversionError("too-large", "This image is too large to convert in the browser.", {
          suggestion: "Try reducing the dimensions first, or use a smaller source file.",
          cause,
        });
      }
      throw new ConversionError(
        "internal",
        `Converting ${FORMATS[source].label} to ${FORMATS[target].label} failed.`,
        { cause },
      );
    }
  },
};

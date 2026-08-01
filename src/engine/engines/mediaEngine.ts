import * as Comlink from "comlink";
import { createWorkerHost } from "../workerHost";
import { FORMATS, isAudioExtraction, type FormatId } from "../formats";
import { ConversionError, type ConvertOptions, type Engine, type ProgressUpdate } from "../types";
import type { MediaWorkerApi } from "../workers/media.worker";

/**
 * Audio and video via WebCodecs.
 *
 * Preferred over ffmpeg wherever it works: it uses the browser's own codecs
 * (usually hardware-accelerated), needs no 32 MB download, and gives real
 * progress. It cannot do everything — no browser encodes MP3 or Vorbis, and
 * Firefox has no AAC encoder — so the broker falls through to ffmpeg when this
 * engine says the job isn't its.
 */

const host = createWorkerHost<MediaWorkerApi>(
  () =>
    new Worker(new URL("../workers/media.worker.ts", import.meta.url), {
      type: "module",
      name: "onhand-media",
    }),
  "media",
);

export function resetMediaWorker(): void {
  host.reset();
}

const AV_KINDS = new Set(["audio", "video"]);

export const mediaEngine: Engine = {
  id: "webcodecs",
  // Cheaper than ffmpeg by a wide margin, so the broker tries it first.
  cost: 2,

  canHandle(source, target) {
    const from = FORMATS[source].kind;
    const to = FORMATS[target].kind;
    if (!AV_KINDS.has(from)) return false;
    // Same-kind conversions, plus pulling the audio out of a video. Video from
    // audio is not a thing, and image frames out of video belong to P3.
    return from === to || isAudioExtraction(source, target);
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

    const jobId = crypto.randomUUID();

    // Extraction is the one pair where dropping the video track is the intent
    // rather than a loss, so it is set here instead of relying on the caller.
    const effective: ConvertOptions = isAudioExtraction(source, target)
      ? { ...options, audioOnly: true }
      : options;

    const onAbort = () => void host.call((api) => api.cancel(jobId));
    signal?.addEventListener("abort", onAbort, { once: true });

    onProgress({ progress: 0 });

    try {
      const { buffer } = await host.call((api) =>
        api.convert(
          file,
          target,
          effective,
          jobId,
          Comlink.proxy((p: number | null) => onProgress({ progress: p })),
        ),
      );
      onProgress({ progress: 1 });
      return { blob: new Blob([buffer], { type: FORMATS[target].mime }) };
    } catch (cause) {
      const err = cause as { name?: string; message?: string };
      const message = err?.message ?? String(cause);

      // "Not my job" is a routing signal, not a failure. It must stay a kind
      // the broker falls through on — throwing `unsupported` here would stop
      // the search and deny the user a conversion ffmpeg can do easily.
      if (err?.name === "NotMyJobError") {
        throw new ConversionError("internal", `WebCodecs cannot do this pair: ${message}`);
      }
      if (/cancelled/i.test(message)) {
        throw new ConversionError("internal", "Cancelled");
      }
      if (/memory|allocation|out of bounds/i.test(message)) {
        throw new ConversionError(
          "too-large",
          "This file is too large to convert in the browser.",
          {
            suggestion: "Try trimming it to a shorter section first.",
            cause,
          },
        );
      }
      // Anything else is also worth letting ffmpeg attempt — a decoder that
      // chokes on an unusual bitstream is exactly what the fallback is for.
      throw new ConversionError(
        "internal",
        `Converting ${FORMATS[source].label} to ${FORMATS[target].label} failed.`,
        { cause },
      );
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  },
};

import * as Comlink from "comlink";
import { createWorkerHost, withStallTimeout } from "../workerHost";
import { FORMATS, isAudioExtraction, type FormatId } from "../formats";
import { ConversionError, type ConvertOptions, type Engine, type ProgressUpdate } from "../types";
import type { MediaWorkerApi } from "../workers/media.worker";

/**
 * Audio and video via WebCodecs.
 *
 * Preferred over ffmpeg wherever it works: it uses the browser's own codecs
 * (usually hardware-accelerated), needs no 32 MB download, and gives real
 * progress. It cannot do everything — most browsers encode neither MP3 nor
 * Vorbis (though Firefox does Vorbis, and some Linux WebKit builds do MP3), and
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

/**
 * How long a conversion may report no progress at all before we give up on it.
 *
 * WebCodecs can accept a job, report itself capable, and then simply never
 * produce output. Measured on CI: every `tone.ogg` conversion sat at zero
 * progress until the 90-second test timeout, on browsers that answer
 * `canDecodeAudio("vorbis")` with `true`. Locally the same browsers convert it
 * in milliseconds, so the capability check cannot be trusted as a promise —
 * only as a hint.
 *
 * A stall detector rather than a total-time limit, deliberately: a 2 GB video
 * legitimately takes minutes, but it never goes half a minute without a packet.
 * Silence is the signal, not duration.
 *
 * Giving up here is cheap, because the broker simply falls through to ffmpeg
 * and the user gets their file anyway.
 */
const STALL_MS = 30_000;

/**
 * A stall window proportional to the work.
 *
 * A flat 30 s is absurd for a two-second audio clip: WebCodecs reports itself
 * capable, produces nothing, and the queue waits half a minute before falling
 * back — for a file ffmpeg converts in under a second. It is equally too SHORT
 * for a 300 MB video, where a gap while demuxing is normal.
 *
 * Scaling by input size fixes both ends. The floor of five seconds is well
 * clear of any real first-packet latency; the ceiling stays at thirty.
 */
function stallWindowFor(bytes: number): number {
  const perMegabyte = 120; // ms
  return Math.round(Math.min(STALL_MS, Math.max(5_000, (bytes / 1_048_576) * perMegabyte)));
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

    let watchdog: { tick: () => void; dispose: () => void } | undefined;

    try {
      const conversion = host.call((api) =>
        api.convert(
          file,
          target,
          effective,
          jobId,
          Comlink.proxy((p: number | null) => {
            watchdog?.tick();
            onProgress({ progress: p });
          }),
        ),
      );

      // Cancel the worker-side conversion on a stall so it stops holding
      // memory, then let the broker fall through to ffmpeg.
      const guarded = withStallTimeout(conversion, stallWindowFor(file.size), () => {
        void host.call((api) => api.cancel(jobId));
      });
      watchdog = guarded;

      const { buffer } = await guarded.result;
      onProgress({ progress: 1 });
      return { blob: new Blob([buffer], { type: FORMATS[target].mime }) };
    } catch (cause) {
      const err = cause as { name?: string; message?: string };
      const message = err?.message ?? String(cause);

      // "Not my job" is a routing signal, not a failure. It must stay a kind
      // the broker falls through on — throwing `unsupported` here would stop
      // the search and deny the user a conversion ffmpeg can do easily.
      if (/stalled/i.test(message)) {
        throw new ConversionError(
          "internal",
          `WebCodecs stalled on this file; falling back. (${message})`,
        );
      }
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
      watchdog?.dispose();
      signal?.removeEventListener("abort", onAbort);
    }
  },
};

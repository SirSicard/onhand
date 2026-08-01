import { FFmpeg } from "@ffmpeg/ffmpeg";
import { announceEngineLoad } from "../engineLoad";
import { FORMATS, isAudioExtraction, type FormatId } from "../formats";
import { ConversionError, type ConvertOptions, type Engine, type ProgressUpdate } from "../types";

/**
 * The universal fallback: ffmpeg compiled to wasm.
 *
 * Slower than WebCodecs and a 32 MB one-time download, but it can do the things
 * no browser can — encode MP3 and Vorbis, read AVI and every other legacy
 * container, build animated GIFs with a proper palette. It runs in its own
 * worker (FFmpeg spawns one internally), so this module stays on the main
 * thread and never blocks it with codec work.
 *
 * The core is served from our own origin, never a CDN — see
 * scripts/sync-ffmpeg-core.mjs for why that is not negotiable.
 */

const CORE_URL = "/ffmpeg/ffmpeg-core.js";
/**
 * Gzipped, and that is not an optimisation.
 *
 * The raw core is 30.7 MiB and Cloudflare Pages refuses any file over 25 MiB —
 * so the uncompressed file cannot be deployed at all. Compressed it is 9.7 MiB,
 * which also happens to be what the user actually downloads.
 */
const WASM_URL = "/ffmpeg/ffmpeg-core.wasm.gz";

/**
 * Fetch the core and hand ffmpeg blob: URLs rather than paths.
 *
 * ffmpeg's worker loads the core with `await import(coreURL)`. Point that at a
 * real path and a dev server will treat it as a module to transform — Vite
 * appends `?import` and then fails on 111 KB of emscripten output, reporting
 * "Failed to fetch dynamically imported module", which sounds like a missing
 * file and is not. A blob: URL is opaque to the bundler, so the same code path
 * runs in dev and in production.
 *
 * Fetching still goes through the normal HTTP cache, so the 32 MB stays a
 * one-time cost across visits.
 */
let blobUrls: Promise<{ coreURL: string; wasmURL: string }> | null = null;

/** Every wasm module starts with these four bytes. */
const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];

/**
 * Verify a downloaded asset is what it claims to be, before it reaches ffmpeg.
 *
 * This is not paranoia. Cloudflare Pages answers a request for a missing asset
 * with the 404 page and **HTTP 200** — measured against production, where
 * `/ffmpeg/ffmpeg-core.wasm` returned `200 text/html`, 7,305 bytes of markup.
 * A missing file is therefore indistinguishable from a present one at the HTTP
 * level, and `toBlobURL` will happily wrap that markup in a blob labelled
 * application/wasm. ffmpeg then fails deep inside instantiation with a message
 * about magic bytes that reads like a corrupt build.
 *
 * Checking here converts a confusing failure into an accurate one.
 */
function assertIsWasm(buffer: ArrayBuffer): void {
  const head = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  if (head.length < 4 || !WASM_MAGIC.every((b, i) => head[i] === b)) {
    const text = new TextDecoder().decode(buffer.slice(0, 64));
    throw new Error(
      /<!doctype|<html/i.test(text)
        ? "the server returned a web page instead of the engine — it is not deployed"
        : `the engine file is not valid wasm (${buffer.byteLength} bytes)`,
    );
  }
}

/**
 * Download with progress.
 *
 * Hand-rolled rather than using @ffmpeg/util's `downloadWithProgress`, which
 * breaks on exactly the response we serve: when `Content-Encoding: gzip` is
 * present, `Content-Length` is the wire size while the stream yields the
 * larger decompressed body. Its progress loop throws on the mismatch and its
 * fallback then calls `arrayBuffer()` on a body its own reader already
 * consumed — so the real error becomes "body stream already read", which points
 * nowhere near the cause.
 *
 * Fifteen lines we control, on the critical path, beats a dependency that fails
 * this way.
 */
async function downloadWithProgress(
  url: string,
  onProgress: (received: number, total: number | null) => void,
): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`engine returned ${response.status}`);
  if (!response.body) return response.arrayBuffer();

  // Only trustworthy when the body is not encoded — otherwise it describes the
  // compressed size while we are counting decompressed bytes.
  const declared = Number(response.headers.get("content-length"));
  let total: number | null =
    response.headers.get("content-encoding") || !Number.isFinite(declared) || declared <= 0
      ? null
      : declared;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    // If we somehow overshoot, the header was lying — fall back to
    // indeterminate rather than showing a bar stuck at 100%.
    if (total !== null && received > total) total = null;
    onProgress(received, total);
  }

  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

/** gzip's own magic bytes. */
const GZIP_MAGIC = [0x1f, 0x8b];

/**
 * Decompress the core, unless the server already did.
 *
 * Detected rather than assumed. A server that sends `Content-Encoding: gzip`
 * for a `.gz` file makes the browser decompress it transparently, and we would
 * then be handed a wasm module and try to gunzip it. Sniffing two bytes covers
 * both behaviours and does not care which server we are on — which matters,
 * because dev, the local static server, and Cloudflare need not agree.
 */
async function gunzipIfNeeded(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const head = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
  if (head.length < 2 || !GZIP_MAGIC.every((b, i) => head[i] === b)) return buffer;

  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

function coreBlobUrls() {
  blobUrls ??= (async () => {
    const coreResponse = await fetch(CORE_URL);
    if (!coreResponse.ok) throw new Error(`engine script returned ${coreResponse.status}`);
    const coreText = await coreResponse.text();
    if (/^\s*<!doctype|^\s*<html/i.test(coreText)) {
      throw new Error("the server returned a web page instead of the engine script");
    }
    const coreURL = URL.createObjectURL(new Blob([coreText], { type: "text/javascript" }));

    // Only the core wasm is worth reporting progress on, and that progress is
    // real — read from Content-Length — so the number shown is a measurement
    // rather than an animation, which is the whole point of showing one.
    const downloaded = await downloadWithProgress(WASM_URL, (received, total) => {
      announce(true, total === null ? null : Math.min(received / total, 1));
    });

    const wasmBuffer = await gunzipIfNeeded(downloaded);
    assertIsWasm(wasmBuffer);
    const wasmURL = URL.createObjectURL(new Blob([wasmBuffer], { type: "application/wasm" }));

    return { coreURL, wasmURL };
  })().catch((err) => {
    blobUrls = null; // a failed fetch must not be cached as the answer
    announce(false, null);
    throw err;
  });
  return blobUrls;
}

/**
 * Generous enough for 32 MB over a slow connection, short enough that a
 * genuinely broken load surfaces as an error instead of an eternal spinner.
 */
const LOAD_TIMEOUT_MS = 120_000;

function withDeadline<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s: ${what}`)), ms);
    }),
  ]).finally(() => clearTimeout(timer)) as Promise<T>;
}

let instance: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

function announce(loading: boolean, progress: number | null) {
  announceEngineLoad({ loading, progress });
}

export function isFfmpegLoaded(): boolean {
  return instance !== null;
}

async function load(): Promise<FFmpeg> {
  if (instance) return instance;
  // Concurrent jobs must share one load, not start five 32 MB downloads.
  if (loading) return loading;

  loading = (async () => {
    const ff = new FFmpeg();
    // null, not 0: at this instant we genuinely don't know how much is left,
    // and a bar that sits at 0% is a claim we can't back.
    announce(true, null);

    // The browser cache is what makes the 32 MB a genuinely one-time cost.
    // @ffmpeg/ffmpeg fetches these URLs itself, so a normal HTTP cache entry is
    // all that's needed — no CacheStorage bookkeeping of our own to get wrong.
    try {
      // Bounded, because load() can hang forever rather than reject: it waits
      // for a ready message from a worker that may never have been constructed,
      // and there is no path by which it gives up. A bundler that mishandles
      // the worker URL produces exactly that, and the symptom is a job that
      // sits at "converting" for the rest of the session with nothing in the
      // console. A deadline turns that into an error we can show.
      await withDeadline(
        coreBlobUrls().then((urls) => ff.load(urls)),
        LOAD_TIMEOUT_MS,
        "the conversion engine did not finish loading",
      );
    } catch (cause) {
      announce(false, null);
      loading = null;
      throw new ConversionError("internal", "The conversion engine failed to load.", {
        suggestion:
          cause instanceof Error && /not deployed|web page/i.test(cause.message)
            ? "The engine file is missing from the server. This is our bug, not yours."
            : "Check your connection and try again — it's a one-time download.",
        cause,
      });
    }

    announce(false, 1);
    instance = ff;
    return ff;
  })();

  return loading;
}

/** Discard a wedged instance so the next job starts clean. */
export function resetFfmpeg(): void {
  try {
    instance?.terminate();
  } catch {
    // Terminating an already-dead worker is not an error worth surfacing.
  }
  instance = null;
  loading = null;
}

/**
 * Audio codec per output container.
 *
 * Explicit rather than left to ffmpeg's defaults, because those defaults change
 * between builds and a silent switch from Vorbis to Opus inside a .ogg is the
 * kind of thing nobody notices until a device won't play the file.
 */
const AUDIO_CODEC: Partial<Record<FormatId, string[]>> = {
  mp3: ["-c:a", "libmp3lame"],
  m4a: ["-c:a", "aac"],
  aac: ["-c:a", "aac"],
  ogg: ["-c:a", "libvorbis"],
  opus: ["-c:a", "libopus"],
  flac: ["-c:a", "flac"],
  wav: ["-c:a", "pcm_s16le"],
};

const VIDEO_ARGS: Partial<Record<FormatId, string[]>> = {
  // yuv420p is not an aesthetic choice: 4:4:4 H.264 plays in almost nothing,
  // and ffmpeg will happily produce it from a 4:4:4 source.
  mp4: ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart"],
  mov: ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p"],
  mkv: ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p"],
  webm: ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "5"],
};

const AV_KINDS = new Set(["audio", "video"]);

function buildArgs(
  input: string,
  output: string,
  source: FormatId,
  target: FormatId,
  options: ConvertOptions,
): string[] {
  const args: string[] = [];

  // Trim before the input for a fast seek, which skips decoding everything
  // before the start point instead of decoding and discarding it.
  if (options.trim?.start) args.push("-ss", String(options.trim.start));
  args.push("-i", input);
  if (options.trim?.end) {
    args.push("-t", String(options.trim.end - (options.trim.start ?? 0)));
  }

  const targetKind = FORMATS[target].kind;
  const extracting = isAudioExtraction(source, target);

  if (targetKind === "audio" || extracting) {
    args.push("-vn"); // drop video, including any embedded cover art
    args.push(...(AUDIO_CODEC[target] ?? []));
    if (options.audioBitrateKbps && FORMATS[target].lossy) {
      args.push("-b:a", `${options.audioBitrateKbps}k`);
    }
    // Vorbis is experimental in some builds and refuses to run without this.
    if (target === "ogg") args.push("-strict", "experimental");
  } else {
    args.push(...(VIDEO_ARGS[target] ?? []));
    if (options.videoBitrateKbps) args.push("-b:v", `${options.videoBitrateKbps}k`);

    // H.264 cannot encode odd dimensions. Rounding down to even is invisible;
    // failing with "width not divisible by 2" is how a phone crop breaks a
    // converter, and portrait-odd.mp4 exists in the corpus to prove we don't.
    const scale = options.maxDimension
      ? `scale='min(${options.maxDimension},iw)':'min(${options.maxDimension},ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`
      : `scale=trunc(iw/2)*2:trunc(ih/2)*2`;
    args.push("-vf", scale);

    if (target === "webm") {
      args.push("-c:a", "libopus");
    } else {
      args.push("-c:a", "aac");
    }
    if (options.audioBitrateKbps) args.push("-b:a", `${options.audioBitrateKbps}k`);
  }

  if (options.stripMetadata !== false) args.push("-map_metadata", "-1");

  args.push(output);
  return args;
}

export const ffmpegEngine: Engine = {
  id: "ffmpeg",
  // Highest cost of any engine: correct for everything, first choice for
  // nothing. The broker reaches it only when the cheaper engines decline.
  cost: 10,

  canHandle(source, target) {
    const from = FORMATS[source].kind;
    const to = FORMATS[target].kind;
    if (!AV_KINDS.has(from)) return false;
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

    onProgress({ progress: null });
    const ff = await load();
    if (signal?.aborted) throw new ConversionError("internal", "Cancelled");

    // Names inside ffmpeg's virtual filesystem. The extension is load-bearing —
    // it is how ffmpeg picks the demuxer and muxer — but the stem is ours, so a
    // file called `-i.mp4` can't be read as a flag.
    const inName = `in.${FORMATS[source].ext}`;
    const outName = `out.${FORMATS[target].ext}`;

    const onLog = ({ message }: { message: string }) => {
      lastLog = message;
    };
    let lastLog = "";

    const onFfmpegProgress = ({ progress }: { progress: number }) => {
      // ffmpeg's progress is derived from log parsing and is unreliable for
      // some containers — it reports NaN, or values above 1, or nothing at all.
      // An indeterminate spinner is honest; a fabricated percentage is not.
      if (!Number.isFinite(progress) || progress < 0) return onProgress({ progress: null });
      onProgress({ progress: Math.min(progress, 1) });
    };

    ff.on("log", onLog);
    ff.on("progress", onFfmpegProgress);

    const onAbort = () => {
      // ffmpeg.wasm has no cooperative cancel — terminate is the only way out,
      // and it takes the whole instance with it. Acceptable: the alternative is
      // making someone sit through a conversion they explicitly stopped.
      resetFfmpeg();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      await ff.writeFile(inName, new Uint8Array(await file.arrayBuffer()));

      const code = await ff.exec(buildArgs(inName, outName, source, target, options));
      if (code !== 0) {
        throw new ConversionError(
          "corrupt",
          `This ${FORMATS[source].label} file could not be converted.`,
          {
            suggestion: "It may be damaged, or use a codec we can't read.",
            cause: new Error(lastLog || `ffmpeg exited ${code}`),
          },
        );
      }

      const data = await ff.readFile(outName);
      // readFile's return is typed as FileData (string | Uint8Array) and the
      // Uint8Array is over an ArrayBufferLike, which Blob won't take directly.
      const bytes: Uint8Array<ArrayBuffer> =
        typeof data === "string"
          ? new TextEncoder().encode(data)
          : new Uint8Array(data.slice().buffer as ArrayBuffer);
      if (bytes.byteLength === 0) {
        throw new ConversionError("internal", "The conversion produced an empty file.", {
          cause: new Error(lastLog),
        });
      }

      onProgress({ progress: 1 });
      return { blob: new Blob([bytes], { type: FORMATS[target].mime }) };
    } catch (cause) {
      if (cause instanceof ConversionError) throw cause;
      const message = cause instanceof Error ? cause.message : String(cause);

      if (signal?.aborted) throw new ConversionError("internal", "Cancelled");

      if (/memory|allocation|abort|OOM/i.test(message)) {
        // An OOM inside wasm leaves the instance unusable, so this is the one
        // case that genuinely warrants discarding it.
        resetFfmpeg();
        throw new ConversionError(
          "too-large",
          "This file is too large to convert in the browser.",
          {
            suggestion:
              "In-browser conversion tops out around 2 GB of working memory. Trimming it to a shorter section usually gets under that.",
            cause,
          },
        );
      }
      throw new ConversionError(
        "internal",
        `Converting ${FORMATS[source].label} to ${FORMATS[target].label} failed.`,
        { cause: new Error(lastLog || message) },
      );
    } finally {
      signal?.removeEventListener("abort", onAbort);
      ff.off?.("log", onLog);
      ff.off?.("progress", onFfmpegProgress);
      // Free the virtual filesystem entries — ffmpeg.wasm keeps them in memory
      // for the life of the instance, so a batch would otherwise accumulate
      // every input and output until it hit the 2 GB wall.
      if (instance === ff) {
        await ff.deleteFile(inName).catch(() => {});
        await ff.deleteFile(outName).catch(() => {});
      }
    }
  },
};

import { FORMATS, NATIVE_DECODABLE, type FormatId } from "./formats";

/**
 * Whether a given conversion would still work with the network off.
 *
 * This is the honest version of an offline badge. The tempting implementation
 * is "a service worker is installed, therefore offline works" — which is false
 * for any pair whose codec has never been downloaded. Someone who converted a
 * PNG on Monday does not have the 9.7 MB audio engine, and telling them it
 * works in airplane mode is a promise that breaks at the worst moment.
 *
 * So we ask the service worker what is genuinely in the cache and answer per
 * pair.
 */

/**
 * The wasm each format needs, matched by substring.
 *
 * Substrings rather than exact URLs because the bundler content-hashes these
 * (`avif_enc-Co4TcJko.wasm`), so the full name is unknown until build time —
 * but the base name survives hashing, which makes matching reliable.
 *
 * A format absent from this map needs no wasm at all: BMP, ICO and GIF decode
 * through the browser's own `createImageBitmap`, and every audio and video pair
 * on the WebCodecs path uses codecs already in the browser. Those work offline
 * as soon as the shell is cached — which is worth knowing, because it is most
 * of them.
 */
const DECODE_ASSETS: Partial<Record<FormatId, string[]>> = {
  heic: ["libheif"],
  avif: ["avif_dec"],
  // resvg compiles to a wasm the bundler names `index_bg` — unrecognisable,
  // but it is what is actually on disk.
  svg: ["index_bg"],
  tiff: [], // UTIF is plain JS, cached with the shell
  pdf: [], // pdf.js is JS; so is its worker
  // Everything in NATIVE_DECODABLE is deliberately absent: the browser decodes
  // those itself and no wasm is ever fetched, so they need nothing cached.
};

const ENCODE_ASSETS: Partial<Record<FormatId, string[]>> = {
  jpeg: ["mozjpeg_enc"],
  png: ["squoosh_png_bg", "squoosh_oxipng"],
  webp: ["webp_enc"],
  avif: ["avif_enc"],
  pdf: [], // pdf-lib is plain JS
};

/**
 * Audio and video most browsers cannot encode go through ffmpeg, and that
 * is the 9.7 MB download. Anything else on those kinds uses WebCodecs and needs
 * nothing cached beyond the shell.
 */
const NEEDS_FFMPEG: ReadonlySet<FormatId> = new Set([
  // Capability-dependent: most browsers cannot encode these, some can, and the
  // broker asks at runtime. Listed here because "most" is the case to be
  // honest about.
  "mp3",
  "ogg",
  // Unconditional, unlike the two above. There is no GIF encoder in WebCodecs
  // anywhere, and the palette generation this needs is a filter graph rather
  // than a codec — so mediaEngine declines it outright and it is always ffmpeg.
  // Without this line the badge said "works offline" over a queued mp4 → gif
  // job that would have gone looking for 9.7 MB, which is precisely the promise
  // this badge exists to avoid making.
  "gif",
]);

const FFMPEG_ASSETS = ["/ffmpeg/ffmpeg-core.js", "/ffmpeg/ffmpeg-core.wasm.gz"];

/** Every asset substring a pair depends on. */
export function assetsForPair(source: FormatId, target: FormatId): string[] {
  const decode = NATIVE_DECODABLE.has(source) ? [] : (DECODE_ASSETS[source] ?? []);
  const needed = [...decode, ...(ENCODE_ASSETS[target] ?? [])];

  const kind = FORMATS[source].kind;
  if (kind === "audio" || kind === "video") {
    // AVI is the other ffmpeg-only case: mediabunny cannot demux it.
    if (NEEDS_FFMPEG.has(target) || source === "avi") needed.push(...FFMPEG_ASSETS);
  }
  return needed;
}

/** Ask the service worker what it currently holds. Empty when there isn't one. */
export async function cachedAssets(): Promise<string[]> {
  const sw = navigator.serviceWorker?.controller;
  if (!sw) return [];

  return new Promise<string[]>((resolve) => {
    const channel = new MessageChannel();
    // A service worker that never replies must not hang the badge forever.
    const timer = setTimeout(() => resolve([]), 2000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data?.urls ?? []);
    };
    sw.postMessage({ type: "cached-assets" }, [channel.port2]);
  });
}

export interface OfflineStatus {
  /** A service worker is installed and controlling this page. */
  ready: boolean;
  /** This exact pair would work with the network off. */
  pairAvailable: boolean;
  /** True when the pair needs nothing beyond the shell — most of them. */
  needsNothingExtra: boolean;
}

export async function offlineStatusFor(source: FormatId, target: FormatId): Promise<OfflineStatus> {
  const ready = Boolean(navigator.serviceWorker?.controller);
  const needed = assetsForPair(source, target);

  if (!ready) return { ready: false, pairAvailable: false, needsNothingExtra: needed.length === 0 };
  if (needed.length === 0) {
    return { ready: true, pairAvailable: true, needsNothingExtra: true };
  }

  const cached = await cachedAssets();
  const pairAvailable = needed.every((fragment) => cached.some((url) => url.includes(fragment)));
  return { ready, pairAvailable, needsNothingExtra: false };
}

/**
 * Register the service worker.
 *
 * Deliberately not awaited by anything on the critical path: a failed
 * registration must degrade to "no offline support", never to a broken page.
 */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  // In dev there is no generated sw.js, and registering a 404 logs a confusing
  // error every reload.
  if (!import.meta.env.PROD) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline support is a bonus. Losing it is not worth surfacing.
    });
  });
}

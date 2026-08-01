/// <reference lib="webworker" />
import * as Comlink from "comlink";
import { NATIVE_DECODABLE, type FormatId } from "../formats";
import type { ConvertOptions } from "../types";

/**
 * Image codec worker.
 *
 * Every codec is dynamically imported at the moment it is first needed. That is
 * not tidiness — each wasm binary is 200 KB–2 MB, and someone converting a PNG
 * to WebP must not pay for the AVIF encoder or the HEIC decoder. The browser's
 * HTTP cache keeps them after first use (assets are immutable-cached).
 *
 * Runs off the main thread, so a 50-file batch cannot jank the UI.
 */

export interface DecodedImage {
  data: ImageData;
  width: number;
  height: number;
}

/**
 * Decoders that come from jSquash, keyed by source format.
 *
 * These return `ImageData | null` — null means the codec ran but produced
 * nothing, which is how a truncated or malformed file presents. Callers must
 * treat null as a decode failure rather than passing it downstream.
 */
type JsquashDecode = (b: ArrayBuffer) => Promise<ImageData | null>;

const JSQUASH_DECODERS: Partial<Record<FormatId, () => Promise<JsquashDecode>>> = {
  jpeg: async () => (await import("@jsquash/jpeg")).decode,
  png: async () => (await import("@jsquash/png")).decode,
  webp: async () => (await import("@jsquash/webp")).decode,
  avif: async () => (await import("@jsquash/avif")).decode as JsquashDecode,
};

async function decodeNatively(buffer: ArrayBuffer, mime: string): Promise<ImageData> {
  const blob = new Blob([buffer], { type: mime });
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no 2d context in worker");
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

async function decodeHeic(buffer: ArrayBuffer): Promise<ImageData> {
  // Chromium and Firefox cannot decode HEIC at all (Safari can), so libheif is
  // the only path for the format most people arrive here to escape.
  //
  // Import the .mjs build explicitly. The package's `main` and its `wasm-bundle`
  // entry are CommonJS/UMD, which blow up in an ES-module worker with the
  // magnificently unhelpful `ReferenceError: module is not defined`.
  // libheif-bundle.mjs embeds its own wasm, so there is no separate binary to
  // locate — worth the ~2 MB given it is loaded only for HEIC jobs.
  const factory = (await import("libheif-js/libheif-wasm/libheif-bundle.mjs")).default;
  const libheif = await factory();

  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(new Uint8Array(buffer));
  const image = images?.[0];
  if (!image) {
    throw new Error("HEIC container held no image");
  }

  const width = image.get_width();
  const height = image.get_height();
  const out = new ImageData(width, height);

  await new Promise<void>((resolve, reject) => {
    image.display({ data: out.data, width, height }, (result: unknown) => {
      if (result) resolve();
      else reject(new Error("HEIC decode returned no data"));
    });
  });

  return out;
}

let resvgReady: Promise<typeof import("@resvg/resvg-wasm")> | null = null;

async function loadResvg() {
  resvgReady ??= (async () => {
    const mod = await import("@resvg/resvg-wasm");
    // resvg needs its wasm initialised once. The URL is resolved relative to this
    // module so the bundler fingerprints and caches it like any other asset.
    const wasmUrl = new URL(
      "../../../node_modules/@resvg/resvg-wasm/index_bg.wasm",
      import.meta.url,
    );
    await mod.initWasm(fetch(wasmUrl));
    return mod;
  })();
  return resvgReady;
}

async function decodeTiff(buffer: ArrayBuffer): Promise<ImageData> {
  // No browser decodes TIFF, and TIFF is less a format than a container of
  // wildly varying contents — big-endian, 14 bits per sample, tiled, LZW,
  // CMYK. UTIF handles the realistic spread in ~30 KB of plain JS, which beats
  // shipping a wasm codec for a format most people convert *out of*, once.
  const UTIF = (await import("utif")).default;
  const ifds = UTIF.decode(buffer);
  const page = ifds[0];
  if (!page) throw new Error("TIFF held no image");

  UTIF.decodeImage(buffer, page, ifds);
  const rgba = UTIF.toRGBA8(page); // normalises bit depth and colour model for us

  const width = page.width;
  const height = page.height;
  if (!width || !height) throw new Error("TIFF reported no dimensions");

  return new ImageData(new Uint8ClampedArray(rgba), width, height);
}

async function decodeSvg(buffer: ArrayBuffer, maxDimension?: number): Promise<ImageData> {
  // SVG is markup, not pixels, and it cannot go through createImageBitmap:
  // Chromium refuses SVG blobs there (it works only in Firefox), which is why
  // the obvious browser-native approach silently fails on most people's machines.
  // resvg is a real renderer and works identically everywhere, in a worker.
  const { Resvg } = await loadResvg();
  const svg = new TextDecoder().decode(buffer);

  const resvg = new Resvg(
    svg,
    maxDimension ? { fitTo: { mode: "width", value: maxDimension } } : {},
  );
  const rendered = resvg.render();
  const width = rendered.width;
  const height = rendered.height;
  const pixels = rendered.pixels;
  rendered.free();
  resvg.free();

  return new ImageData(new Uint8ClampedArray(pixels), width, height);
}

async function decode(
  buffer: ArrayBuffer,
  source: FormatId,
  mime: string,
  maxDimension?: number,
): Promise<ImageData> {
  if (source === "heic") return decodeHeic(buffer);
  if (source === "tiff") return decodeTiff(buffer);
  if (source === "svg") return decodeSvg(buffer, maxDimension);

  // Prefer the browser's own decoder where it exists — no wasm download at all.
  if (NATIVE_DECODABLE.has(source)) {
    try {
      return await decodeNatively(buffer, mime);
    } catch {
      // Fall through to the wasm codec: Safari has historically refused some
      // progressive JPEGs and animated WebP via createImageBitmap.
    }
  }

  const loader = JSQUASH_DECODERS[source];
  if (!loader) {
    throw new Error(`no decoder for ${source}`);
  }
  const decodeFn = await loader();
  const decoded = await decodeFn(buffer);
  if (!decoded) {
    // The codec ran and returned nothing — a truncated or malformed file.
    // Surfacing this as an explicit failure keeps a null from travelling into
    // the encoder and producing a confusing error three frames later.
    throw new Error(`decoder produced no image for ${source}`);
  }
  return decoded;
}

async function resize(image: ImageData, maxDimension: number): Promise<ImageData> {
  const longest = Math.max(image.width, image.height);
  if (longest <= maxDimension) return image;
  const scale = maxDimension / longest;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const { default: resizeFn } = await import("@jsquash/resize");
  return resizeFn(image, { width, height });
}

async function encode(
  image: ImageData,
  target: FormatId,
  options: ConvertOptions,
): Promise<ArrayBuffer> {
  const quality = options.quality ?? 80;
  switch (target) {
    case "jpeg": {
      const { encode: enc } = await import("@jsquash/jpeg");
      return enc(image, { quality });
    }
    case "webp": {
      const { encode: enc } = await import("@jsquash/webp");
      return enc(image, { quality });
    }
    case "avif": {
      const { encode: enc } = await import("@jsquash/avif");
      // @jsquash/avif v2 takes plain 0-100 quality. (Older AVIF wrappers used an
      // inverted 0-63 `cqLevel`; passing that here is silently ignored and every
      // output lands at the default quality regardless of the preset.)
      return enc(image, { quality });
    }
    case "png": {
      const { encode: enc } = await import("@jsquash/png");
      const png = await enc(image);
      // oxipng is lossless recompression — always worth it, never changes pixels.
      try {
        const { optimise } = await import("@jsquash/oxipng");
        return await optimise(png, { level: 2 });
      } catch {
        return png; // optimisation is a bonus; never fail the job over it
      }
    }
    default:
      throw new Error(`no encoder for ${target}`);
  }
}

const api = {
  /**
   * Convert one image. Returns a transferable ArrayBuffer.
   *
   * Metadata note: decoding to ImageData and re-encoding discards EXIF as a side
   * effect, which is the behaviour we want by default (see ConvertOptions).
   * Preserving it would be the feature requiring work, not the reverse.
   */
  async convert(
    buffer: ArrayBuffer,
    source: FormatId,
    target: FormatId,
    mime: string,
    options: ConvertOptions,
  ): Promise<ArrayBuffer> {
    let image = await decode(buffer, source, mime, options.maxDimension);
    if (options.maxDimension && source !== "svg") {
      image = await resize(image, options.maxDimension);
    }
    return encode(image, target, options);
  },

  /** Dimensions without a full re-encode — used for pre-flight estimates. */
  async probe(
    buffer: ArrayBuffer,
    source: FormatId,
    mime: string,
  ): Promise<{ width: number; height: number }> {
    const image = await decode(buffer, source, mime);
    return { width: image.width, height: image.height };
  },
};

export type ImagesWorkerApi = typeof api;

Comlink.expose(api);

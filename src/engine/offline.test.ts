import { describe, it, expect } from "vitest";
import { assetsForPair } from "./offline";
import { FORMATS, NATIVE_DECODABLE, targetsFor } from "./formats";

/** Fragments contributed by the ENCODE side, so decode assertions can exclude them. */
const ENCODE_FRAGMENTS = new Set([
  "mozjpeg_enc",
  "squoosh_png_bg",
  "squoosh_oxipng",
  "webp_enc",
  "avif_enc",
]);

/**
 * The offline badge makes a promise. These guard the two ways it could lie.
 */

describe("assetsForPair", () => {
  it("knows heic needs libheif and a jpeg encoder", () => {
    const needed = assetsForPair("heic", "jpeg");
    expect(needed).toContain("libheif");
    expect(needed).toContain("mozjpeg_enc");
  });

  it("never demands the 9.7 MB engine for a pair WebCodecs handles", () => {
    // mov->mp4 goes through the browser's own codecs. Claiming it needs ffmpeg
    // would show "not available offline" to someone for whom it works fine.
    for (const target of ["mp4", "webm", "m4a", "wav"] as const) {
      expect(assetsForPair("mov", target).join(" "), `mov -> ${target}`).not.toMatch(/ffmpeg/);
    }
  });

  it("does demand it for the pairs most browsers cannot encode", () => {
    // The inverse failure, and the worse one: promising offline capability for
    // a pair that will hit the network for 9.7 MB.
    expect(assetsForPair("wav", "mp3").join(" ")).toMatch(/ffmpeg/);
    expect(assetsForPair("m4a", "ogg").join(" ")).toMatch(/ffmpeg/);
    // AVI is ffmpeg-only for a different reason: mediabunny cannot demux it.
    expect(assetsForPair("avi", "mp4").join(" ")).toMatch(/ffmpeg/);
  });

  it("asks for nothing extra where the browser already has the codec", () => {
    // BMP, ICO and GIF decode via createImageBitmap; PNG output needs wasm, so
    // pick a target that doesn't. These are the pairs that work offline
    // immediately, and saying otherwise undersells the product.
    expect(assetsForPair("gif", "jpeg")).toEqual(["mozjpeg_enc"]);
  });

  it("returns something checkable for every pair the UI can offer", () => {
    // A pair with no mapping silently reports "works offline" because an empty
    // requirement list is trivially satisfied. That must only happen where it
    // is actually true.
    for (const source of Object.values(FORMATS)) {
      for (const target of targetsFor(source.id)) {
        const needed = assetsForPair(source.id, target.id);
        expect(Array.isArray(needed), `${source.id} -> ${target.id}`).toBe(true);
        for (const fragment of needed) {
          expect(
            fragment.length,
            `${source.id} -> ${target.id} has an empty fragment`,
          ).toBeGreaterThan(2);
        }
      }
    }
  });
});

describe("the mapping matches what the engine really loads", () => {
  it("asks for nothing to decode a format the browser decodes itself", () => {
    // PNG, JPEG, WebP, GIF, BMP and ICO go through createImageBitmap — no wasm
    // is ever fetched. Demanding one made the badge report "not available
    // offline" for pairs that work fine, which undersells the product in the
    // one place it is trying to make a promise.
    for (const source of NATIVE_DECODABLE) {
      const needed = assetsForPair(source, "png");
      const decodeSide = needed.filter((f) => !ENCODE_FRAGMENTS.has(f));
      expect(decodeSide, `${source} should need nothing to decode`).toEqual([]);
    }
  });

  it("still asks for the decoders that genuinely exist", () => {
    // The inverse: these are NOT natively decodable and do need wasm.
    expect(assetsForPair("heic", "jpeg")).toContain("libheif");
    expect(assetsForPair("avif", "jpeg")).toContain("avif_dec");
    expect(assetsForPair("svg", "png")).toContain("index_bg");
  });
});

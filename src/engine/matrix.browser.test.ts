import { describe, it, expect, beforeAll } from "vitest";
import { convert, enginesFor, prewarm } from "./broker";
import { FORMATS, detectFormat, targetsFor, type FormatId } from "./formats";

/**
 * The conversion matrix, run in a real browser against real files.
 *
 * Assertions are on decoded output — dimensions and format magic — not on "some
 * bytes came back". An encoder that returns a valid but empty image passes the
 * lazy version of this test.
 */

async function fixture(name: string): Promise<File> {
  const res = await fetch(`/fixtures/${name}`);
  if (!res.ok) throw new Error(`fixture ${name} missing (${res.status})`);
  const buf = await res.arrayBuffer();

  // The trap that cost an hour twice: fixtures served as the dev server's HTML
  // fallback decode-fail in a way indistinguishable from a broken codec. Check
  // for a document, not for '<' — SVG legitimately starts with '<'.
  const head = new TextDecoder().decode(buf.slice(0, 64));
  if (/^\s*<!doctype html|^\s*<html/i.test(head)) {
    throw new Error(`fixture ${name} was served as HTML, not file bytes`);
  }
  return new File([buf], name);
}

/** Decode a blob and return its real pixel dimensions. */
async function dimensionsOf(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  const dim = `${bitmap.width}x${bitmap.height}`;
  bitmap.close();
  return dim;
}

const MAGIC: Record<string, number[]> = {
  jpeg: [0xff, 0xd8, 0xff],
  png: [0x89, 0x50, 0x4e, 0x47],
  webp: [0x52, 0x49, 0x46, 0x46],
};

async function startsWithMagic(blob: Blob, target: string): Promise<boolean> {
  const expected = MAGIC[target];
  if (!expected) return true; // avif/pdf checked structurally elsewhere
  const head = new Uint8Array(await blob.slice(0, expected.length).arrayBuffer());
  return expected.every((b, i) => head[i] === b);
}

/** name → expected output dimensions after conversion. */
const SOURCES: [string, FormatId, string][] = [
  ["photo.heic", "heic", "640x480"],
  ["graphic-alpha.heic", "heic", "320x320"],
  ["photo.png", "png", "640x480"],
  ["photo.jpg", "jpeg", "640x480"],
  ["photo.webp", "webp", "640x480"],
  ["photo.avif", "avif", "640x480"],
  ["photo.bmp", "bmp", "640x480"],
  ["photo.tiff", "tiff", "640x480"],
  ["icon.ico", "ico", "64x64"],
  ["animated.gif", "gif", "120x120"],
  ["greyscale.png", "png", "640x480"],
  ["palette.png", "png", "640x480"],
  // EXIF orientation 6 rotates a 640x480 source to 480x640 on display, and the
  // output must match what the person saw — not the stored pixel order.
  ["rotated-exif.jpg", "jpeg", "480x640"],
  ["tiny-1x1.png", "png", "1x1"],
  ["vector.svg", "svg", "320x320"],
  ["graphic-alpha.png", "png", "320x320"],
];

const TARGETS: FormatId[] = ["jpeg", "png", "webp", "avif"];

describe("cross-origin isolation", () => {
  it("is active, matching production", () => {
    // If this fails the whole suite is testing a different configuration from
    // the one users get.
    expect(globalThis.crossOriginIsolated).toBe(true);
  });
});

describe("image conversion matrix", () => {
  for (const [name, source, expectedDim] of SOURCES) {
    describe(name, () => {
      let file: File;
      beforeAll(async () => {
        file = await fixture(name);
      });

      it("is detected as the right format", () => {
        expect(detectFormat(file)).toBe(source);
      });

      for (const target of TARGETS) {
        it(`converts to ${target}`, async () => {
          const result = await convert(file, source, target, { quality: 80 }, () => {});
          expect(result.bytesOut).toBeGreaterThan(0);
          expect(await startsWithMagic(result.blob, target)).toBe(true);
          expect(await dimensionsOf(result.blob)).toBe(expectedDim);
        });
      }
    });
  }
});

describe("quality control", () => {
  it("produces monotonically larger output as quality rises", async () => {
    // Guards the class of bug where an option name is wrong and gets silently
    // ignored — AVIF shipped that way until it was measured (cqLevel vs quality).
    const file = await fixture("photo.png");
    for (const target of ["jpeg", "webp", "avif"] as FormatId[]) {
      const sizes: number[] = [];
      for (const quality of [55, 80, 95]) {
        const r = await convert(file, "png", target, { quality }, () => {});
        sizes.push(r.bytesOut);
      }
      expect(sizes[0]!, `${target} q55 < q80`).toBeLessThan(sizes[1]!);
      expect(sizes[1]!, `${target} q80 < q95`).toBeLessThan(sizes[2]!);
    }
  });
});

describe("PDF", () => {
  it("renders a multi-page PDF to one image per page, zipped", async () => {
    const file = await fixture("two-page.pdf");
    const result = await convert(file, "pdf", "png", {}, () => {});
    expect(result.blob.type).toBe("application/zip");
    // Naming a zip ".png" would be a lie the OS then acts on.
    expect(result.filename).toMatch(/\.zip$/);

    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    let entries = 0;
    for (let i = 0; i < bytes.length - 3; i++) {
      if (
        bytes[i] === 0x50 &&
        bytes[i + 1] === 0x4b &&
        bytes[i + 2] === 0x01 &&
        bytes[i + 3] === 0x02
      ) {
        entries++;
      }
    }
    // Silently returning page 1 only is data loss dressed as a feature.
    expect(entries).toBe(2);
  });

  it("builds a PDF from every image input it advertises", async () => {
    const inputs: [string, FormatId][] = [
      ["photo.png", "png"],
      ["photo.jpg", "jpeg"],
      ["photo.heic", "heic"],
      ["vector.svg", "svg"],
      ["photo.tiff", "tiff"],
    ];
    for (const [name, source] of inputs) {
      const result = await convert(await fixture(name), source, "pdf", {}, () => {});
      const head = new TextDecoder().decode(await result.blob.slice(0, 5).arrayBuffer());
      expect(head, `${name} -> pdf`).toBe("%PDF-");
    }
  });
});

describe("failure behaviour", () => {
  it("reports an unsupported pair rather than producing a broken file", async () => {
    await expect(convert(await fixture("photo.png"), "png", "heic", {}, () => {})).rejects.toThrow(
      /isn't supported/i,
    );
  });

  it("rejects a corrupt file with a human sentence", async () => {
    const junk = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], "broken.png");
    await expect(convert(junk, "png", "jpeg", {}, () => {})).rejects.toThrow();
  });
});

describe("prewarm", () => {
  it("makes the pair it warmed measurably faster, and does not change the output", async () => {
    // heic→jpeg is the pair this matters most for: libheif is 1.5 MB of module
    // plus a wasm compile, and it is the conversion most visitors arrive for.
    const file = await fixture("photo.heic");

    await prewarm("heic", "jpeg");

    const started = performance.now();
    const result = await convert(file, "heic", "jpeg", {}, () => {});
    const warmMs = performance.now() - started;

    // The output must be a real JPEG, not a warm side effect that broke it.
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);

    // Not asserting a specific speedup — that is hardware-dependent and would
    // be a flaky test. Asserting that a warmed conversion is quick in absolute
    // terms: cold, this pair spends seconds fetching and compiling libheif.
    expect(warmMs, `warmed heic→jpeg took ${Math.round(warmMs)}ms`).toBeLessThan(4000);
  }, 60_000);

  it("stays silent on a pair it cannot warm, rather than throwing", async () => {
    // Video is ffmpeg's job and must never be warmed — the core is 9.7 MB.
    // The call should no-op, not reject and not download anything.
    await expect(prewarm("mp4", "gif")).resolves.toBeUndefined();
    await expect(prewarm("png", "pdf")).resolves.toBeUndefined();
  }, 30_000);
});

describe("the offered matrix and the engines agree", () => {
  it("has an engine for every pair targetsFor advertises", async () => {
    // The gap this closes: formats.test.ts checks that every offered target is
    // `encodable`, which is a property of the format, not of any engine. When
    // GIF became encodable (video → animated GIF), the document branch of
    // targetsFor started advertising pdf → gif — a pair no engine performs. It
    // was live in the /formats table and in the target dropdown.
    //
    // Checking the flag was never enough. This asks the brokers' actual
    // candidate list, which is what a real conversion asks.
    const orphans: string[] = [];
    for (const source of Object.values(FORMATS)) {
      for (const target of targetsFor(source.id)) {
        if (target.id === source.id) continue;
        if ((await enginesFor(source.id, target.id)).length === 0) {
          orphans.push(`${source.id} → ${target.id}`);
        }
      }
    }
    expect(orphans, "offered to users but no engine handles them").toEqual([]);
  }, 30_000);
});

describe("transparency", () => {
  /** The pixel index (r channel) of the first fully transparent pixel, or -1. */
  async function firstTransparent(blob: Blob): Promise<number> {
    const bitmap = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    for (let i = 3; i < data.length; i += 4) if (data[i] === 0) return i - 3;
    return -1;
  }

  async function rgbAt(blob: Blob, idx: number): Promise<[number, number, number]> {
    const bitmap = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return [data[idx]!, data[idx + 1]!, data[idx + 2]!];
  }

  it("composites onto white for JPEG rather than leaving it black", async () => {
    // Regression. mozjpeg ignores the alpha byte instead of erroring, so a
    // transparent pixel encoded as whatever RGB sat underneath it — which for a
    // transparent PNG is (0,0,0). Every logo with a transparent background came
    // out of here on a black one, and nothing failed or warned.
    const file = await fixture("graphic-alpha.png");
    const idx = await firstTransparent(new Blob([await file.arrayBuffer()], { type: "image/png" }));
    expect(idx, "fixture has no transparent pixel — this test proves nothing").toBeGreaterThan(-1);

    const jpeg = await convert(file, "png", "jpeg", {}, () => {});
    const [r, g, b] = await rgbAt(jpeg.blob, idx);

    // JPEG is lossy, so exact 255 is not guaranteed at a colour boundary.
    // Near-white is the assertion; near-black is the bug.
    expect(
      Math.min(r, g, b),
      `transparent pixel encoded as rgb(${r},${g},${b}) — should be near white`,
    ).toBeGreaterThan(200);
  }, 60_000);

  it("keeps the alpha channel for targets that have one", async () => {
    const file = await fixture("graphic-alpha.png");
    const idx = await firstTransparent(new Blob([await file.arrayBuffer()], { type: "image/png" }));

    for (const target of ["webp", "png", "avif"] as const) {
      const out = await convert(file, "png", target, {}, () => {});
      expect(await firstTransparent(out.blob), `${target} lost the alpha channel`).toBeGreaterThan(
        -1,
      );
      expect(idx).toBeGreaterThan(-1);
    }
  }, 120_000);
});

describe("metadata", () => {
  /** Does this JPEG carry an APP1/Exif segment? */
  function hasExif(bytes: Uint8Array): boolean {
    const text = Array.from(bytes.slice(0, 4096), (b) => String.fromCharCode(b)).join("");
    return text.includes("Exif");
  }

  it("removes EXIF from images whether or not the box is ticked", async () => {
    // The Strip metadata checkbox is honoured only by the ffmpeg engine. Images
    // go decode-to-pixels then re-encode, which discards EXIF as a side effect
    // and cannot preserve it. That is the right default — a photo carries the
    // GPS coordinates of where it was taken — but the UI must not imply the
    // control does something here, and this test is what pins that down.
    const file = await fixture("rotated-exif.jpg");
    expect(hasExif(new Uint8Array(await file.arrayBuffer())), "fixture has no EXIF").toBe(true);

    for (const strip of [true, false]) {
      const out = await convert(file, "jpeg", "jpeg", { stripMetadata: strip }, () => {});
      expect(
        hasExif(new Uint8Array(await out.blob.arrayBuffer())),
        `stripMetadata: ${strip} left EXIF in the output`,
      ).toBe(false);
    }
  }, 60_000);
});

import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { detectFormat, FORMATS } from "./formats";

/**
 * Guards on the test corpus itself.
 *
 * The full conversion matrix (16 sources × 4 targets) needs real wasm codecs and
 * therefore a real browser — that suite lives in browser mode. What CAN be
 * asserted in node is that the corpus is present, complete, and that every file
 * in it is recognised by the format detector. A corpus that quietly loses a file
 * turns a failing conversion into a passing test, which is worse than no test.
 *
 * This was learned the hard way: an earlier fixture lived outside `public/`, so
 * fetching it returned the dev server's HTML fallback. Every conversion "failed"
 * and the codecs were blamed for twenty minutes. The file was 4,305 bytes when
 * the fixture is 85.
 */

const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;

/** name → the format detectFormat must return, and the expected dimensions. */
const EXPECTED: Record<string, { format: string; dim: string }> = {
  "photo.png": { format: "png", dim: "640x480" },
  "photo.jpg": { format: "jpeg", dim: "640x480" },
  "photo.webp": { format: "webp", dim: "640x480" },
  "photo.avif": { format: "avif", dim: "640x480" },
  "photo.heic": { format: "heic", dim: "640x480" },
  "photo.tiff": { format: "tiff", dim: "640x480" },
  "photo.bmp": { format: "bmp", dim: "640x480" },
  "graphic-alpha.png": { format: "png", dim: "320x320" },
  "graphic-alpha.webp": { format: "webp", dim: "320x320" },
  "graphic-alpha.heic": { format: "heic", dim: "320x320" },
  "greyscale.png": { format: "png", dim: "640x480" },
  "palette.png": { format: "png", dim: "640x480" },
  "icon.ico": { format: "ico", dim: "64x64" },
  "animated.gif": { format: "gif", dim: "120x120" },
  "rotated-exif.jpg": { format: "jpeg", dim: "480x640" },
  "two-page.pdf": { format: "pdf", dim: "n/a" },
  "vector.svg": { format: "svg", dim: "320x320" },
  "tiny-1x1.png": { format: "png", dim: "1x1" },
};

describe("test corpus", () => {
  const present = readdirSync(FIXTURES).filter(
    (f) => !f.endsWith(".py") && !f.endsWith(".md"),
  );

  it("has every expected fixture on disk", () => {
    for (const name of Object.keys(EXPECTED)) {
      expect(present, `${name} missing — run: python3 fixtures/generate.py`).toContain(name);
    }
  });

  it("has no undocumented fixtures", () => {
    // A file nobody documented is a file nobody tests.
    for (const name of present) {
      expect(EXPECTED[name], `${name} is in fixtures/ but not documented`).toBeDefined();
    }
  });

  it("detects the right format for every fixture from its filename", () => {
    for (const [name, exp] of Object.entries(EXPECTED)) {
      expect(detectFormat({ name }), `${name}`).toBe(exp.format);
    }
  });

  it("every fixture is non-empty and plausibly sized", () => {
    for (const name of Object.keys(EXPECTED)) {
      const bytes = statSync(join(FIXTURES, name)).size;
      expect(bytes, `${name} is empty`).toBeGreaterThan(0);
      // The HTML-fallback trap: a 4 KB "image" that is actually a web page.
      // Real fixtures here are either tiny (1x1, svg) or clearly larger.
      expect(bytes, `${name} suspiciously small`).toBeGreaterThan(50);
    }
  });

  it("stays within the committed-corpus budget", () => {
    const total = Object.keys(EXPECTED).reduce(
      (sum, name) => sum + statSync(join(FIXTURES, name)).size,
      0,
    );
    // BATTLEPLAN P1 budgets < 5 MB committed.
    expect(total).toBeLessThan(5 * 1024 * 1024);
  });

  it("covers every decodable format in the registry", () => {
    // If a format is added to the registry, the corpus must gain a fixture for
    // it — otherwise it ships untested and the /formats page lies.
    const covered = new Set(Object.values(EXPECTED).map((e) => e.format));
    for (const f of Object.values(FORMATS)) {
      if (f.decodable) {
        expect(covered, `no fixture covers decodable format "${f.id}"`).toContain(f.id);
      }
    }
  });
});

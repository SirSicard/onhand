import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { unzipSync } from "fflate";
import { saveZip } from "./download";

/**
 * The zip path, in a real browser.
 *
 * Asserts the archive is READABLE and complete, not merely that bytes came
 * back. A zip with a valid header and truncated entries passes the lazy
 * version of this test and fails on the user's desktop.
 *
 * `showSaveFilePicker` is absent in headless Chromium, so these exercise the
 * fallback path — which is the one most users get anyway.
 */

let clicked: { name: string; url: string } | null = null;
let realCreate: typeof URL.createObjectURL;
let revoked: string[] = [];

beforeEach(() => {
  clicked = null;
  revoked = [];
  realCreate = URL.createObjectURL;
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((u) => revoked.push(u));
  // Intercept the synthetic click so the browser doesn't actually download.
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked = { name: this.download, url: this.href };
  });
});

afterEach(() => vi.restoreAllMocks());

async function zipOf(entries: { filename: string; blob: Blob }[]) {
  const ok = await saveZip(entries, "onhand.zip");
  expect(ok).toBe(true);
  expect(clicked, "no download was triggered").not.toBeNull();
  const blob = await fetch(clicked!.url).then((r) => r.blob());
  return unzipSync(new Uint8Array(await blob.arrayBuffer()));
}

const text = (s: string) => new Blob([s], { type: "text/plain" });

describe("saveZip", () => {
  it("produces an archive every entry can be read back from", async () => {
    const files = await zipOf([
      { filename: "a.txt", blob: text("alpha") },
      { filename: "b.txt", blob: text("bravo") },
      { filename: "c.txt", blob: text("charlie") },
    ]);

    expect(Object.keys(files).sort()).toEqual(["a.txt", "b.txt", "c.txt"]);
    expect(new TextDecoder().decode(files["a.txt"])).toBe("alpha");
    expect(new TextDecoder().decode(files["c.txt"])).toBe("charlie");
  });

  it("names it a .zip and revokes the URL rather than leaking it", async () => {
    await zipOf([{ filename: "a.txt", blob: text("x") }]);
    expect(clicked!.name).toBe("onhand.zip");
    // Revocation is deferred, so drive the timer rather than waiting 30s.
    vi.useFakeTimers();
    vi.advanceTimersByTime(31_000);
    vi.useRealTimers();
  });

  it("disambiguates entries that share a name", async () => {
    // photo.png and photo.jpg both convert to photo.webp. Zip allows the
    // duplicate; extractors disagree about what to do with it, and some keep
    // only one — silently losing a file the user converted.
    const files = await zipOf([
      { filename: "photo.webp", blob: text("first") },
      { filename: "photo.webp", blob: text("second") },
      { filename: "photo.webp", blob: text("third") },
    ]);

    expect(Object.keys(files).sort()).toEqual([
      "photo (2).webp",
      "photo (3).webp",
      "photo.webp",
    ]);
    expect(new TextDecoder().decode(files["photo.webp"])).toBe("first");
    expect(new TextDecoder().decode(files["photo (2).webp"])).toBe("second");
  });

  it("preserves bytes exactly for binary content", async () => {
    // Entries are STORED rather than deflated. A bug there would corrupt every
    // output, and text entries are too forgiving to catch it.
    const bytes = new Uint8Array(64 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7 + 13) & 0xff;

    const files = await zipOf([
      { filename: "blob.bin", blob: new Blob([bytes], { type: "application/octet-stream" }) },
    ]);
    expect(files["blob.bin"]!.length).toBe(bytes.length);
    expect(Array.from(files["blob.bin"]!.slice(0, 16))).toEqual(Array.from(bytes.slice(0, 16)));
    expect(Array.from(files["blob.bin"]!.slice(-16))).toEqual(Array.from(bytes.slice(-16)));
  });

  it("handles a 20-file batch without stalling", async () => {
    // AC-P3: a zip of 20 outputs streams without a memory spike. 1 MB each is
    // enough to catch an accidental full-buffer concat.
    const entries = Array.from({ length: 20 }, (_, i) => ({
      filename: `file-${i}.bin`,
      blob: new Blob([new Uint8Array(1024 * 1024).fill(i)]),
    }));

    const started = performance.now();
    const files = await zipOf(entries);
    const elapsed = performance.now() - started;

    expect(Object.keys(files)).toHaveLength(20);
    expect(files["file-7.bin"]!.length).toBe(1024 * 1024);
    expect(files["file-7.bin"]![0]).toBe(7);
    expect(elapsed, `20 MB took ${elapsed.toFixed(0)}ms`).toBeLessThan(20_000);
  }, 60_000);

  it("reports progress once per entry, in order", async () => {
    const seen: number[] = [];
    await saveZip(
      [
        { filename: "a", blob: text("1") },
        { filename: "b", blob: text("2") },
        { filename: "c", blob: text("3") },
      ],
      "x.zip",
      (done) => seen.push(done),
    );
    expect(seen).toEqual([1, 2, 3]);
  });

  it("refuses an empty set rather than producing a zip of nothing", async () => {
    expect(await saveZip([], "empty.zip")).toBe(false);
    expect(clicked).toBeNull();
  });
});

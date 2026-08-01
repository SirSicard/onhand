import { describe, it, expect } from "vitest";
import {
  detectFormat,
  defaultTargetFor,
  renameTo,
  encodableFormats,
  FORMATS,
} from "./formats";

describe("detectFormat", () => {
  it("identifies by extension, case-insensitively", () => {
    expect(detectFormat({ name: "photo.JPG" })).toBe("jpeg");
    expect(detectFormat({ name: "shot.jpeg" })).toBe("jpeg");
    expect(detectFormat({ name: "icon.SVG" })).toBe("svg");
  });

  it("prefers extension over MIME type", () => {
    // Browsers lie about HEIC constantly: empty string on some builds,
    // application/octet-stream on others. The extension is the reliable signal,
    // and HEIC is the format we can least afford to misidentify.
    expect(detectFormat({ name: "IMG_0421.HEIC", type: "" })).toBe("heic");
    expect(detectFormat({ name: "IMG_0421.heic", type: "application/octet-stream" })).toBe("heic");
    expect(detectFormat({ name: "IMG_0421.heif", type: "" })).toBe("heic");
  });

  it("falls back to MIME when the extension is missing", () => {
    expect(detectFormat({ name: "clipboard-paste", type: "image/png" })).toBe("png");
  });

  it("returns undefined for genuinely unknown files rather than guessing", () => {
    expect(detectFormat({ name: "notes.xyz", type: "" })).toBeUndefined();
    expect(detectFormat({ name: "noextension" })).toBeUndefined();
  });

  it("handles filenames containing dots", () => {
    expect(detectFormat({ name: "my.holiday.photo.png" })).toBe("png");
  });
});

describe("defaultTargetFor", () => {
  it("sends HEIC to JPEG — the reason most people arrive", () => {
    expect(defaultTargetFor("heic")).toBe("jpeg");
  });

  it("never proposes a target we cannot encode", () => {
    for (const id of Object.keys(FORMATS) as (keyof typeof FORMATS)[]) {
      expect(FORMATS[defaultTargetFor(id)].encodable).toBe(true);
    }
  });

  it("proposes something different from the source for lossless-in formats", () => {
    // Defaulting BMP→BMP would be a wasted click; the user came here to change it.
    expect(defaultTargetFor("bmp")).not.toBe("bmp");
    expect(defaultTargetFor("svg")).not.toBe("svg");
  });
});

describe("renameTo", () => {
  it("swaps the extension and keeps the stem", () => {
    expect(renameTo("IMG_0421.HEIC", "jpeg")).toBe("IMG_0421.jpg");
    expect(renameTo("my.holiday.photo.png", "webp")).toBe("my.holiday.photo.webp");
  });

  it("appends when there is no extension", () => {
    expect(renameTo("screenshot", "png")).toBe("screenshot.png");
  });

  it("does not treat a leading dot as an extension separator", () => {
    expect(renameTo(".hidden", "png")).toBe(".hidden.png");
  });
});

describe("format registry integrity", () => {
  it("every encodable format has a decoder path too", () => {
    // A format we can write but not read would produce a one-way trap in the
    // pair matrix, which the /formats page generates from this table.
    for (const f of encodableFormats()) {
      expect(f.decodable, `${f.id} is encodable but not decodable`).toBe(true);
    }
  });

  it("has no duplicate extensions across formats", () => {
    const seen = new Map<string, string>();
    for (const f of Object.values(FORMATS)) {
      for (const ext of f.extensions) {
        expect(seen.has(ext), `extension .${ext} claimed by both ${seen.get(ext)} and ${f.id}`).toBe(
          false,
        );
        seen.set(ext, f.id);
      }
    }
  });

  it("keeps the canonical extension inside the extension list", () => {
    for (const f of Object.values(FORMATS)) {
      expect(f.extensions).toContain(f.ext);
    }
  });
});

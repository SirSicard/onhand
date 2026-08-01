import { describe, it, expect } from "vitest";
import { assertWithinMemoryBudget, estimatePeakMemory, LIMIT_BYTES, WARN_BYTES } from "./memory";
import { ConversionError } from "./types";

const MB = 1024 ** 2;
const GB = 1024 ** 3;

describe("memory guardrail", () => {
  it("lets ordinary files through without comment", () => {
    // The sizes people actually convert. If any of these warn, the guardrail is
    // miscalibrated and will cry wolf until users learn to ignore it.
    const ordinary: [number, "mp4" | "jpeg" | "mp3"][] = [
      [4 * MB, "jpeg"],
      [12 * MB, "mp3"],
      [80 * MB, "mp4"],
    ];
    for (const [size, format] of ordinary) {
      const est = estimatePeakMemory(size, format, format === "jpeg" ? "png" : "mp4");
      expect(est.warn, `${size / MB} MB ${format} should not warn`).toBe(false);
      expect(est.exceeds).toBe(false);
    }
  });

  it("warns before it refuses", () => {
    // There must be a band where we proceed but say something, otherwise the
    // only feedback is a hard no at an arbitrary boundary.
    expect(WARN_BYTES).toBeLessThan(LIMIT_BYTES);
  });

  it("refuses a file that would need more memory than a tab has", () => {
    const est = estimatePeakMemory(2 * GB, "mp4", "webm");
    expect(est.exceeds).toBe(true);
    expect(() => assertWithinMemoryBudget(2 * GB, "mp4", "webm")).toThrow(ConversionError);
  });

  it("costs the more expensive side of the conversion, not just the input", () => {
    // A modest video going to WAV explodes on OUTPUT — PCM is huge. Looking
    // only at the source would wave it through and then crash the tab.
    const toWav = estimatePeakMemory(200 * MB, "mp4", "wav");
    const toMp4 = estimatePeakMemory(200 * MB, "mp4", "mp4");
    expect(toWav.peakBytes).toBeGreaterThan(toMp4.peakBytes);
  });

  it("explains itself in the refusal, with numbers", () => {
    // "Too large" with no figure is indistinguishable from a broken tool.
    try {
      assertWithinMemoryBudget(3 * GB, "mov", "mp4");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConversionError);
      const e = err as ConversionError;
      expect(e.kind).toBe("too-large");
      expect(e.suggestion).toMatch(/GB/);
      // And it must say what would actually work, not just what didn't.
      expect(e.suggestion).toMatch(/trim|split/i);
    }
  });
});

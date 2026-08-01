import { describe, it, expect } from "vitest";
import { maxConcurrency, VIDEO_LADDERS, type Capabilities } from "./capabilities";

const yes = (codec: string) => ({ supported: true, codec });
const no = { supported: false } as const;

const base: Capabilities = {
  crossOriginIsolated: true,
  sharedArrayBuffer: true,
  deviceMemoryGb: 16,
  hardwareConcurrency: 10,
  fileSystemAccess: true,
  webCodecs: {
    available: true,
    videoDecode: { h264: yes("avc1.42E01E"), vp9: yes("vp09.00.10.08"), av1: no },
    videoEncode: { h264: yes("avc1.640028"), vp9: yes("vp09.00.10.08"), av1: no },
    audioDecode: { aac: yes("mp4a.40.2"), opus: yes("opus") },
    audioEncode: { aac: yes("mp4a.40.2"), opus: yes("opus") },
  },
  memoryConstrainedPlatform: false,
};

describe("codec ladders", () => {
  it("probes H.264 High, not just Baseline", () => {
    // Measured 2026-08-01: Chromium reports H.264 encode UNSUPPORTED for
    // Baseline and Main but SUPPORTED for High (avc1.640028) — hardware
    // encoders commonly expose only High. Probing one "safe" profile produced
    // a false negative that would have demoted every mp4 job to ffmpeg.wasm.
    // If this ladder ever loses High, that regression comes straight back.
    expect(VIDEO_LADDERS.h264).toContain("avc1.640028");
  });

  it("orders H.264 most-playback-compatible first", () => {
    // We want the tamest profile that works, so Baseline must be tried before
    // High — we only climb when nothing tamer is available.
    const l = VIDEO_LADDERS.h264;
    expect(l.indexOf("avc1.42E01E")).toBeLessThan(l.indexOf("avc1.640028"));
  });
});

describe("maxConcurrency", () => {
  it("caps at 3 even on a very wide machine", () => {
    // Each ffmpeg.wasm instance can hold ~2 GB. Unbounded concurrency is how you
    // OOM the tab instead of the job.
    expect(maxConcurrency({ ...base, hardwareConcurrency: 32 })).toBe(3);
  });

  it("scales down with core count", () => {
    expect(maxConcurrency({ ...base, hardwareConcurrency: 4 })).toBe(2);
  });

  it("never returns less than 1", () => {
    expect(maxConcurrency({ ...base, hardwareConcurrency: 1 })).toBe(1);
  });

  it("forces serial on memory-constrained platforms", () => {
    // iOS has a hard per-tab ceiling; two video jobs is a crash, not a slowdown.
    expect(
      maxConcurrency({ ...base, memoryConstrainedPlatform: true, hardwareConcurrency: 10 }),
    ).toBe(1);
  });

  it("forces serial on low-RAM devices", () => {
    expect(maxConcurrency({ ...base, deviceMemoryGb: 4 })).toBe(1);
  });

  it("treats unknown deviceMemory as not-low rather than assuming the worst", () => {
    // deviceMemory is Chromium-only. Firefox/Safari report undefined, and those
    // are not low-memory machines by default — degrading everyone to serial
    // because one browser withholds a number would be the wrong trade.
    expect(maxConcurrency({ ...base, deviceMemoryGb: undefined })).toBe(3);
  });
});

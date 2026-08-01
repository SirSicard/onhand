import { describe, it, expect } from "vitest";
import { convert } from "./broker";
import { detectFormat, type FormatId } from "./formats";

/**
 * Audio and video, in a real browser, against real files.
 *
 * Two engines can serve any of these pairs, and which one runs depends on the
 * browser: Chrome and Safari encode AAC and H.264 in hardware, Firefox does
 * not. So these tests assert the OUTPUT is correct and separately record which
 * engine produced it — asserting a specific engine everywhere would just encode
 * today's browser support into the suite and fail on the next release.
 *
 * What is asserted without exception: the file decodes, and it still has the
 * tracks it started with. A "converted" video whose audio is silent is the
 * signature failure of this entire category of tool.
 */

async function fixture(name: string): Promise<File> {
  const res = await fetch(`/fixtures/${name}`);
  if (!res.ok) throw new Error(`fixture ${name} missing (${res.status})`);
  const buf = await res.arrayBuffer();
  const head = new TextDecoder().decode(buf.slice(0, 64));
  if (/^\s*<!doctype html|^\s*<html/i.test(head)) {
    throw new Error(`fixture ${name} was served as HTML, not file bytes`);
  }
  return new File([buf], name);
}

/**
 * Decode the output with mediabunny and report what is actually inside it.
 *
 * Deliberately not using an <audio>/<video> element: those report readyState on
 * metadata alone, so a file with a valid header and no frames looks fine.
 */
async function inspect(blob: Blob) {
  const { Input, BlobSource, ALL_FORMATS } = await import("mediabunny");
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const [video, audio, duration] = await Promise.all([
    input.getPrimaryVideoTrack(),
    input.getPrimaryAudioTrack(),
    input.computeDuration(),
  ]);
  return {
    hasVideo: video !== null,
    hasAudio: audio !== null,
    duration,
    width: video?.displayWidth ?? 0,
    height: video?.displayHeight ?? 0,
    videoCodec: video?.codec ?? null,
    audioCodec: audio?.codec ?? null,
  };
}

/** Fixtures are 2s; encoders trim or pad a little, so allow a window. */
function isAboutTwoSeconds(duration: number): boolean {
  return duration > 1.2 && duration < 3.0;
}

const AUDIO_SOURCES: [string, FormatId][] = [
  ["tone.wav", "wav"],
  ["tone.mp3", "mp3"],
  ["tone.m4a", "m4a"],
  ["tone.aac", "aac"],
  ["tone.ogg", "ogg"],
  ["tone.opus", "opus"],
  ["tone.flac", "flac"],
];

const AUDIO_TARGETS: FormatId[] = ["mp3", "wav", "m4a", "opus", "flac"];

describe("audio conversion matrix", () => {
  for (const [name, source] of AUDIO_SOURCES) {
    describe(name, () => {
      it("is detected as the right format", async () => {
        expect(detectFormat(await fixture(name))).toBe(source);
      });

      for (const target of AUDIO_TARGETS) {
        it(`converts to ${target}`, async () => {
          const file = await fixture(name);
          const result = await convert(file, source, target, {}, () => {});
          expect(result.bytesOut).toBeGreaterThan(0);

          const info = await inspect(result.blob);
          // The whole point: audio in, audio out. An empty container that
          // reports the right MIME type is the failure this catches.
          expect(info.hasAudio, `${name} -> ${target} lost its audio track`).toBe(true);
          expect(
            isAboutTwoSeconds(info.duration),
            `${name} -> ${target} duration ${info.duration.toFixed(2)}s`,
          ).toBe(true);
        }, 90_000);
      }
    });
  }
});

describe("video conversion", () => {
  const VIDEO_SOURCES: [string, FormatId][] = [
    ["clip.mp4", "mp4"],
    ["clip.mov", "mov"],
    ["clip.webm", "webm"],
    ["clip.mkv", "mkv"],
    ["clip.avi", "avi"],
  ];

  for (const [name, source] of VIDEO_SOURCES) {
    it(`${name} -> mp4 keeps both tracks and its dimensions`, async () => {
      const file = await fixture(name);
      const result = await convert(file, source, "mp4", {}, () => {});

      const info = await inspect(result.blob);
      expect(info.hasVideo, `${name} lost its video track`).toBe(true);
      expect(info.hasAudio, `${name} lost its audio track`).toBe(true);
      expect(`${info.width}x${info.height}`).toBe("640x360");
      expect(isAboutTwoSeconds(info.duration), `duration ${info.duration}`).toBe(true);
    }, 180_000);
  }

  it("converts mp4 to webm", async () => {
    const result = await convert(await fixture("clip.mp4"), "mp4", "webm", {}, () => {});
    const info = await inspect(result.blob);
    expect(info.hasVideo).toBe(true);
    expect(info.hasAudio).toBe(true);
  }, 180_000);

  it("handles a video with no audio track at all", async () => {
    // A pipeline that assumes one track of each kind throws here rather than on
    // someone's screen recording.
    const result = await convert(await fixture("silent.mp4"), "mp4", "webm", {}, () => {});
    const info = await inspect(result.blob);
    expect(info.hasVideo).toBe(true);
    expect(info.hasAudio).toBe(false);
  }, 180_000);

  it("handles odd dimensions without failing on the H.264 even-size rule", async () => {
    const result = await convert(await fixture("portrait-odd.mp4"), "mp4", "mp4", {}, () => {});
    const info = await inspect(result.blob);
    expect(info.hasVideo).toBe(true);
    // 607x1079 must round to even; which way is the encoder's business, but it
    // must stay within a pixel and stay portrait.
    expect(info.width).toBeGreaterThanOrEqual(606);
    expect(info.width).toBeLessThanOrEqual(608);
    expect(info.height).toBeGreaterThan(info.width);
  }, 180_000);

  it("respects rotation metadata rather than emitting a sideways video", async () => {
    // The source is 640x360 with a 90° display matrix, so the right answer is
    // 360x640. Getting this wrong is the single most-reported bug in every
    // converter that handles phone video.
    const result = await convert(await fixture("rotated.mov"), "mov", "mp4", {}, () => {});
    const info = await inspect(result.blob);
    expect(`${info.width}x${info.height}`).toBe("360x640");
  }, 180_000);
});

describe("audio extraction", () => {
  for (const target of ["mp3", "m4a", "wav"] as FormatId[]) {
    it(`pulls ${target} out of a video`, async () => {
      const result = await convert(await fixture("clip.mp4"), "mp4", target, {}, () => {});
      const info = await inspect(result.blob);
      expect(info.hasAudio).toBe(true);
      // The video track must be gone — carrying it silently would make the
      // "audio" file many times larger than it should be.
      expect(info.hasVideo, "video track should have been dropped").toBe(false);
    }, 180_000);
  }
});

describe("progress reporting", () => {
  it("reports progress that only ever moves forward, and never fakes it", async () => {
    const seen: (number | null)[] = [];
    await convert(await fixture("clip.mp4"), "mp4", "webm", {}, (u) => seen.push(u.progress));

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)).toBe(1);

    // Monotonic where numeric. A bar that goes backwards reads as a bug even
    // when the conversion is fine.
    const numeric = seen.filter((p): p is number => typeof p === "number");
    for (let i = 1; i < numeric.length; i++) {
      expect(numeric[i]!, `progress went backwards at ${i}`).toBeGreaterThanOrEqual(
        numeric[i - 1]!,
      );
    }
    // null is allowed (indeterminate) but a number outside 0..1 is not.
    for (const p of numeric) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  }, 180_000);
});

describe("engine routing", () => {
  // The user never picks an engine and never sees one named. These assertions
  // exist because the routing is a promise about speed and download size, and a
  // silent regression to "everything goes through ffmpeg" would still pass every
  // correctness test above while making the whole thing slow and 32 MB heavier.

  it("never uses ffmpeg for a pair WebCodecs can do", async () => {
    // WAV output needs no encoder at all — PCM is just bytes. If this ever
    // routes to ffmpeg, the WebCodecs path has broken somewhere upstream.
    const result = await convert(await fixture("clip.mp4"), "mp4", "wav", {}, () => {});
    expect(result.engineId).toBe("webcodecs");
  }, 180_000);

  it("uses ffmpeg for MP3, because no browser can encode it", async () => {
    const result = await convert(await fixture("tone.wav"), "wav", "mp3", {}, () => {});
    expect(result.engineId).toBe("ffmpeg");
  }, 180_000);

  it("uses ffmpeg for AVI, which mediabunny cannot demux", async () => {
    const result = await convert(await fixture("clip.avi"), "avi", "mp4", {}, () => {});
    expect(result.engineId).toBe("ffmpeg");
  }, 180_000);

  it("records which engine handled mov -> mp4 in this browser", async () => {
    // Chrome and Safari encode H.264 and AAC in hardware and should take the
    // WebCodecs path; Firefox has no AAC encoder and must fall through. Both
    // are correct, so this asserts only that SOME engine did it and prints
    // which — pinning a browser to an engine here would fail on the next
    // Firefox release that adds AAC, which is not a regression.
    const result = await convert(await fixture("clip.mov"), "mov", "mp4", {}, () => {});
    console.log(`mov -> mp4 handled by: ${result.engineId} in ${result.durationMs}ms`);
    expect(["webcodecs", "ffmpeg"]).toContain(result.engineId);
    const info = await inspect(result.blob);
    expect(info.hasVideo && info.hasAudio).toBe(true);
  }, 180_000);
});

describe("failure behaviour", () => {
  it("refuses a file too large to convert, before doing any work", async () => {
    // A 4 GB video would need far more memory than a tab has. The refusal must
    // be instant — the failure mode being prevented is a crashed tab twenty
    // minutes in, which takes the whole queue with it.
    const huge = new File([new Uint8Array(1024)], "huge.mp4", { type: "video/mp4" });
    Object.defineProperty(huge, "size", { value: 4 * 1024 ** 3 });

    const started = performance.now();
    await expect(convert(huge, "mp4", "webm", {}, () => {})).rejects.toThrow(/too large/i);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("rejects a corrupt media file with a human sentence", async () => {
    const junk = new File([new Uint8Array(2048)], "broken.mp4", { type: "video/mp4" });
    await expect(convert(junk, "mp4", "mp3", {}, () => {})).rejects.toThrow(/could not|failed/i);
  }, 180_000);
});

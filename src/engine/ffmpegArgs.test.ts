import { describe, it, expect } from "vitest";
import { buildArgs } from "./engines/ffmpegEngine";

/**
 * The quality control, checked where it was broken.
 *
 * It shipped applying to nothing on the video track: no -crf reached libx264 or
 * libvpx-vp9, so Smallest, Balanced and Best encoded byte-identical pictures and
 * only the audio bitrate moved. These assertions are on the args because that is
 * where the instruction either exists or does not.
 */
const crfOf = (args: string[]) => {
  const i = args.indexOf("-crf");
  return i === -1 ? null : Number(args[i + 1]);
};

describe("video quality reaches the encoder", () => {
  it("sets a CRF that falls as quality rises, for every video target", () => {
    for (const target of ["mp4", "mov", "mkv", "webm"] as const) {
      const crfs = [55, 80, 95].map((quality) =>
        crfOf(buildArgs("in.mp4", `out.${target}`, "mp4", target, { quality })),
      );
      expect(
        crfs.every((c) => c !== null),
        `${target} passes no -crf at all`,
      ).toBe(true);
      const [low, mid, high] = crfs as [number, number, number];
      // Lower CRF means better quality, so the numbers must descend.
      expect(low, `${target}: Smallest and Balanced share a CRF`).toBeGreaterThan(mid);
      expect(mid, `${target}: Balanced and Best share a CRF`).toBeGreaterThan(high);
    }
  });

  it("puts VP9 in constant-quality mode, where CRF is the target rather than a cap", () => {
    // libvpx-vp9 honours -crf as constant quality only when the bitrate is 0.
    // Without this it runs constrained-quality and the CRF becomes an upper
    // bound, which silently weakens the control rather than breaking it.
    const args = buildArgs("in.mp4", "out.webm", "mp4", "webm", { quality: 80 });
    expect(args[args.indexOf("-b:v") + 1]).toBe("0");
  });

  it("lets an explicit bitrate win over the preset", () => {
    const args = buildArgs("in.mp4", "out.mp4", "mp4", "mp4", {
      quality: 55,
      videoBitrateKbps: 1234,
    });
    expect(args).toContain("1234k");
    expect(crfOf(args), "both -b:v and -crf would fight each other").toBeNull();
  });

  it("leaves audio-only jobs alone — there is no video track to grade", () => {
    const args = buildArgs("in.mp4", "out.mp3", "mp4", "mp3", { quality: 55 });
    expect(crfOf(args)).toBeNull();
    expect(args).toContain("-vn");
  });
});

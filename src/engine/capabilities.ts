/**
 * Runtime capability probe.
 *
 * Everything here is feature-detected, never UA-sniffed. Browser support for
 * WebCodecs varies not just by browser but by *codec config* within a browser —
 * Safari 16.4-18.7 ships video interfaces but not audio; AAC encoding is absent
 * in Firefox everywhere and in every browser on desktop Linux (RESEARCH §2).
 * A UA table would be wrong within a release cycle, so we ask the browser.
 *
 * The result is cached for the session: `isConfigSupported` is async and we call
 * it a dozen times, but the answers cannot change while the tab is open.
 */

export interface Capabilities {
  /** COOP+COEP active. Gates SharedArrayBuffer, therefore multithreaded ffmpeg. */
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  /** Rough RAM in GB. Chromium-only; undefined elsewhere, so treat as unknown-not-low. */
  deviceMemoryGb: number | undefined;
  hardwareConcurrency: number;
  /** showSaveFilePicker — lets us stream output to disk instead of holding it in RAM. */
  fileSystemAccess: boolean;
  webCodecs: {
    available: boolean;
    videoDecode: Record<VideoCodecKey, CodecSupport>;
    videoEncode: Record<VideoCodecKey, CodecSupport>;
    audioDecode: Record<AudioCodecKey, CodecSupport>;
    audioEncode: Record<AudioCodecKey, CodecSupport>;
  };
  /** iOS/iPadOS have hard per-tab memory limits; we cap concurrency to 1 there. */
  memoryConstrainedPlatform: boolean;
}

export type VideoCodecKey = "h264" | "vp9" | "av1";
export type AudioCodecKey = "aac" | "opus";

/**
 * Support is per-PROFILE, not per-codec — and not in the direction you'd guess.
 *
 * Measured 2026-08-01 in Chromium: H.264 encode reports **false** for Baseline
 * (avc1.42E01E) and Main (avc1.4D401E) but **true** for High (avc1.640028).
 * Hardware encoders commonly expose only High. Probing the "safest" profile
 * therefore produces a false negative and silently demotes every mp4 job to
 * ffmpeg.wasm at ~25fps/100% CPU on a machine that could have done it in
 * hardware.
 *
 * So: walk a ladder per codec and keep the exact string that answered yes. The
 * encoder is configured with that string later — never with a guess.
 *
 * Ladders are ordered most-playback-compatible first, so we only climb to
 * exotic profiles when nothing tamer is available.
 */
export const VIDEO_LADDERS: Record<VideoCodecKey, string[]> = {
  h264: [
    "avc1.42E01E", // Baseline L3.0 — plays on anything, incl. old Android
    "avc1.4D401E", // Main L3.0
    "avc1.640028", // High L4.0 — what hardware encoders usually expose
  ],
  vp9: ["vp09.00.10.08"],
  av1: ["av01.0.04M.08"],
};

const AUDIO_LADDERS: Record<AudioCodecKey, string[]> = {
  aac: ["mp4a.40.2"], // AAC-LC
  opus: ["opus"],
};

/** Which codec string actually works here, if any. */
export interface CodecSupport {
  supported: boolean;
  /** Pass this verbatim to VideoEncoder.configure() — do not reconstruct it. */
  codec?: string;
}

const NO: CodecSupport = { supported: false };

async function probeVideoLadder(
  ladder: string[],
  kind: "encode" | "decode",
): Promise<CodecSupport> {
  for (const codec of ladder) {
    try {
      if (kind === "encode") {
        // Some implementations only answer honestly for a *complete* config,
        // so bitrate and framerate are included rather than omitted.
        const res = await VideoEncoder.isConfigSupported({
          codec,
          width: 1280,
          height: 720,
          bitrate: 2_000_000,
          framerate: 30,
        });
        if (res.supported === true) return { supported: true, codec };
      } else {
        const res = await VideoDecoder.isConfigSupported({ codec });
        if (res.supported === true) return { supported: true, codec };
      }
    } catch {
      // Malformed *for this browser* is itself a "no". Keep walking the ladder;
      // never let a probe failure take down the page.
    }
  }
  return NO;
}

async function probeAudioLadder(
  ladder: string[],
  kind: "encode" | "decode",
): Promise<CodecSupport> {
  for (const codec of ladder) {
    try {
      const cfg = { codec, sampleRate: 48000, numberOfChannels: 2 };
      const res =
        kind === "encode"
          ? await AudioEncoder.isConfigSupported({ ...cfg, bitrate: 128_000 })
          : await AudioDecoder.isConfigSupported(cfg);
      if (res.supported === true) return { supported: true, codec };
    } catch {
      /* keep walking */
    }
  }
  return NO;
}

async function supportedVideo(
  kind: "encode" | "decode",
): Promise<Record<VideoCodecKey, CodecSupport>> {
  const keys = Object.keys(VIDEO_LADDERS) as VideoCodecKey[];
  const results = await Promise.all(
    keys.map((k) => probeVideoLadder(VIDEO_LADDERS[k], kind)),
  );
  return Object.fromEntries(keys.map((k, i) => [k, results[i] ?? NO])) as Record<
    VideoCodecKey,
    CodecSupport
  >;
}

async function supportedAudio(
  kind: "encode" | "decode",
): Promise<Record<AudioCodecKey, CodecSupport>> {
  const keys = Object.keys(AUDIO_LADDERS) as AudioCodecKey[];
  const results = await Promise.all(
    keys.map((k) => probeAudioLadder(AUDIO_LADDERS[k], kind)),
  );
  return Object.fromEntries(keys.map((k, i) => [k, results[i] ?? NO])) as Record<
    AudioCodecKey,
    CodecSupport
  >;
}

function detectMemoryConstrained(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS reports as Macintosh but has touch points; the memory ceiling is the
  // same either way, so treat both as constrained.
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/.test(ua);
  const iPadOSMasqueradingAsMac =
    /Macintosh/.test(ua) && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1;
  return iOS || iPadOSMasqueradingAsMac;
}

let cached: Promise<Capabilities> | undefined;

export function probeCapabilities(): Promise<Capabilities> {
  cached ??= (async (): Promise<Capabilities> => {
    const hasVideoCodecs =
      typeof globalThis.VideoEncoder !== "undefined" &&
      typeof globalThis.VideoDecoder !== "undefined";
    const hasAudioCodecs =
      typeof globalThis.AudioEncoder !== "undefined" &&
      typeof globalThis.AudioDecoder !== "undefined";

    const [videoDecode, videoEncode, audioDecode, audioEncode] = await Promise.all([
      hasVideoCodecs ? supportedVideo("decode") : emptyVideo(),
      hasVideoCodecs ? supportedVideo("encode") : emptyVideo(),
      hasAudioCodecs ? supportedAudio("decode") : emptyAudio(),
      hasAudioCodecs ? supportedAudio("encode") : emptyAudio(),
    ]);

    const nav = navigator as Navigator & { deviceMemory?: number };

    return {
      crossOriginIsolated: globalThis.crossOriginIsolated === true,
      sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
      deviceMemoryGb: nav.deviceMemory,
      hardwareConcurrency: navigator.hardwareConcurrency || 4,
      fileSystemAccess: typeof (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker === "function",
      webCodecs: {
        available: hasVideoCodecs,
        videoDecode,
        videoEncode,
        audioDecode,
        audioEncode,
      },
      memoryConstrainedPlatform: detectMemoryConstrained(),
    };
  })();
  return cached;
}

const emptyVideo = async (): Promise<Record<VideoCodecKey, CodecSupport>> => ({
  h264: NO,
  vp9: NO,
  av1: NO,
});
const emptyAudio = async (): Promise<Record<AudioCodecKey, CodecSupport>> => ({
  aac: NO,
  opus: NO,
});

/** Test seam — capabilities are cached for the session, so tests must reset. */
export function __resetCapabilitiesCache(): void {
  cached = undefined;
}

/**
 * How many jobs may run at once.
 *
 * Deliberately conservative: each ffmpeg.wasm instance can hold ~2 GB, so two
 * concurrent video jobs on an 8 GB machine is how you get an OOM that kills the
 * tab rather than the job.
 */
export function maxConcurrency(caps: Capabilities): number {
  if (caps.memoryConstrainedPlatform) return 1;
  const mem = caps.deviceMemoryGb;
  if (mem !== undefined && mem <= 4) return 1;
  return Math.max(1, Math.min(3, Math.floor(caps.hardwareConcurrency / 2)));
}

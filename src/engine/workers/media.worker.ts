import * as Comlink from "comlink";
import {
  ALL_FORMATS,
  AdtsOutputFormat,
  BlobSource,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  FlacOutputFormat,
  Input,
  MkvOutputFormat,
  MovOutputFormat,
  Mp3OutputFormat,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
  UnsupportedInputFormatError,
  WavOutputFormat,
  WebMOutputFormat,
  canDecodeAudio,
  canDecodeVideo,
  canEncodeAudio,
  canEncodeVideo,
  type AudioCodec,
  type ConversionAudioOptions,
  type ConversionOptions,
  type ConversionVideoOptions,
  type InputVideoTrack,
  type OutputFormat,
  type VideoCodec,
} from "mediabunny";
import type { FormatId } from "../formats";
import type { ConvertOptions } from "../types";

/**
 * The WebCodecs path: demux, decode, encode, mux — all through mediabunny, all
 * using the browser's own (usually hardware-accelerated) codecs.
 *
 * This engine is fast and adds no download, but it can only do what the browser
 * can do, and that varies a lot. Rather than maintaining a table of which
 * browser encodes what — which would be wrong within a release — we declare the
 * codec we want and ask `canEncode*` at runtime. When the answer is no, we say
 * so plainly and the broker falls through to ffmpeg.
 */

/** What each output container should be filled with, given a free choice. */
const CONTAINERS: Partial<
  Record<FormatId, { format: () => OutputFormat; video?: VideoCodec; audio?: AudioCodec }>
> = {
  // MP4/MOV: H.264 + AAC is the pair that plays on everything, which is the
  // entire reason someone converts to MP4.
  mp4: {
    format: () => new Mp4OutputFormat({ fastStart: "in-memory" }),
    video: "avc",
    audio: "aac",
  },
  mov: { format: () => new MovOutputFormat(), video: "avc", audio: "aac" },
  // WebM is defined as VP8/VP9/AV1 + Vorbis/Opus. Anything else in it is not a
  // WebM file, whatever the extension says.
  webm: { format: () => new WebMOutputFormat(), video: "vp9", audio: "opus" },
  mkv: { format: () => new MkvOutputFormat(), video: "avc", audio: "aac" },

  m4a: { format: () => new Mp4OutputFormat(), audio: "aac" },
  aac: { format: () => new AdtsOutputFormat(), audio: "aac" },
  // Most browsers have no MP3 encoder, so this entry is usually rejected by
  // canEncodeAudio and routed to ffmpeg — but some (GStreamer-backed WebKit)
  // accept it, and then this path is used and is much faster. Declaring the
  // codec and asking at runtime is exactly why that works without a change.
  mp3: { format: () => new Mp3OutputFormat(), audio: "mp3" },
  // Vorbis: Firefox encodes it, Chrome and Safari do not, so .ogg goes
  // whichever way the browser allows. Opus is widely supported.
  ogg: { format: () => new OggOutputFormat(), audio: "vorbis" },
  opus: { format: () => new OggOutputFormat(), audio: "opus" },
  flac: { format: () => new FlacOutputFormat(), audio: "flac" },
  // PCM needs no encoder at all, so WAV always works here.
  wav: { format: () => new WavOutputFormat(), audio: "pcm-s16" },
};

/**
 * Raised when this engine cannot do the job and ffmpeg should be tried.
 *
 * The name matters: Comlink rebuilds a thrown error on the other side as a
 * plain Error carrying `message` and `name`, so `instanceof` is useless across
 * the boundary and the name is what the engine matches on.
 */
class NotMyJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotMyJobError";
  }
}

/**
 * Bitrate defaults derived from the output, not imposed.
 *
 * A fixed default would silently re-encode a 320 kbps source down to 128, which
 * is data loss the person never asked for. These are floors for the case where
 * we genuinely have nothing to go on.
 */
function videoBitrate(width: number, height: number, opts: ConvertOptions): number {
  if (opts.videoBitrateKbps) return opts.videoBitrateKbps * 1000;
  const pixels = width * height;
  if (pixels >= 3840 * 2160) return 20_000_000;
  if (pixels >= 1920 * 1080) return 8_000_000;
  if (pixels >= 1280 * 720) return 5_000_000;
  return 2_500_000;
}

export interface MediaConvertResult {
  buffer: ArrayBuffer;
  /** Reported back so tests can assert which path actually ran. */
  engine: "webcodecs";
}

const active = new Map<string, Conversion>();

const api = {
  async convert(
    file: File,
    target: FormatId,
    options: ConvertOptions,
    jobId: string,
    onProgress: (p: number | null) => void,
  ): Promise<MediaConvertResult> {
    const container = CONTAINERS[target];
    if (!container) throw new NotMyJobError(`no container mapping for ${target}`);

    let input: Input;
    try {
      input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
      // Force the demuxer to actually look at the bytes now, so an unreadable
      // container fails here rather than halfway through a conversion.
      await input.getFormat();
    } catch (err) {
      if (err instanceof UnsupportedInputFormatError) {
        throw new NotMyJobError(`mediabunny cannot demux this container`);
      }
      throw err;
    }

    const wantsVideo = Boolean(container.video) && !options.audioOnly;
    const videoTrack = await input.getPrimaryVideoTrack();

    // DECODE first. Without this, mediabunny accepts a job it cannot actually
    // perform — `isValid` is true, then `execute()` fails partway — and the
    // broker hands it to ffmpeg, which on a loaded machine is where the wasm
    // heap runs out. Declining up front keeps the work on the cheap path where
    // the browser can do it and off ffmpeg entirely where it cannot.
    const audioTrack = await input.getPrimaryAudioTrack();
    if (audioTrack) {
      const codec = audioTrack.codec;
      if (codec && !(await canDecodeAudio(codec))) {
        throw new NotMyJobError(`browser cannot decode ${codec}`);
      }
    }
    if (wantsVideo && videoTrack) {
      const codec = videoTrack.codec;
      if (codec && !(await canDecodeVideo(codec))) {
        throw new NotMyJobError(`browser cannot decode ${codec}`);
      }
    }

    // Then encodability. mediabunny would also reject an impossible pair, but
    // checking here lets us name the missing codec, which is the difference
    // between a useful log line and a mystery.
    if (container.audio && !(await canEncodeAudio(container.audio))) {
      throw new NotMyJobError(`browser cannot encode ${container.audio}`);
    }
    if (wantsVideo && videoTrack && container.video && !(await canEncodeVideo(container.video))) {
      throw new NotMyJobError(`browser cannot encode ${container.video}`);
    }

    const output = new Output({ format: container.format(), target: new BufferTarget() });

    const audio: ConversionAudioOptions = {
      codec: container.audio,
      ...(options.audioBitrateKbps ? { bitrate: options.audioBitrateKbps * 1000 } : {}),
    };

    const video: ConversionVideoOptions | undefined = wantsVideo
      ? {
          codec: container.video,
          ...(options.maxDimension ? { width: options.maxDimension, fit: "contain" } : {}),
        }
      : { discard: true };

    // Bitrate needs the track's real dimensions, which are only known once the
    // track has been read — hence the callback form. Conversion.init accepts a
    // function here, so this is typed rather than cast: casting a callback to
    // the object type would silence exactly the error worth seeing.
    const videoOption: ConversionOptions["video"] = wantsVideo
      ? (track: InputVideoTrack) => ({
          ...video,
          bitrate: videoBitrate(track.displayWidth, track.displayHeight, options),
        })
      : video;

    const conversion = await Conversion.init({
      input,
      output,
      video: videoOption,
      audio,
      ...(options.trim ? { trim: options.trim } : {}),
    });

    if (!conversion.isValid) {
      // Something in the requested shape can't be produced — a codec the
      // container won't hold, or a track nothing can encode. ffmpeg's turn.
      const why = conversion.discardedTracks.map((t) => `${t.track.type}: ${t.reason}`).join("; ");
      throw new NotMyJobError(why || "conversion is not valid in this browser");
    }

    // A conversion that discards every track "succeeds" and writes an empty
    // file. That is worse than failing, because it looks like it worked.
    if (conversion.utilizedTracks.length === 0) {
      throw new NotMyJobError("no track survived — output would be empty");
    }

    conversion.onProgress = (p) => onProgress(Number.isFinite(p) ? p : null);
    active.set(jobId, conversion);

    try {
      await conversion.execute();
    } catch (err) {
      if (err instanceof ConversionCanceledError) throw new Error("Cancelled");
      throw err;
    } finally {
      active.delete(jobId);
    }

    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer || buffer.byteLength === 0) {
      throw new NotMyJobError("conversion produced no bytes");
    }

    return Comlink.transfer({ buffer, engine: "webcodecs" as const }, [buffer]);
  },

  async cancel(jobId: string): Promise<void> {
    await active.get(jobId)?.cancel();
    active.delete(jobId);
  },

  /** Exposed for tests and for the capability probe on /formats. */
  async canEncode(target: FormatId): Promise<boolean> {
    const c = CONTAINERS[target];
    if (!c) return false;
    if (c.audio && !(await canEncodeAudio(c.audio))) return false;
    if (c.video && !(await canEncodeVideo(c.video))) return false;
    return true;
  },
};

export type MediaWorkerApi = typeof api;

Comlink.expose(api);

/**
 * The format registry. Single source of truth for what Onhand can read and write.
 *
 * The public /formats page and the pair pages are both generated from this table,
 * so the site cannot advertise a conversion the engines can't actually perform.
 * That is deliberate: every competitor's format list is marketing copy, and half
 * the entries silently fail.
 */

export type FormatId =
  // images
  | "jpeg"
  | "png"
  | "webp"
  | "avif"
  | "heic"
  | "gif"
  | "bmp"
  | "tiff"
  | "ico"
  | "svg"
  // documents
  | "pdf"
  // audio
  | "mp3"
  | "wav"
  | "m4a"
  | "aac"
  | "ogg"
  | "opus"
  | "flac"
  // video
  | "mp4"
  | "mov"
  | "webm"
  | "mkv"
  | "avi";

export type Kind = "image" | "document" | "audio" | "video";

export interface FormatSpec {
  id: FormatId;
  /** Human label, used in UI and page copy. */
  label: string;
  kind: Kind;
  /** Canonical extension, no dot. */
  ext: string;
  /** Every extension that maps here, no dots, lowercase. */
  extensions: string[];
  mime: string;
  /** Can we turn this INTO pixels? */
  decodable: boolean;
  /** Can we write this OUT? */
  encodable: boolean;
  /** Lossy formats get a quality control; lossless ones must not show a useless slider. */
  lossy: boolean;
}

export const FORMATS: Record<FormatId, FormatSpec> = {
  jpeg: {
    id: "jpeg",
    label: "JPEG",
    kind: "image",
    ext: "jpg",
    extensions: ["jpg", "jpeg", "jpe", "jfif"],
    mime: "image/jpeg",
    decodable: true,
    encodable: true,
    lossy: true,
  },
  png: {
    id: "png",
    label: "PNG",
    kind: "image",
    ext: "png",
    extensions: ["png"],
    mime: "image/png",
    decodable: true,
    encodable: true,
    lossy: false,
  },
  webp: {
    id: "webp",
    label: "WebP",
    kind: "image",
    ext: "webp",
    extensions: ["webp"],
    mime: "image/webp",
    decodable: true,
    encodable: true,
    lossy: true,
  },
  avif: {
    id: "avif",
    label: "AVIF",
    kind: "image",
    ext: "avif",
    extensions: ["avif"],
    mime: "image/avif",
    decodable: true,
    encodable: true,
    lossy: true,
  },
  heic: {
    // Decode-only, and that asymmetry is the entire point of the format's presence:
    // people have thousands of these from an iPhone and want out, never in.
    id: "heic",
    label: "HEIC",
    kind: "image",
    ext: "heic",
    extensions: ["heic", "heif", "hif"],
    mime: "image/heic",
    decodable: true,
    encodable: false,
    lossy: true,
  },
  gif: {
    // Written only from VIDEO, via ffmpeg — see targetsFor. Reading a GIF still
    // yields its first frame; turning a clip INTO an animated GIF is the thing
    // people actually ask for, and it is a genuinely different operation.
    id: "gif",
    label: "GIF",
    kind: "image",
    ext: "gif",
    extensions: ["gif"],
    mime: "image/gif",
    decodable: true,
    encodable: true,
    lossy: true, // palette quantisation to 256 colours is a real loss
  },
  bmp: {
    id: "bmp",
    label: "BMP",
    kind: "image",
    ext: "bmp",
    extensions: ["bmp", "dib"],
    mime: "image/bmp",
    decodable: true,
    encodable: false,
    lossy: false,
  },
  tiff: {
    id: "tiff",
    label: "TIFF",
    kind: "image",
    ext: "tiff",
    extensions: ["tif", "tiff"],
    mime: "image/tiff",
    decodable: true, // via UTIF — no browser decodes TIFF natively
    encodable: false,
    lossy: false,
  },
  ico: {
    id: "ico",
    label: "ICO",
    kind: "image",
    ext: "ico",
    extensions: ["ico"],
    mime: "image/x-icon",
    decodable: true,
    encodable: false,
    lossy: false,
  },
  svg: {
    id: "svg",
    label: "SVG",
    kind: "image",
    ext: "svg",
    extensions: ["svg"],
    mime: "image/svg+xml",
    decodable: true,
    encodable: false,
    lossy: false,
  },
  pdf: {
    id: "pdf",
    label: "PDF",
    kind: "document",
    ext: "pdf",
    extensions: ["pdf"],
    mime: "application/pdf",
    decodable: true,
    encodable: true,
    lossy: false,
  },

  // ── Audio ──────────────────────────────────────────────────────────────
  // Note on `lossy`: it describes the FORMAT, and drives whether a quality
  // control appears. WAV and FLAC get no slider because there is nothing to
  // trade — showing one would imply a choice that does not exist.
  mp3: {
    // Most browsers have no MP3 *encoder* in WebCodecs, so "convert to mp3"
    // usually goes through ffmpeg — which is why that engine is not optional.
    // Not universal, though: some Linux WebKit builds are GStreamer-backed and
    // do encode MP3, and the routing picks that up on its own. A hardcoded
    // "nobody can" was wrong within a day of being written.
    id: "mp3",
    label: "MP3",
    kind: "audio",
    ext: "mp3",
    extensions: ["mp3"],
    mime: "audio/mpeg",
    decodable: true,
    encodable: true,
    lossy: true,
  },
  wav: {
    id: "wav",
    label: "WAV",
    kind: "audio",
    ext: "wav",
    extensions: ["wav", "wave"],
    mime: "audio/wav",
    decodable: true,
    encodable: true,
    lossy: false,
  },
  m4a: {
    id: "m4a",
    label: "M4A",
    kind: "audio",
    ext: "m4a",
    extensions: ["m4a", "m4b"],
    mime: "audio/mp4",
    decodable: true,
    encodable: true,
    lossy: true,
  },
  aac: {
    // Raw ADTS stream rather than an MP4 container. Kept separate from m4a
    // because they are not interchangeable despite both being "AAC".
    id: "aac",
    label: "AAC",
    kind: "audio",
    ext: "aac",
    extensions: ["aac", "adts"],
    mime: "audio/aac",
    decodable: true,
    encodable: true,
    lossy: true,
  },
  ogg: {
    id: "ogg",
    label: "OGG",
    kind: "audio",
    ext: "ogg",
    extensions: ["ogg", "oga"],
    mime: "audio/ogg",
    decodable: true,
    encodable: true,
    lossy: true,
  },
  opus: {
    id: "opus",
    label: "Opus",
    kind: "audio",
    ext: "opus",
    extensions: ["opus"],
    mime: "audio/opus",
    decodable: true,
    encodable: true,
    lossy: true,
  },
  flac: {
    id: "flac",
    label: "FLAC",
    kind: "audio",
    ext: "flac",
    extensions: ["flac"],
    mime: "audio/flac",
    decodable: true,
    encodable: true,
    lossy: false,
  },

  // ── Video ──────────────────────────────────────────────────────────────
  mp4: {
    id: "mp4",
    label: "MP4",
    kind: "video",
    ext: "mp4",
    extensions: ["mp4", "m4v"],
    mime: "video/mp4",
    decodable: true,
    encodable: true,
    lossy: true,
  },
  mov: {
    // The other half of the iPhone problem: HEIC for stills, MOV for video.
    id: "mov",
    label: "MOV",
    kind: "video",
    ext: "mov",
    extensions: ["mov", "qt"],
    mime: "video/quicktime",
    decodable: true,
    encodable: true,
    lossy: true,
  },
  webm: {
    id: "webm",
    label: "WebM",
    kind: "video",
    ext: "webm",
    extensions: ["webm"],
    mime: "video/webm",
    decodable: true,
    encodable: true,
    lossy: true,
  },
  mkv: {
    id: "mkv",
    label: "MKV",
    kind: "video",
    ext: "mkv",
    extensions: ["mkv"],
    mime: "video/x-matroska",
    decodable: true,
    encodable: true,
    lossy: true,
  },
  avi: {
    // Read-only. AVI is a container people need to escape, never one they ask
    // to be given, and writing it well means writing it badly.
    id: "avi",
    label: "AVI",
    kind: "video",
    ext: "avi",
    extensions: ["avi"],
    mime: "video/x-msvideo",
    decodable: true,
    encodable: false,
    lossy: true,
  },
};

const EXT_INDEX: ReadonlyMap<string, FormatId> = new Map(
  Object.values(FORMATS).flatMap((f) => f.extensions.map((e) => [e, f.id] as const)),
);

const MIME_INDEX: ReadonlyMap<string, FormatId> = new Map(
  Object.values(FORMATS).map((f) => [f.mime, f.id] as const),
);

/**
 * Identify a file's format.
 *
 * Extension first, MIME second — deliberately that order. Browsers routinely
 * report HEIC files as `image/heic`, `image/heif`, an empty string, or (on some
 * Windows builds) `application/octet-stream`, so trusting `file.type` first
 * would misidentify the single most important input format we have.
 */
export function detectFormat(file: { name: string; type?: string }): FormatId | undefined {
  const dot = file.name.lastIndexOf(".");
  if (dot > -1) {
    const ext = file.name.slice(dot + 1).toLowerCase();
    const byExt = EXT_INDEX.get(ext);
    if (byExt) return byExt;
  }
  if (file.type) {
    const byMime = MIME_INDEX.get(file.type.toLowerCase());
    if (byMime) return byMime;
  }
  return undefined;
}

/**
 * Formats the browser decodes itself, via ImageDecoder or createImageBitmap.
 *
 * Lives here rather than in the worker because two things need it: the worker,
 * to decide whether to load a wasm decoder at all, and the offline check, to
 * decide whether a pair needs anything cached. Kept as one table because when
 * it was two, the offline badge demanded a PNG decoder that is never fetched
 * and reported "not available offline" for a pair that works fine.
 */
export const NATIVE_DECODABLE: ReadonlySet<FormatId> = new Set([
  "gif",
  "bmp",
  "ico",
  "png",
  "jpeg",
  "webp",
]);

/** Formats we can produce at all. */
export function encodableFormats(): FormatSpec[] {
  return Object.values(FORMATS).filter((f) => f.encodable);
}

/**
 * The targets actually reachable from a given source — what the dropdown shows.
 *
 * Listing every encodable format regardless of input offers "PNG" for an MP3
 * and "MP4" for a JPEG. Picking one gets a polite refusal, but the person has
 * already decided the tool is broken by then. An option that cannot work should
 * not be on screen.
 *
 * Deliberately kept here rather than derived from the engines: this is a cheap
 * synchronous call made during render, and the engine list needs a capability
 * probe. The broker remains the authority — this only decides what to offer.
 */
export function targetsFor(source: FormatId): FormatSpec[] {
  const kind = FORMATS[source].kind;
  return Object.values(FORMATS).filter((f) => {
    if (!f.encodable) return false;
    switch (kind) {
      case "image":
        // Images become other images, or get bound into a PDF. NOT GIF: a
        // single-frame GIF from a PNG is worse in every way than the PNG, and
        // producing it would download the 9.7 MB engine to do it.
        return (f.kind === "image" && f.id !== "gif") || f.id === "pdf";
      case "document":
        // A PDF renders to images, or passes through. Not GIF, for the same
        // reason as above — and the pdf engine cannot write one anyway, so
        // offering it would put a pair in the format table that no engine
        // performs. That is the exact dishonesty this project exists to avoid.
        return (f.kind === "image" && f.id !== "gif") || f.id === "pdf";
      case "audio":
        return f.kind === "audio";
      case "video":
        // Video to video, audio extraction ("get the MP3 out of this"), and
        // animated GIF — the shareable-loop case, and the only route by which
        // GIF is ever written.
        return f.kind === "video" || f.kind === "audio" || f.id === "gif";
    }
  });
}

/**
 * The default target for a given source.
 *
 * These are opinions, and they're the difference between one click and three:
 * nobody drops a HEIC because they want another HEIC. The map encodes what the
 * person almost certainly wants, and the dropdown is there for when it's wrong.
 */
const DEFAULT_TARGETS: Partial<Record<FormatId, FormatId>> = {
  heic: "jpeg", // the iPhone escape hatch — the reason most people arrive
  bmp: "png",
  tiff: "png",
  ico: "png",
  svg: "png",
  gif: "png",
  png: "webp", // the usual intent is "make this smaller for the web"
  jpeg: "webp",
  webp: "jpeg", // and the reverse: "make this open in anything"
  avif: "jpeg",
  pdf: "png",

  // Audio: everything wants to become MP3, because "will this play on the
  // thing I'm putting it on" beats fidelity for almost everyone who arrives
  // here. FLAC is the exception — someone holding a FLAC chose it on purpose,
  // and defaulting them to a lossy format would throw away what they came for.
  wav: "mp3",
  m4a: "mp3",
  aac: "mp3",
  ogg: "mp3",
  opus: "mp3",
  flac: "wav",
  mp3: "wav",

  // Video: MP4 is the format that plays everywhere, and that is the whole ask.
  mov: "mp4",
  mkv: "mp4",
  avi: "mp4",
  webm: "mp4",
  mp4: "webm", // and the reverse, for people shrinking things for the web
};

/** Formats we can produce, grouped for a target dropdown that isn't 20 items long. */
export function encodableByKind(): Record<Kind, FormatSpec[]> {
  const out: Record<Kind, FormatSpec[]> = { image: [], document: [], audio: [], video: [] };
  for (const f of Object.values(FORMATS)) if (f.encodable) out[f.kind].push(f);
  return out;
}

/**
 * Pulling the audio out of a video is a conversion people ask for constantly
 * ("get the mp3 out of this"), and it is the one cross-kind pair that is not a
 * mistake — so it gets named rather than inferred.
 */
export function isAudioExtraction(source: FormatId, target: FormatId): boolean {
  return FORMATS[source].kind === "video" && FORMATS[target].kind === "audio";
}

export function defaultTargetFor(source: FormatId): FormatId {
  const preferred = DEFAULT_TARGETS[source];
  if (preferred && FORMATS[preferred].encodable) return preferred;
  return FORMATS[source].encodable ? source : "png";
}

export function formatLabel(id: FormatId): string {
  return FORMATS[id].label;
}

/** Swap a filename's extension, preserving the stem. */
export function renameTo(originalName: string, target: FormatId): string {
  const dot = originalName.lastIndexOf(".");
  const stem = dot > 0 ? originalName.slice(0, dot) : originalName;
  return `${stem}.${FORMATS[target].ext}`;
}

/**
 * How many conversions between DIFFERENT formats the engines offer.
 *
 * Lives here rather than in each page because two pages once disagreed: the
 * homepage counted same-format re-encodes (jpg → jpg, a real operation — change
 * the quality, drop the EXIF) and /formats did not, so the site advertised 164
 * conversions in one place and 148 in another. On a project whose whole claim is
 * that its numbers are generated rather than marketed, two different generated
 * numbers is the worst outcome available.
 */
export const CONVERSION_COUNT = Object.values(FORMATS).reduce(
  (n, f) => n + targetsFor(f.id).filter((t) => t.id !== f.id).length,
  0,
);

/** Formats that can also be re-encoded to themselves. Reported separately. */
export const SELF_CONVERSION_COUNT = Object.values(FORMATS).filter((f) =>
  targetsFor(f.id).some((t) => t.id === f.id),
).length;

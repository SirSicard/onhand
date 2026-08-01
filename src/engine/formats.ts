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
  | "pdf";

export type Kind = "image" | "document";

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
    // Static only for now — animation needs frame handling the image path doesn't do.
    id: "gif",
    label: "GIF",
    kind: "image",
    ext: "gif",
    extensions: ["gif"],
    mime: "image/gif",
    decodable: true,
    encodable: false,
    lossy: false,
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

/** Formats we can produce, for the target dropdown. */
export function encodableFormats(): FormatSpec[] {
  return Object.values(FORMATS).filter((f) => f.encodable);
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
};

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

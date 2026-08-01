import { FORMATS, targetsFor, type FormatId } from "@/engine/formats";

/**
 * Which conversion pairs get their own page.
 *
 * Not every reachable pair: there are 159 of those and most have no search
 * demand at all. A page for "BMP to AVIF" is a page nobody will ever land on,
 * and 159 thin pages look worse to a search engine than 40 substantial ones.
 *
 * Ranking is judgement, not data — I have no keyword tool. It is derived from
 * three things that are actually knowable:
 *
 *   1. Which formats people are TRAPPED in. HEIC and MOV are the whole reason
 *      this product exists: an iPhone produces them by default and half the
 *      world's software won't open them. That asymmetry is why heic→jpg is
 *      first and jpg→heic does not exist at all.
 *   2. Which pairs the incumbents put in their own navigation. Convertio,
 *      CloudConvert and Zamzar all surface the same handful, and they DO have
 *      the keyword data.
 *   3. Which pairs are a real job rather than a curiosity. mp4→mp3 is "get the
 *      audio out of this", which people want constantly.
 *
 * Every entry is validated against the engine table at build time, so a page
 * cannot exist for a pair we can't actually perform.
 */

export interface Pair {
  source: FormatId;
  target: FormatId;
  /** Lower is more important. Drives sitemap priority and the homepage grid. */
  rank: number;
  /**
   * Why someone is on this page. One sentence, specific to the pair — the
   * thing that makes a pair page worth reading rather than a template with the
   * format names swapped in.
   */
  reason: string;
}

const RAW: [FormatId, FormatId, string][] = [
  // ── The trapped formats. This is the product's reason to exist. ──────────
  [
    "heic",
    "jpeg",
    "Your iPhone saves photos as HEIC to halve the file size. Windows, older Android, most web forms and a lot of desktop software still won't open them.",
  ],
  [
    "heic",
    "png",
    "Same iPhone problem, but PNG when you need the image lossless or with transparency intact rather than re-compressed.",
  ],
  [
    "mov",
    "mp4",
    "iPhone video is QuickTime. MP4 holds the same H.264 video and AAC audio but plays essentially everywhere, which MOV does not.",
  ],
  [
    "heic",
    "webp",
    "For putting iPhone photos on the web, where WebP is usually a third smaller than JPEG at the same quality.",
  ],

  // ── Getting audio out of video. A constant, concrete job. ────────────────
  [
    "mp4",
    "mp3",
    "Pulling the audio out of a video — a talk, a lecture, a song — so it plays on anything and takes a fraction of the space.",
  ],
  ["mov", "mp3", "The same, for video off an iPhone or a Mac screen recording."],
  [
    "mp4",
    "wav",
    "Audio out of video without a second lossy re-encode, for when it is going into an editor rather than a phone.",
  ],
  ["webm", "mp3", "Audio out of a WebM, which is what most browser recordings produce."],

  // ── Web image work. High volume, low drama. ──────────────────────────────
  [
    "png",
    "webp",
    "PNG screenshots are enormous. WebP typically cuts them by two thirds with no visible difference.",
  ],
  [
    "jpeg",
    "webp",
    "The standard step when putting photographs on a site you care about the speed of.",
  ],
  ["webp", "jpeg", "The reverse, for the software that still hasn't learned to open WebP."],
  ["webp", "png", "WebP to PNG when you need transparency preserved and lossless."],
  [
    "png",
    "jpeg",
    "For when a photograph got saved as PNG and is ten times bigger than it needs to be.",
  ],
  [
    "jpeg",
    "png",
    "Usually to get a lossless copy before editing, or because something demands PNG.",
  ],
  ["avif", "jpeg", "AVIF compresses beautifully and is still refused by plenty of software."],
  [
    "png",
    "avif",
    "The smallest a photograph gets in a browser-supported format, if your audience is modern.",
  ],

  // ── Formats people receive and can't open. ───────────────────────────────
  [
    "tiff",
    "jpeg",
    "TIFF comes out of scanners and cameras at enormous sizes. No browser opens it at all.",
  ],
  ["tiff", "png", "Scanned documents, kept lossless, but in a format anything can read."],
  ["svg", "png", "Turning a vector logo into a raster image for somewhere that won't take SVG."],
  ["bmp", "png", "BMP is uncompressed and vast. PNG is the same pixels at a fraction of the size."],
  ["bmp", "jpeg", "The same, for photographs, where JPEG is smaller still."],
  ["gif", "png", "Getting a clean still frame out of a GIF."],
  ["ico", "png", "Extracting a favicon back out to an editable image."],
  ["avif", "png", "AVIF to PNG, lossless, for editing."],

  // ── PDF, both directions. ────────────────────────────────────────────────
  [
    "jpeg",
    "pdf",
    "Turning photographs or scans into a single PDF, for sending somewhere that expects a document.",
  ],
  ["png", "pdf", "The same for screenshots and diagrams."],
  ["pdf", "png", "Getting each page of a PDF out as an image, all of them, in one zip."],
  ["pdf", "jpeg", "The same when file size matters more than sharpness."],

  // ── Video containers. ────────────────────────────────────────────────────
  [
    "mkv",
    "mp4",
    "MKV holds almost anything, which is exactly why phones and TVs so often refuse it.",
  ],
  ["avi", "mp4", "AVI is thirty years old. MP4 is what everything made this decade expects."],
  ["webm", "mp4", "WebM plays in browsers and often nowhere else."],
  ["mp4", "webm", "The reverse, for putting video on a page where the file size matters."],
  ["mov", "webm", "iPhone video, made small enough to serve on a website."],
  ["mkv", "mp3", "Audio out of an MKV, usually a recording or a rip."],

  // ── Audio, the pairs people actually ask for. ────────────────────────────
  ["wav", "mp3", "WAV is uncompressed — roughly ten megabytes a minute. MP3 is a tenth of that."],
  ["m4a", "mp3", "M4A is what Apple records in, and MP3 is what everything else plays."],
  [
    "flac",
    "mp3",
    "Lossless archives are large. MP3 is for the phone, the car, the thing with a small disk.",
  ],
  [
    "mp3",
    "wav",
    "Back to uncompressed for editing, where an editor wants PCM rather than a lossy codec.",
  ],
  ["ogg", "mp3", "OGG is a fine format that a great deal of hardware simply doesn't support."],
  ["opus", "mp3", "Opus is excellent and newer than most of the devices people own."],
  ["m4a", "wav", "Apple recordings into PCM, for an editor or a DAW."],
  ["flac", "wav", "Lossless to lossless, when something wants plain PCM."],
  ["wav", "flac", "Lossless compression — identical audio, roughly half the size."],
  ["aac", "mp3", "Raw AAC streams into something with broader support."],
];

/** The pairs that get pages, validated against what the engines can do. */
export const PAIRS: Pair[] = RAW.map(([source, target, reason], index) => ({
  source,
  target,
  rank: index + 1,
  reason,
})).filter((pair) => {
  // A page that promises a conversion the broker would refuse is worse than no
  // page at all — it is the exact failure this project criticises competitors
  // for. Build-time filter rather than a runtime surprise.
  const reachable = targetsFor(pair.source).some((f) => f.id === pair.target);
  if (!reachable) {
    console.warn(
      `pairs.ts: ${pair.source} → ${pair.target} is not a reachable conversion; page skipped`,
    );
  }
  return reachable;
});

/** URL slug for a pair, e.g. "heic-to-jpg". Uses the canonical extension. */
export function slugFor(pair: Pick<Pair, "source" | "target">): string {
  return `${FORMATS[pair.source].ext}-to-${FORMATS[pair.target].ext}`;
}

export function titleFor(pair: Pick<Pair, "source" | "target">): string {
  return `${FORMATS[pair.source].label} to ${FORMATS[pair.target].label}`;
}

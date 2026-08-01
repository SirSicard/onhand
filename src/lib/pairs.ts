import { FORMATS, targetsFor, type FormatId } from "@/engine/formats";

/**
 * Which conversion pairs get their own page.
 *
 * Every pair the engines can actually perform — all 148 of them — has a page,
 * and every one has a reason written for it by hand. That second half is the
 * whole discipline. Generating 148 pages from a template with the format names
 * swapped in would be the same "format list as marketing copy" that /why
 * accuses the incumbents of; a page that tells you nothing is worse than no
 * page, because someone spent a click on it.
 *
 * So the rule is: if a pair cannot be given a true, specific sentence about why
 * a person would want it — including "you probably don't want this, and here is
 * why" — it does not belong here. Several of the entries below are exactly that
 * warning, and they are among the most useful pages on the site.
 *
 * Ranking is judgement, not data — there is no keyword tool involved. It comes
 * from three things that are actually knowable:
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
 * Rank drives sitemap priority and the homepage grid, so the long tail existing
 * costs the head nothing. Every entry is validated against the engine table at
 * build time, so a page cannot exist for a pair we can't actually perform.
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
  // ══ TIER 1 ══════════════════════════════════════════════════════════════
  // The trapped formats. This is the product's reason to exist.
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

  // Getting audio out of video. A constant, concrete job.
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

  // Video to animated GIF. The shareable loop.
  [
    "mp4",
    "gif",
    "A clip turned into a loop that plays inline anywhere — a chat window, a bug report, a README — with no player and no sound.",
  ],
  [
    "mov",
    "gif",
    "A screen recording off a Mac, made into the kind of loop you can paste into an issue or a message.",
  ],

  // Web image work. High volume, low drama.
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
    "For when a photograph got saved as PNG and is ten times bigger than it needs to be. Transparent areas are flattened onto white, since JPEG has no alpha channel.",
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

  // Formats people receive and can't open.
  [
    "tiff",
    "jpeg",
    "TIFF comes out of scanners and cameras at enormous sizes. No browser opens it at all.",
  ],
  ["tiff", "png", "Scanned documents, kept lossless, but in a format anything can read."],
  ["svg", "png", "Turning a vector logo into a raster image for somewhere that won't take SVG."],
  ["bmp", "png", "BMP is uncompressed and vast. PNG is the same pixels at a fraction of the size."],
  ["bmp", "jpeg", "The same, for photographs, where JPEG is smaller still."],
  [
    "gif",
    "png",
    "Getting a clean still frame out of a GIF, kept lossless, with any transparency intact.",
  ],
  [
    "ico",
    "png",
    "Extracting a favicon back out to an editable image. ICO files hold several sizes; you get the largest one in the file.",
  ],
  [
    "avif",
    "png",
    "AVIF into a format every editor opens, with no further quality loss at this step and transparency preserved.",
  ],

  // PDF, both directions.
  [
    "jpeg",
    "pdf",
    "Turning photographs or scans into a single PDF, for sending somewhere that expects a document.",
  ],
  [
    "png",
    "pdf",
    "The same for screenshots and diagrams, where PNG keeps text and lines sharp on the page rather than smearing them.",
  ],
  ["pdf", "png", "Getting each page of a PDF out as an image, all of them, in one zip."],
  [
    "pdf",
    "jpeg",
    "The same when file size matters more than sharpness — useful for a long document you only need to look at, not print.",
  ],

  // Video containers.
  [
    "mkv",
    "mp4",
    "MKV holds almost anything, which is exactly why phones and TVs so often refuse it.",
  ],
  ["avi", "mp4", "AVI is thirty years old. MP4 is what everything made this decade expects."],
  [
    "webm",
    "mp4",
    "WebM plays in browsers and often nowhere else — not in most editors, not on a TV, not on an older phone.",
  ],
  ["mp4", "webm", "The reverse, for putting video on a page where the file size matters."],
  [
    "mov",
    "webm",
    "iPhone video, made small enough and standard enough to serve directly on a website without a hosting service.",
  ],
  [
    "mkv",
    "mp3",
    "Audio out of an MKV, usually a recording or a rip, in the format that plays on absolutely anything.",
  ],

  // Audio, the pairs people actually ask for.
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
  [
    "m4a",
    "wav",
    "Apple voice memos and recordings into raw PCM, which is what an editor or a DAW wants to be handed.",
  ],
  [
    "flac",
    "wav",
    "Lossless to lossless: identical audio, roughly twice the size, and no decoding step for whatever reads it next.",
  ],
  ["wav", "flac", "Lossless compression — identical audio, roughly half the size."],
  [
    "aac",
    "mp3",
    "Raw AAC streams, which little consumer software will open, into the format that everything has played for thirty years.",
  ],

  // ══ TIER 2 ══════════════════════════════════════════════════════════════
  // Real requests, lower volume. Everything below here exists because someone
  // occasionally needs it, not because it is a headline.

  // ── More video to GIF ────────────────────────────────────────────────────
  [
    "webm",
    "gif",
    "Browser and OBS recordings are usually WebM. GIF is what survives being pasted into a comment box.",
  ],
  ["mkv", "gif", "A loop out of an MKV, which is what most capture and rip tools default to."],
  ["avi", "gif", "An old AVI clip made into something that plays inline in 2026."],

  // ── Images into AVIF, the newest and smallest ────────────────────────────
  [
    "jpeg",
    "avif",
    "Typically half a JPEG at the same visual quality. Worth it when your audience is on current browsers and not worth it otherwise.",
  ],
  [
    "webp",
    "avif",
    "Both are modern web formats. AVIF is usually smaller; it also encodes more slowly and is supported by slightly less.",
  ],
  [
    "heic",
    "avif",
    "Both descend from the same video codec generation, so the size barely moves. What changes is that every current browser opens AVIF and none of them open HEIC.",
  ],
  ["tiff", "avif", "An enormous scanner TIFF reduced to something you can put on a page."],
  ["bmp", "avif", "An uncompressed bitmap into the most space-efficient still format there is."],
  ["gif", "avif", "The first frame of a GIF, at the smallest a still image gets."],
  ["svg", "avif", "A vector rasterised at a fixed size, in the smallest raster format available."],
  ["ico", "avif", "An icon out to AVIF, for reuse somewhere that isn't a browser tab."],

  // ── Images into WebP, the safe modern default ────────────────────────────
  [
    "tiff",
    "webp",
    "Scans and camera TIFFs made small enough to serve, with transparency preserved if the TIFF had any.",
  ],
  ["bmp", "webp", "BMP stores every pixel raw. WebP is the same image at a small fraction of it."],
  [
    "gif",
    "webp",
    "GIF's palette is 256 colours and its compression dates to 1987. WebP holds the same still frame in far fewer bytes.",
  ],
  [
    "svg",
    "webp",
    "A vector logo rasterised for a place that won't take SVG but will take a modern format. Transparency survives.",
  ],
  ["ico", "webp", "A favicon out to WebP, usually to reuse the artwork somewhere else."],
  [
    "avif",
    "webp",
    "Back to WebP when something in the chain — a CMS, an email client, an older phone — hasn't caught up to AVIF.",
  ],

  // ── Images into JPEG, for maximum compatibility ──────────────────────────
  [
    "gif",
    "jpeg",
    "A single frame out of a GIF as a normal photograph rather than a 256-colour palette. Transparent areas become white.",
  ],
  [
    "svg",
    "jpeg",
    "A vector rendered to pixels for somewhere that only accepts photographs. JPEG has no transparency, so anything transparent lands on white.",
  ],
  [
    "ico",
    "jpeg",
    "Pulling an icon back out as a flat image. ICO files hold several sizes; you get the largest.",
  ],

  // ── Everything into PDF ──────────────────────────────────────────────────
  [
    "heic",
    "pdf",
    "iPhone photos straight into a document, for the form, the claim or the expense report that wants a PDF and won't take HEIC.",
  ],
  [
    "tiff",
    "pdf",
    "Scanned pages back into the document they came from. Multi-page TIFFs and multiple files both become one PDF.",
  ],
  ["webp", "pdf", "WebP images bound into a document, for sending somewhere that expects one."],
  ["avif", "pdf", "The same for AVIF, which almost nothing outside a browser will open."],
  ["bmp", "pdf", "Old bitmaps collected into a single document rather than a folder of files."],
  [
    "gif",
    "pdf",
    "A GIF's frame placed onto a PDF page, for attaching to something that only accepts documents.",
  ],
  ["svg", "pdf", "A vector rasterised and placed on a PDF page at a fixed size."],
  ["ico", "pdf", "An icon on a PDF page — unusual, but it is a real thing people ask for."],

  // ── PDF out to the newer image formats ───────────────────────────────────
  [
    "pdf",
    "webp",
    "Every page as a WebP, which is roughly a third the size of the same page as PNG.",
  ],
  [
    "pdf",
    "avif",
    "Every page at the smallest size an image gets, for archiving rather than editing.",
  ],

  // ── Video containers, the rest of the grid ───────────────────────────────
  [
    "mp4",
    "mov",
    "Back into QuickTime, which is what some Apple editing software still expects to be handed.",
  ],
  [
    "mp4",
    "mkv",
    "MKV when you want a container that will hold anything you later add — subtitles, extra audio tracks, odd codecs.",
  ],
  ["mov", "mkv", "iPhone or Mac video into the container that imposes the fewest limits."],
  ["webm", "mov", "A browser recording into the container Apple software prefers."],
  ["webm", "mkv", "WebM is a subset of MKV, so this is mostly a relabelling with more room."],
  [
    "mkv",
    "mov",
    "MKV into QuickTime, for an edit on a Mac where Final Cut or iMovie refuses the source outright.",
  ],
  [
    "mkv",
    "webm",
    "MKV made web-servable, which usually means a real re-encode rather than a repack.",
  ],
  ["avi", "mov", "A thirty-year-old AVI into something a modern Mac editor will open."],
  ["avi", "webm", "An old clip made small enough and modern enough to put on a page."],
  [
    "avi",
    "mkv",
    "AVI into a container that isn't from 1992, without picking a delivery format yet.",
  ],

  // ── Audio out of every video container ───────────────────────────────────
  ["mov", "wav", "Uncompressed audio out of iPhone or Mac video, for an editor."],
  ["mov", "m4a", "Audio out of QuickTime into the AAC container Apple uses everywhere."],
  [
    "mkv",
    "wav",
    "Uncompressed PCM out of an MKV, for editing or transcription rather than for listening to.",
  ],
  ["mkv", "m4a", "The audio track of an MKV in the format phones handle most efficiently."],
  ["avi", "mp3", "Audio out of an old AVI — usually the only part still worth keeping."],
  [
    "avi",
    "wav",
    "The same, uncompressed, for restoration work — no second generation of loss on audio that is already old and thin.",
  ],
  ["webm", "wav", "PCM out of a browser recording, for an editor that wants no codec in the way."],
  ["webm", "m4a", "A browser recording's audio in the container Apple devices prefer."],
  [
    "webm",
    "opus",
    "WebM audio is usually Opus already, so this is extraction rather than re-encoding.",
  ],
  ["mp4", "m4a", "Extracting a video's AAC audio into its own file, which is what M4A is."],
  ["mp4", "aac", "The raw AAC stream, for a pipeline that wants it without a container."],
  [
    "mp4",
    "flac",
    "Video audio into a lossless file — no better than the source, but no worse either.",
  ],
  [
    "mp4",
    "opus",
    "Video audio into the most efficient codec there is, for a podcast or a voice track.",
  ],
  ["mp4", "ogg", "Video audio into Vorbis, for software and games that expect OGG."],
  ["mov", "aac", "The raw AAC stream out of QuickTime video, with no container wrapped around it."],
  [
    "mov",
    "flac",
    "iPhone or Mac video audio, kept lossless from this point on — no better than the source, but nothing further is lost.",
  ],
  ["mov", "opus", "QuickTime audio into the codec that sounds best at small sizes."],
  ["mov", "ogg", "QuickTime audio into OGG, usually for a game engine or an older toolchain."],
  ["mkv", "aac", "The AAC stream out of an MKV without re-encoding the container around it."],
  ["mkv", "flac", "An MKV's audio kept lossless, for archiving a recording."],
  ["mkv", "opus", "MKV audio into Opus, which is what a modern MKV often already contains."],
  ["mkv", "ogg", "MKV audio into OGG Vorbis, for compatibility with older software."],
  ["webm", "aac", "WebM audio into AAC, which is what phones and TVs decode in hardware."],
  ["webm", "flac", "A browser recording's audio, kept lossless from this point on."],
  ["webm", "ogg", "WebM into OGG, which is a container change more than a codec one."],
  [
    "avi",
    "m4a",
    "AVI audio into the modern Apple container, for a phone or a Mac that will not touch the original file.",
  ],
  [
    "avi",
    "aac",
    "The audio of an old AVI as a raw AAC stream, for a pipeline that wants the codec without a container.",
  ],
  ["avi", "flac", "Old video audio preserved losslessly before anything else is done to it."],
  [
    "avi",
    "opus",
    "AVI audio into the most efficient codec available, which matters when the recording is long and the quality is already poor.",
  ],
  [
    "avi",
    "ogg",
    "AVI audio into OGG Vorbis, for a game engine or an older toolchain that expects nothing newer.",
  ],

  // ── Audio to audio: the sensible directions ──────────────────────────────
  ["wav", "m4a", "Uncompressed recordings into the format Apple devices handle most efficiently."],
  ["wav", "aac", "WAV into a raw AAC stream, for a pipeline that wants no container."],
  [
    "wav",
    "opus",
    "The best sound per byte available — noticeably better than MP3 at low bitrates.",
  ],
  ["wav", "ogg", "WAV into Vorbis, which games and open-source software have used for decades."],
  ["flac", "m4a", "A lossless archive into the format that plays on Apple hardware without fuss."],
  ["flac", "aac", "Lossless into AAC, which is the best-supported lossy codec on modern devices."],
  ["flac", "opus", "Lossless into the most efficient lossy codec, for a phone with a small disk."],
  ["flac", "ogg", "A FLAC library transcoded to Vorbis, usually for a device that predates Opus."],
  [
    "m4a",
    "flac",
    "An Apple recording into a lossless container. Nothing is recovered — see below.",
  ],
  ["aac", "wav", "AAC decoded to PCM, which is what an editor wants to be handed."],
  ["aac", "m4a", "Putting a raw AAC stream into the container that everything expects it in."],
  [
    "ogg",
    "wav",
    "Vorbis decoded to raw PCM for editing, which is the one thing every audio tool accepts without argument.",
  ],
  ["opus", "wav", "Opus decoded to PCM, for an editor or a transcription tool."],
  [
    "opus",
    "m4a",
    "Opus into AAC, because a great deal of consumer hardware still cannot play Opus.",
  ],
  ["ogg", "m4a", "Vorbis into AAC, for the same reason: hardware support."],
  [
    "ogg",
    "aac",
    "The same trade as OGG to M4A, but as a raw AAC stream rather than wrapped in a container.",
  ],
  ["opus", "aac", "Opus into raw AAC, for a pipeline that wants the stream on its own."],

  // ── Audio to audio: the ones where the honest answer is "probably not" ───
  // These pages exist because people search for them and deserve a straight
  // answer rather than a spinner and a download.
  [
    "mp3",
    "flac",
    "This will not improve the audio. FLAC is lossless, but what MP3 discarded is gone and cannot be reconstructed — you get a file three times the size holding exactly the same sound. Do it only when something demands FLAC as an input format.",
  ],
  [
    "aac",
    "flac",
    "Same warning as MP3 to FLAC: lossless is a property of the encoding from here on, not a repair of what was already thrown away.",
  ],
  [
    "ogg",
    "flac",
    "Vorbis is lossy. Wrapping it losslessly preserves it perfectly and improves it not at all.",
  ],
  [
    "opus",
    "flac",
    "Opus is lossy. This makes an honest, much larger copy of exactly what you already have.",
  ],
  [
    "mp3",
    "opus",
    "Opus is a better codec than MP3, but transcoding stacks one set of compression artefacts on another. Worth it for the size on a voice recording; not worth it for music you care about.",
  ],
  [
    "mp3",
    "m4a",
    "Both are lossy, so this is a second generation of loss. It is the right move when a device refuses MP3 and the wrong one otherwise.",
  ],
  [
    "mp3",
    "aac",
    "The same trade, as a raw stream: AAC is the better codec, but re-encoding never recovers anything.",
  ],
  [
    "mp3",
    "ogg",
    "Lossy to lossy. Usually done because a game engine or an older toolchain insists on OGG.",
  ],
  [
    "m4a",
    "aac",
    "Almost a no-op — M4A is already AAC in a container. This strips the container off.",
  ],
  ["m4a", "ogg", "AAC into Vorbis, for software that will not take anything Apple produced."],
  ["m4a", "opus", "AAC into Opus. A second generation of loss, in exchange for a smaller file."],
  ["aac", "ogg", "Raw AAC into Vorbis, for an older open-source toolchain."],
  ["aac", "opus", "AAC into Opus, which is smaller at the same perceived quality but re-encoded."],
  [
    "ogg",
    "opus",
    "Vorbis into its own successor. Same project, better codec, one more generation of loss.",
  ],
  ["opus", "ogg", "Opus back to Vorbis, for hardware that reads OGG but predates Opus support."],
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

/**
 * How many pairs get a bespoke social card.
 *
 * Every pair gets a page; only the head gets its own OG image. 148 cards at
 * ~31 KB each is 4.6 MB of committed binaries for artwork nobody will ever see
 * on a page ranking 120th, and this repo is meant to be cloneable. The rest
 * fall back to the site-wide card, which says the same thing less specifically.
 */
export const OG_CARD_LIMIT = 48;

/** URL slug for a pair, e.g. "heic-to-jpg". Uses the canonical extension. */
export function slugFor(pair: Pick<Pair, "source" | "target">): string {
  return `${FORMATS[pair.source].ext}-to-${FORMATS[pair.target].ext}`;
}

export function titleFor(pair: Pick<Pair, "source" | "target">): string {
  return `${FORMATS[pair.source].label} to ${FORMATS[pair.target].label}`;
}

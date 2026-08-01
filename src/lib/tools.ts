import type { FormatId } from "@/engine/formats";
import { PAIRS } from "./pairs";

/**
 * Pages organised by what someone is trying to DO, rather than by format pair.
 *
 * The pair pages answer "heic to jpg". These answer "my iPhone photos won't
 * open on Windows", which is the same problem stated the way people actually
 * have it — before they know which format is involved, or that a format is
 * involved at all. A pair page cannot serve that visitor: they do not yet know
 * the noun to search for.
 *
 * Kept deliberately few. Six pages that each answer a distinct question beat
 * twenty that overlap, and an intent page that is really just a pair page with
 * a verb in the title is padding.
 */

export interface Tool {
  slug: string;
  /** The <h1>. Phrased as the job, not the format. */
  title: string;
  metaTitle: string;
  description: string;
  /** One or two sentences: who this is for and what happens. */
  intro: string[];
  /**
   * Preselected target format, when the intent implies exactly one. Omitted
   * where it genuinely depends — "compress images" has no single right answer.
   */
  target?: FormatId;
  /** Pairs to surface as links. Validated against PAIRS at build time. */
  pairs: [FormatId, FormatId][];
  /** Specific, checkable claims. Not benefits — facts someone can verify. */
  points: { heading: string; body: string }[];
}

const RAW: Tool[] = [
  {
    slug: "iphone-photos",
    title: "Open iPhone photos on anything",
    metaTitle: "Convert iPhone HEIC photos to JPG or PNG — in your browser | Onhand",
    description:
      "Your iPhone saves photos as HEIC and half the world can't open them. Convert HEIC to JPG, PNG or WebP in your browser. Nothing is uploaded, no limit on how many.",
    intro: [
      "Since iOS 11 an iPhone saves photos as HEIC by default, because it is roughly half the size of the equivalent JPEG. The catch is everything else: Windows Photo Viewer, most web upload forms, older Android phones, Slack previews and a great deal of desktop software simply refuse the file.",
      "This converts them on your own device. Select a whole camera roll's worth at once — there is no per-file limit and no queue, because there is no server doing the work.",
    ],
    pairs: [
      ["heic", "jpeg"],
      ["heic", "png"],
      ["heic", "webp"],
      ["heic", "avif"],
      ["heic", "pdf"],
    ],
    points: [
      {
        heading: "JPEG unless you have a reason",
        body: "It is the format every piece of software on earth opens. PNG is worth it only if you need transparency or are about to edit the image; it will usually be several times larger than the HEIC you started with.",
      },
      {
        heading: "Safari does this natively, other browsers don't",
        body: "Safari can decode HEIC itself, so on a Mac or an iPhone nothing is downloaded. Chrome and Firefox cannot, so the first HEIC you convert there fetches a decoder — about 1.5 MB, once, then cached. You are told before it happens.",
      },
      {
        heading: "The location data comes off",
        body: "Photos carry the GPS coordinates of where they were taken, which is frequently someone's home. Converting rebuilds the image from its pixels, so the EXIF block does not survive — that is not an option you have to remember to tick.",
      },
    ],
  },
  {
    slug: "extract-audio",
    title: "Get the audio out of a video",
    metaTitle: "Extract audio from video — MP4, MOV, MKV to MP3 or WAV | Onhand",
    description:
      "Pull the audio track out of a video file and save it as MP3, WAV, M4A or FLAC. Runs in your browser — nothing is uploaded, no length limit, no account.",
    intro: [
      "A talk, a lecture, an interview, a song someone sent as a video. The picture is a few hundred megabytes you do not need; the audio is a few.",
      "The video track is genuinely discarded rather than carried along invisibly, which is the difference between a file you can put on a phone and one you can't.",
    ],
    target: "mp3",
    pairs: [
      ["mp4", "mp3"],
      ["mov", "mp3"],
      ["mkv", "mp3"],
      ["webm", "mp3"],
      ["avi", "mp3"],
      ["mp4", "wav"],
      ["mp4", "m4a"],
      ["mp4", "flac"],
    ],
    points: [
      {
        heading: "MP3 to listen, WAV to edit",
        body: "MP3 plays on everything and is about a tenth the size. WAV is uncompressed PCM, which is what an editor or a transcription tool wants to be handed — no second generation of lossy compression on top of whatever the video already did.",
      },
      {
        heading: "FLAC is not an upgrade",
        body: "The audio inside a video file is already lossy. Extracting it to FLAC preserves it perfectly and improves it not at all — you get a much larger file holding the same sound. Choose it when something downstream demands FLAC, not for quality.",
      },
      {
        heading: "Long recordings are fine",
        body: "There is no imposed length or size cap. The real limit is your machine: a browser tab has roughly 1.8 GB of working memory, and you are told before starting if a file will not fit rather than after twenty minutes.",
      },
    ],
  },
  {
    slug: "compress-images",
    title: "Make images smaller",
    metaTitle: "Compress images in your browser — PNG, JPG, WebP, AVIF | Onhand",
    description:
      "Shrink photos and screenshots by converting them to WebP or AVIF, or by capping their dimensions. Runs on your own device — nothing is uploaded and there is no file limit.",
    intro: [
      "Most oversized images are oversized for one of two reasons: the wrong format, or dimensions far larger than anything will ever display them at. Both are fixable here, and the second usually matters more than the first.",
      "Drop a folder, set a longest-edge cap under Advanced, pick a preset, and everything comes back as one zip.",
    ],
    pairs: [
      ["png", "webp"],
      ["jpeg", "webp"],
      ["png", "avif"],
      ["jpeg", "avif"],
      ["png", "jpeg"],
      ["bmp", "png"],
      ["tiff", "jpeg"],
    ],
    points: [
      {
        heading: "Resizing beats re-compressing",
        body: "A 4000px photograph displayed in a 800px column is carrying twenty-five times the pixels it needs. Capping the longest edge under Advanced will nearly always save more than any change of format or quality setting.",
      },
      {
        heading: "WebP is the safe modern choice, AVIF the aggressive one",
        body: "WebP is typically a third smaller than JPEG and is supported by every current browser and most software. AVIF is smaller still, encodes more slowly, and is refused by a fair amount of non-browser software. Pick by audience.",
      },
      {
        heading: "The presets are a real trade, not a placebo",
        body: "Smallest, Balanced and Best pass genuinely different quality values to the encoder, and the size difference in the results is measurable. Lossless does not re-encode lossily at all — on a target that cannot express that, the row says so rather than pretending.",
      },
    ],
  },
  {
    slug: "video-to-gif",
    title: "Turn a video into a GIF",
    metaTitle: "Convert video to animated GIF — MP4, MOV, WebM to GIF | Onhand",
    description:
      "Make an animated GIF from a video clip, in your browser. Plays inline in chat, issues and READMEs with no player and no sound. Nothing is uploaded.",
    intro: [
      "A GIF is what survives being pasted somewhere a video will not play: a bug report, a chat message, a README, an email. No player, no controls, no sound, and it starts the moment it appears.",
      "The trade is size and colour. GIF holds 256 colours per frame and compresses like it is 1987, so the presets here control frame rate and width — the two dials that actually decide how big the result is.",
    ],
    target: "gif",
    pairs: [
      ["mp4", "gif"],
      ["mov", "gif"],
      ["webm", "gif"],
      ["mkv", "gif"],
      ["avi", "gif"],
    ],
    points: [
      {
        heading: "Keep it short",
        body: "GIF has no inter-frame compression worth the name. Ten seconds at 12 frames a second is 120 full images; the same clip as MP4 would be a fraction of the size. If the destination accepts video, send video.",
      },
      {
        heading: "The presets are frame rate and width",
        body: "Smallest is 10 fps at 360px wide, Balanced 12 fps at 480px, Best 15 fps at 640px. Quality settings in the usual sense do not apply — a GIF's size is decided by how many frames there are and how wide they are.",
      },
      {
        heading: "The audio is dropped, because GIF has none",
        body: "There is no soundtrack in the format. If the audio matters, extract it separately or keep the video.",
      },
      {
        heading: "This one needs the full engine",
        body: "Building a GIF means generating an optimal 256-colour palette from the clip and then applying it, which is a filter graph rather than a codec. That is ffmpeg's job, so this pair downloads a 9.7 MB engine the first time — once, then cached, and the page says so before it starts.",
      },
    ],
  },
  {
    slug: "images-to-pdf",
    title: "Combine images into a PDF",
    metaTitle: "Convert images to PDF — JPG, PNG, HEIC to PDF in your browser | Onhand",
    description:
      "Turn photos, screenshots or scans into a single PDF document. Runs entirely in your browser — no upload, no account, no watermark, no page limit.",
    intro: [
      "The form wants a PDF and you have photographs. Insurance claims, expense receipts, signed pages photographed on a desk, a scanned passport for a visa application.",
      "This is the conversion people are most often asked to do with the most sensitive documents they own, which is exactly why it should not involve uploading them to somebody's server.",
    ],
    target: "pdf",
    pairs: [
      ["jpeg", "pdf"],
      ["png", "pdf"],
      ["heic", "pdf"],
      ["tiff", "pdf"],
      ["webp", "pdf"],
    ],
    points: [
      {
        heading: "Multiple images become one document",
        body: "Select them all at once; the order is the order they appear in the queue. Multi-page TIFFs become multi-page PDFs.",
      },
      {
        heading: "No watermark, ever",
        body: "There is no paid tier for this to advertise. The output is a plain PDF with your images on the pages and nothing added.",
      },
      {
        heading: "Nothing leaves the machine",
        body: "The counter at the top of the page measures the bytes this page sends, and it stays at zero while you work. Open DevTools and watch the Network tab if you would rather check than take our word for it.",
      },
    ],
  },
  {
    slug: "remove-exif",
    title: "Strip location data from photos",
    metaTitle: "Remove EXIF and GPS data from photos — offline, in your browser | Onhand",
    description:
      "Photos record where they were taken. Remove EXIF and GPS metadata by converting them in your browser — the file never leaves your device, which is rather the point.",
    intro: [
      "Every photo a phone takes records the coordinates it was taken at, along with the device, the lens and the timestamp. For a picture of your living room posted to a forum, that is your home address travelling with the image.",
      "Converting an image here removes it. Not as an option you have to find — as an unavoidable consequence of how the conversion works.",
    ],
    pairs: [
      ["heic", "jpeg"],
      ["png", "jpeg"],
      ["jpeg", "webp"],
      ["png", "webp"],
    ],
    points: [
      {
        heading: "Why it cannot survive",
        body: "The image is decoded to raw pixels and re-encoded from those pixels. EXIF is a block of tags attached alongside the image data, not part of it, so there is nowhere for it to go. Converting a JPEG to a JPEG is enough — the format need not change. It is also why the result is the same whether the Strip metadata box is ticked or not: that switch is for audio and video tags, where ffmpeg can be told either way.",
      },
      {
        heading: "Uploading to a stripping service defeats the purpose",
        body: "Every other free EXIF remover works by receiving your photograph, and the coordinates arrive with it. Whatever their policy says, the data was transmitted. Here it is not: this page has no server to send it to.",
      },
      {
        heading: "Orientation is preserved, which is the one tag you want",
        body: "EXIF also stores which way up the camera was held. That is applied to the pixels before the tags are discarded, so the photo comes out the right way round rather than sideways — a mistake plenty of strippers make.",
      },
    ],
  },
];

/**
 * Tools whose linked pairs all exist. Same discipline as the pair table: a page
 * that links to a conversion we cannot perform is worse than no page.
 */
export const TOOLS: Tool[] = RAW.map((tool) => {
  const known = new Set(PAIRS.map((p) => `${p.source}>${p.target}`));
  const pairs = tool.pairs.filter(([s, t]) => {
    const ok = known.has(`${s}>${t}`);
    if (!ok) console.warn(`tools.ts: ${tool.slug} links ${s} → ${t}, which has no page`);
    return ok;
  });
  return { ...tool, pairs };
});

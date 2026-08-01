import { FORMATS, type FormatId } from "./formats";
import { ConversionError } from "./types";

/**
 * Pre-flight memory guardrail.
 *
 * wasm32 cannot address more than 4 GB, and in practice a browser tab falls
 * over well before that. Without this check, an oversized file produces a
 * crashed tab several minutes into a conversion — taking the entire queue with
 * it and giving the person no idea which file was at fault.
 *
 * A refusal up front is a worse experience than success and a better one than
 * that. The estimate is deliberately rough; the thresholds carry the caution.
 */

/**
 * Peak working memory as a multiple of input size.
 *
 * Numbers are conservative and reflect what each path actually holds at once,
 * not what it ideally would. ffmpeg is the expensive one: the input file, the
 * output file, and the decoded frame buffers all live in the same wasm heap
 * simultaneously, because its virtual filesystem is that heap.
 */
const MULTIPLIER: Partial<Record<string, number>> = {
  // Images decode to raw RGBA, which for a compressed source is a large jump —
  // a 5 MB JPEG is ~100 MB of pixels. Bounded in practice by dimensions, not
  // file size, so this stays high to stay safe.
  image: 20,
  document: 12,
  // Streamed through ffmpeg's virtual filesystem: in + out + working set.
  audio: 8,
  video: 6,
};

/** Warn the user, but proceed. */
export const WARN_BYTES = 1.2 * 1024 ** 3;
/** Refuse — past here a crash is likelier than a result. */
export const LIMIT_BYTES = 1.8 * 1024 ** 3;

export interface MemoryEstimate {
  peakBytes: number;
  /** True when we should tell the user this may be slow or may fail. */
  warn: boolean;
  /** True when we refuse to start. */
  exceeds: boolean;
}

export function estimatePeakMemory(
  inputBytes: number,
  source: FormatId,
  target: FormatId,
): MemoryEstimate {
  const kind = FORMATS[source].kind;
  // Take the worse of the two sides: a video going to WAV explodes on output,
  // not input, and looking only at the source would miss that entirely.
  const multiplier = Math.max(MULTIPLIER[kind] ?? 8, MULTIPLIER[FORMATS[target].kind] ?? 8);
  const peakBytes = inputBytes * multiplier;
  return {
    peakBytes,
    warn: peakBytes >= WARN_BYTES,
    exceeds: peakBytes >= LIMIT_BYTES,
  };
}

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function assertWithinMemoryBudget(
  inputBytes: number,
  source: FormatId,
  target: FormatId,
): void {
  const estimate = estimatePeakMemory(inputBytes, source, target);
  if (!estimate.exceeds) return;

  throw new ConversionError(
    "too-large",
    `This file is too large to convert in the browser.`,
    {
      // Say why, and say what would work. "Too large" with no number is the
      // kind of error message that makes people assume the tool is broken.
      suggestion:
        `Converting it needs roughly ${gb(estimate.peakBytes)} of memory, and a browser tab ` +
        `has about ${gb(LIMIT_BYTES)} to work with. Trimming it to a shorter section, or ` +
        `splitting it in two, will get it under the limit.`,
    },
  );
}

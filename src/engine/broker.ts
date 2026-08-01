import { probeCapabilities } from "./capabilities";
import { FORMATS, renameTo, type FormatId } from "./formats";
import { imageEngine, prewarmImages } from "./engines/imageEngine";
import { pdfEngine } from "./engines/pdfEngine";
import { mediaEngine } from "./engines/mediaEngine";
import { ffmpegEngine } from "./engines/ffmpegEngine";
import { assertWithinMemoryBudget } from "./memory";
import {
  ConversionError,
  type ConvertOptions,
  type Engine,
  type JobResult,
  type ProgressUpdate,
} from "./types";

/**
 * Chooses which engine runs a job, and falls through when one fails.
 *
 * The user picks a target format and nothing else. They never see an engine
 * name, never choose between "fast" and "compatible", and never get told that
 * WebCodecs is unavailable in their browser — the broker just quietly uses the
 * next capable thing. That is prime directive 3.
 */

// Order here is irrelevant — enginesFor sorts by cost, so the cheap path always
// gets first refusal and ffmpeg is the last resort.
const ENGINES: Engine[] = [imageEngine, pdfEngine, mediaEngine, ffmpegEngine];

export function registerEngine(engine: Engine): void {
  if (!ENGINES.some((e) => e.id === engine.id)) ENGINES.push(engine);
}

export async function enginesFor(source: FormatId, target: FormatId): Promise<Engine[]> {
  const caps = await probeCapabilities();
  return ENGINES.filter((e) => e.canHandle(source, target, caps)).sort((a, b) => a.cost - b.cost);
}

export async function canConvert(source: FormatId, target: FormatId): Promise<boolean> {
  return (await enginesFor(source, target)).length > 0;
}

/**
 * Load the codecs a pair will need, ahead of the click that needs them.
 *
 * Image engine only, and that restriction is the whole design. ffmpeg's core is
 * 9.7 MB; fetching that on the chance someone might convert a video would
 * quietly spend most of a phone's data allowance on a page they may bounce off.
 * The image codecs are 200 KB–1.5 MB and are what the overwhelming majority of
 * visits actually use.
 *
 * Never throws and never blocks anything — call it and forget it.
 */
export async function prewarm(source: FormatId, target: FormatId): Promise<void> {
  try {
    if (!imageEngine.canHandle(source, target, await probeCapabilities())) return;
    await prewarmImages(source, target);
  } catch {
    // Purely an optimisation. The real conversion reports real errors.
  }
}

export async function convert(
  file: File,
  source: FormatId,
  target: FormatId,
  options: ConvertOptions,
  onProgress: (u: ProgressUpdate) => void,
  signal?: AbortSignal,
): Promise<JobResult> {
  const candidates = await enginesFor(source, target);

  if (candidates.length === 0) {
    // Say what IS possible rather than just refusing — a dead end with no exit
    // is how people conclude the whole site is broken.
    const alternatives = Object.values(FORMATS)
      .filter((f) => f.encodable && f.id !== target)
      .map((f) => f.label)
      .slice(0, 4)
      .join(", ");
    throw new ConversionError(
      "unsupported",
      `${FORMATS[source].label} to ${FORMATS[target].label} isn't supported.`,
      { suggestion: alternatives ? `You can convert this to: ${alternatives}.` : undefined },
    );
  }

  // Refuse before the work starts rather than after five minutes of encoding
  // ends in a tab crash that loses the whole queue.
  assertWithinMemoryBudget(file.size, source, target);

  const started = performance.now();
  let lastError: unknown;

  for (const engine of candidates) {
    if (signal?.aborted) throw new ConversionError("internal", "Cancelled");
    try {
      const { blob, filename } = await engine.convert(
        file,
        source,
        target,
        options,
        onProgress,
        signal,
      );
      return {
        blob,
        filename: filename ?? renameTo(file.name, target),
        bytesIn: file.size,
        bytesOut: blob.size,
        engineId: engine.id,
        durationMs: Math.round(performance.now() - started),
      };
    } catch (err) {
      lastError = err;
      // An unsupported/corrupt verdict is the file's fault, not the engine's —
      // another engine will reach the same conclusion, so stop rather than
      // making the user wait through a pointless second attempt.
      if (
        err instanceof ConversionError &&
        (err.kind === "unsupported" || err.kind === "corrupt")
      ) {
        throw err;
      }
      // Anything else: try the next engine silently.
    }
  }

  if (lastError instanceof ConversionError) throw lastError;
  throw new ConversionError(
    "internal",
    `Converting ${FORMATS[source].label} to ${FORMATS[target].label} failed.`,
    { cause: lastError },
  );
}

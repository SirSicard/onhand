import { probeCapabilities } from "./capabilities";
import { FORMATS, renameTo, type FormatId } from "./formats";
import { imageEngine } from "./engines/imageEngine";
import { pdfEngine } from "./engines/pdfEngine";
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

const ENGINES: Engine[] = [imageEngine, pdfEngine];

/** Registration point for the ffmpeg and WebCodecs engines in P2. */
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

  const started = performance.now();
  let lastError: unknown;

  for (const engine of candidates) {
    if (signal?.aborted) throw new ConversionError("internal", "Cancelled");
    try {
      const { blob, filename } = await engine.convert(
        file, source, target, options, onProgress, signal,
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
      if (err instanceof ConversionError && (err.kind === "unsupported" || err.kind === "corrupt")) {
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

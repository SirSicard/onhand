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

/**
 * Try every capable engine in cost order. Throws if all of them fail.
 *
 * Split out of `convert` so the two-hop recovery below can reuse it without
 * recursing through the public entry point — recursion there would re-run the
 * memory guard against the wrong file and could loop.
 */
async function runEngines(
  file: File,
  source: FormatId,
  target: FormatId,
  options: ConvertOptions,
  onProgress: (u: ProgressUpdate) => void,
  signal: AbortSignal | undefined,
  candidates: Engine[],
): Promise<{ blob: Blob; filename?: string; engineId: string }> {
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
      return { blob, filename, engineId: engine.id };
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

/**
 * Targets that sometimes fail in one hop but succeed in two, and what to hop
 * through.
 *
 * Opus is the case, and the reason is a genuine defect rather than a missing
 * feature: the bundled ffmpeg (5.1.4) has a libopus that faults on ANY stereo
 * input. Verified — mono encodes fine, stereo dies identically regardless of
 * container or source codec, and there is no newer @ffmpeg/core to move to
 * (0.12.10 is latest).
 *
 * It only bites when ffmpeg is the ONLY engine that can read the source, since
 * WebCodecs handles Opus directly everywhere else. A stereo AVI is the live
 * example: mediabunny cannot demux AVI, so the job falls to ffmpeg, and then
 * the encoder faults on audio that is perfectly ordinary.
 *
 * Both halves work on their own — ffmpeg's PCM path is fine, and the browser's
 * Opus encoder is fine — so the fix is to compose them rather than fight the
 * defect. WAV as the intermediate because it is lossless, so the extra hop
 * costs quality nothing; it costs memory, which is why the second leg is
 * budget-checked against the WAV rather than the original.
 *
 * Deliberately a LAST resort, not a default: one hop is faster, and this path
 * should stay dead on every browser that never hits the defect.
 */
const BRIDGE_VIA: Partial<Record<FormatId, FormatId>> = { opus: "wav" };

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

  const done = (blob: Blob, filename: string | undefined, engineId: string): JobResult => ({
    blob,
    filename: filename ?? renameTo(file.name, target),
    bytesIn: file.size,
    bytesOut: blob.size,
    engineId,
    durationMs: Math.round(performance.now() - started),
  });

  try {
    const r = await runEngines(file, source, target, options, onProgress, signal, candidates);
    return done(r.blob, r.filename, r.engineId);
  } catch (err) {
    const via = BRIDGE_VIA[target];
    if (!via || signal?.aborted || err instanceof ConversionError === false) throw err;
    // Only worth a second attempt when the first was an engine giving up, not
    // when the file itself is the problem.
    if (err.kind === "corrupt") throw err;

    const legOne = await enginesFor(source, via);
    const legTwo = await enginesFor(via, target);
    if (legOne.length === 0 || legTwo.length === 0) throw err;

    try {
      // Two encodes behind one progress bar. Each leg reports over its own half
      // rather than the bar resetting to zero halfway, which reads as a crash.
      const scaled = (offset: number) => (u: ProgressUpdate) =>
        onProgress({
          progress:
            u.progress === null || u.progress === undefined ? null : offset + u.progress / 2,
        });

      const mid = await runEngines(file, source, via, options, scaled(0), signal, legOne);
      const midFile = new File([mid.blob], renameTo(file.name, via), {
        type: FORMATS[via].mime,
      });
      // The intermediate is uncompressed, so it can be far larger than the
      // input. Budget-check it rather than assume the first check still holds.
      assertWithinMemoryBudget(midFile.size, via, target);

      const out = await runEngines(midFile, via, target, options, scaled(0.5), signal, legTwo);
      return done(out.blob, renameTo(file.name, target), `${mid.engineId}+${out.engineId}`);
    } catch {
      // The bridge is a recovery, not a second opinion. If it fails too, the
      // first failure is the one that explains what happened.
      throw err;
    }
  }
}

import type { FormatId } from "./formats";
import type { Capabilities } from "./capabilities";

/** What the user asked for, independent of which engine ends up doing it. */
export interface ConvertOptions {
  /** 1–100 for lossy targets. Ignored by lossless encoders. */
  quality?: number;
  /** Longest-edge cap in px. Undefined means keep original dimensions. */
  maxDimension?: number;
  /**
   * Strip EXIF/GPS on output. Defaults ON — a converter that silently preserves
   * the GPS coordinates of someone's house in a photo they're about to post is
   * doing them harm, and nobody reads the advanced panel.
   */
  stripMetadata?: boolean;
}

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface JobResult {
  blob: Blob;
  filename: string;
  bytesIn: number;
  bytesOut: number;
  /** Which engine actually ran it — for diagnostics, never shown as a choice. */
  engineId: string;
  durationMs: number;
}

export interface Job {
  id: string;
  file: File;
  source: FormatId;
  target: FormatId;
  options: ConvertOptions;
  status: JobStatus;
  /** 0–1, or null when the engine genuinely can't report it. Never fake a number. */
  progress: number | null;
  result?: JobResult;
  error?: ConversionError;
}

/**
 * Errors carry a human sentence, because "Error: 0x80004005" is how every other
 * converter tells you your afternoon is wasted.
 */
export class ConversionError extends Error {
  readonly kind: "unsupported" | "corrupt" | "too-large" | "internal";
  /** Something concrete the person can actually do. */
  readonly suggestion?: string;

  constructor(
    kind: ConversionError["kind"],
    message: string,
    options?: { suggestion?: string; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "ConversionError";
    this.kind = kind;
    this.suggestion = options?.suggestion;
  }
}

export interface ProgressUpdate {
  /** 0–1, or null if unknowable for this engine/format. */
  progress: number | null;
}

/**
 * An engine converts some subset of format pairs.
 *
 * The broker picks between them; the user never sees this concept. If an engine
 * throws, the broker falls through to the next capable one silently — a person
 * who dropped a .mov wants an .mp4, not a lecture about WebCodecs.
 */
export interface Engine {
  readonly id: string;
  /** Cheap synchronous check — no wasm loading allowed here. */
  canHandle(source: FormatId, target: FormatId, caps: Capabilities): boolean;
  /** Lower wins when several engines can do the job. */
  readonly cost: number;
  convert(
    file: File,
    source: FormatId,
    target: FormatId,
    options: ConvertOptions,
    onProgress: (u: ProgressUpdate) => void,
    signal?: AbortSignal,
  ): Promise<{ blob: Blob }>;
}

export function newJobId(): string {
  return crypto.randomUUID();
}

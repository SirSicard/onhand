/**
 * Notifications about an engine downloading itself.
 *
 * Deliberately its own module with no imports. The UI needs to subscribe to
 * this on mount, and if it had to import the ffmpeg engine to do so, the whole
 * ffmpeg module — and its worker chunk — would land in the initial bundle. That
 * would defeat the lazy load this notice exists to explain: everyone would pay
 * for the engine on first paint, including the majority who only ever convert
 * an image and never need it at all.
 */

export interface EngineLoadState {
  loading: boolean;
  /** 0–1 while downloading, or null when the size genuinely isn't known yet. */
  progress: number | null;
}

export type EngineLoadListener = (state: EngineLoadState) => void;

const listeners = new Set<EngineLoadListener>();

export function onEngineLoad(fn: EngineLoadListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function announceEngineLoad(state: EngineLoadState): void {
  for (const fn of listeners) fn(state);
}

/** Roughly what the user is about to download, for the one-time notice. */
export const FFMPEG_DOWNLOAD_MB = 32;

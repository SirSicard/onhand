import { describe, it, expect } from "vitest";
import { looksLikeMemoryExhaustion, shouldDiscardInstance } from "./engines/ffmpegEngine";

/**
 * These two judgements decide whether the user is told something true and
 * whether the next job in a batch has a working engine. Both were wrong, and
 * both were wrong in ways that only appeared under load.
 */

/** The exact string emscripten produced on CI. Not paraphrased. */
const REAL_OOM = `RuntimeError: Out of bounds memory access (evaluating 'Module["_malloc"](len*SIZE_I32)')`;

describe("looksLikeMemoryExhaustion", () => {
  it("recognises the message CI actually produced", () => {
    // An earlier version matched "memory access out of bounds" — the same words
    // in the wrong order — so it never fired, and the instance was never reset.
    expect(looksLikeMemoryExhaustion(REAL_OOM)).toBe(true);
  });

  it("recognises the other phrasings emscripten uses", () => {
    for (const m of [
      "Aborted(OOM)",
      "abort(OOM). Build with -sASSERTIONS",
      "Cannot enlarge memory arrays",
      "memory allocation failed",
      "Out of memory",
    ]) {
      expect(looksLikeMemoryExhaustion(m), m).toBe(true);
    }
  });

  it("does not call an ordinary codec failure a memory problem", () => {
    // Claiming "too large" for a small broken file sends the user off to trim
    // something that was never the issue.
    for (const m of [
      "Invalid data found when processing input",
      "Error opening output files",
      "Encoder not found",
      "moov atom not found",
    ]) {
      expect(looksLikeMemoryExhaustion(m), m).toBe(false);
    }
  });
});

describe("shouldDiscardInstance", () => {
  it("discards after a wasm fault, so the next job gets a fresh engine", () => {
    // The cascade this prevents: one OOM, then seven consecutive jobs failing
    // in ~70ms each against a heap that was already dead.
    for (const m of [REAL_OOM, "Aborted()", "RuntimeError: unreachable executed"]) {
      expect(shouldDiscardInstance(m), m).toBe(true);
    }
  });

  it("keeps the instance for an ordinary bad-input failure", () => {
    // Reloading 9.7 MB because one file was malformed would be its own bug.
    for (const m of ["Invalid data found when processing input", "Encoder not found"]) {
      expect(shouldDiscardInstance(m), m).toBe(false);
    }
  });
});

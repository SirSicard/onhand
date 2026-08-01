import { describe, it, expect } from "vitest";
import { createWorkerHost } from "./workerHost";

/**
 * The failure this exists to prevent: a worker dies while calls are in flight,
 * Comlink's promises never settle, and the queue sits at "Converting…" for the
 * rest of the session. Nothing times out. Nothing rejects. It just stops.
 */

interface Api {
  slow(ms: number): Promise<string>;
}

/** A worker that answers slowly, so a call is genuinely in flight when we kill it. */
function makeWorker(): Worker {
  const blob = new Blob(
    [
      `self.onmessage = (e) => {
         // Deliberately never replies. The point is to have a call outstanding.
       };`,
    ],
    { type: "text/javascript" },
  );
  return new Worker(URL.createObjectURL(blob));
}

describe("createWorkerHost", () => {
  it("rejects in-flight calls when the worker is reset, instead of hanging", async () => {
    const host = createWorkerHost<Api>(makeWorker, "test");

    // Three calls that will never get a reply.
    const calls = [1, 2, 3].map(() => host.call((api) => api.slow(60_000)));
    // Let them actually dispatch.
    await new Promise((r) => setTimeout(r, 50));

    host.reset();

    const settled = await Promise.allSettled(calls);
    expect(settled.every((s) => s.status === "rejected")).toBe(true);
    for (const s of settled) {
      expect((s as PromiseRejectedResult).reason.message).toMatch(/restarted|stopped/i);
    }
  }, 20_000);

  it("settles rather than hanging — the whole point, stated as a deadline", async () => {
    const host = createWorkerHost<Api>(makeWorker, "test");
    const call = host.call((api) => api.slow(60_000));
    await new Promise((r) => setTimeout(r, 50));
    host.reset();

    // If this ever regresses, the promise never settles and this races to the
    // timeout — which is exactly the user-visible symptom.
    const outcome = await Promise.race([
      call.then(() => "resolved").catch(() => "rejected"),
      new Promise<string>((r) => setTimeout(() => r("HUNG"), 3000)),
    ]);
    expect(outcome).toBe("rejected");
  }, 20_000);

  it("creates a fresh worker after a reset", async () => {
    const host = createWorkerHost<Api>(makeWorker, "test");
    // Every call is caught: reset() rejects them by design, and an unhandled
    // rejection would fail the run for a reason that is the test's doing.
    const swallow = () => {};

    host.call((api) => api.slow(1)).catch(swallow);
    await new Promise((r) => setTimeout(r, 50));
    expect(host.isAlive()).toBe(true);

    host.reset();
    expect(host.isAlive()).toBe(false);

    host.call((api) => api.slow(1)).catch(swallow);
    expect(host.isAlive()).toBe(true);
    host.reset();
    await new Promise((r) => setTimeout(r, 10));
  }, 20_000);
});

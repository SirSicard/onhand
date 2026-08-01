import { describe, it, expect } from "vitest";
import { createWorkerHost, withStallTimeout } from "./workerHost";

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

describe("withStallTimeout", () => {
  it("rejects when nothing reports progress", async () => {
    // The CI failure this exists for: a conversion that accepts the job and
    // then never produces output.
    let cancelled = false;
    const forever = new Promise<string>(() => {});
    const { result } = withStallTimeout(forever, 200, () => {
      cancelled = true;
    });

    await expect(result).rejects.toThrow(/stalled/i);
    expect(cancelled, "should cancel the underlying work").toBe(true);
  }, 10_000);

  it("lets a slow job through as long as it keeps ticking", async () => {
    // A 2 GB video legitimately takes minutes. It must not be killed for being
    // slow, only for being silent — which is why this is a stall detector and
    // not a time limit.
    let done: (v: string) => void;
    const slow = new Promise<string>((r) => (done = r));
    const { result, tick } = withStallTimeout(slow, 200);

    // Five stall windows' worth of elapsed time, with progress throughout.
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 100));
      tick();
    }
    done!("finished");
    await expect(result).resolves.toBe("finished");
  }, 10_000);

  it("stops its timer once settled, so it cannot fire later", async () => {
    const { result } = withStallTimeout(Promise.resolve("ok"), 100);
    await expect(result).resolves.toBe("ok");
    // If the interval survived, this wait would produce an unhandled rejection
    // and fail the run.
    await new Promise((r) => setTimeout(r, 400));
  }, 10_000);
});

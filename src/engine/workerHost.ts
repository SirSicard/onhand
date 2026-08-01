import * as Comlink from "comlink";

/**
 * A lazily-created, shared worker whose in-flight calls cannot outlive it.
 *
 * Comlink turns a worker message into a promise that settles when the reply
 * arrives. If the worker dies first — OOM kill, a module that fails to load,
 * the browser reclaiming memory under pressure — no reply ever arrives and
 * every pending promise stays pending **forever**. Nothing times out, nothing
 * rejects, and the UI sits at "Converting…" for the rest of the session.
 *
 * That is not hypothetical: a ten-file batch stalled at 6 of 10 for the full
 * two-minute test budget while the engine, run directly, finished the same work
 * in 234 ms. The four missing files were waiting on a worker that no longer
 * existed.
 *
 * So every call registers its own reject, and a worker-level error rejects all
 * of them. The difference is "four files failed, here's why" instead of a queue
 * that never finishes.
 */
export interface WorkerHost<Api> {
  /** Run one call against the shared worker. */
  call<R>(fn: (api: Comlink.Remote<Api>) => Promise<R>): Promise<R>;
  /** Discard the instance — for genuine corruption, not per-file failures. */
  reset(): void;
  /** True when a worker is currently alive. Test/diagnostic use. */
  isAlive(): boolean;
}

export function createWorkerHost<Api>(create: () => Worker, label: string): WorkerHost<Api> {
  let handle: { worker: Worker; api: Comlink.Remote<Api> } | null = null;
  const pending = new Set<(reason: Error) => void>();

  function fail(message: string) {
    const error = new Error(message);
    // Copy first: rejecting runs .finally handlers that mutate the set.
    for (const reject of [...pending]) reject(error);
    pending.clear();
  }

  function get() {
    if (!handle) {
      const worker = create();

      // A worker-level failure is the ONLY thing that justifies discarding the
      // instance. Per-file decode errors must not — the worker is shared, and
      // terminating it on one bad file strands every concurrent job.
      worker.addEventListener("error", (event) => {
        if (handle?.worker === worker) handle = null;
        worker.terminate();
        fail(event.message || `The ${label} worker stopped unexpectedly.`);
      });

      handle = { worker, api: Comlink.wrap<Api>(worker) };
    }
    return handle;
  }

  return {
    call(fn) {
      const { api } = get();
      return new Promise((resolve, reject) => {
        pending.add(reject);
        fn(api)
          .then(resolve, reject)
          .finally(() => pending.delete(reject));
      });
    },
    reset() {
      handle?.worker.terminate();
      handle = null;
      fail(`The ${label} worker was restarted.`);
    },
    isAlive() {
      return handle !== null;
    },
  };
}

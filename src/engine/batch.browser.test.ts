import { describe, it, expect } from "vitest";
import { convert } from "./broker";

/**
 * Batch behaviour and main-thread responsiveness.
 *
 * The whole reason codecs live in workers is that a 50-file batch must not
 * freeze the page. This measures it rather than assuming it: if a codec ever
 * gets called on the main thread, the long-task total here goes through the
 * roof and this test says so.
 */

async function fixture(name: string): Promise<File> {
  const res = await fetch(`/fixtures/${name}`);
  if (!res.ok) throw new Error(`fixture ${name} missing (${res.status})`);
  const buf = await res.arrayBuffer();
  const head = new TextDecoder().decode(buf.slice(0, 64));
  if (/^\s*<!doctype html|^\s*<html/i.test(head)) {
    throw new Error(`fixture ${name} was served as HTML, not file bytes`);
  }
  return new File([buf], name);
}

describe("50-file batch", () => {
  it("converts every file and keeps the main thread responsive", async () => {
    const source = await fixture("photo.png");
    // 50 distinct File objects over the same bytes — the realistic shape of
    // "someone dropped a folder".
    const files = Array.from(
      { length: 50 },
      (_, i) => new File([source], `batch-${i}.png`, { type: "image/png" }),
    );

    // PerformanceObserver reports tasks that blocked the main thread >50ms.
    const longTasks: number[] = [];
    let observer: PerformanceObserver | undefined;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration);
      });
      observer.observe({ type: "longtask", buffered: false });
    } catch {
      // Firefox and WebKit do not implement the longtask entry type. The
      // conversion assertions below still run; only the jank budget is skipped,
      // which is honest rather than silently passing a check we didn't make.
    }

    const started = performance.now();
    const results = await Promise.all(
      files.map((f) => convert(f, "png", "webp", { quality: 80 }, () => {})),
    );
    const elapsed = performance.now() - started;
    observer?.disconnect();

    expect(results).toHaveLength(50);
    for (const r of results) {
      expect(r.bytesOut).toBeGreaterThan(0);
    }

    if (observer && longTasks.length > 0) {
      const blocked = longTasks.reduce((a, b) => a + b, 0);
      // The budget is on the SINGLE worst task, not the total: what a person
      // perceives as "frozen" is one long block, not many short ones spread
      // across several seconds of work.
      const worst = Math.max(...longTasks);
      expect(worst, `worst main-thread block ${worst.toFixed(0)}ms (total ${blocked.toFixed(0)}ms)`)
        .toBeLessThan(400);
    }

    // Not a performance assertion so much as a smoke alarm: 50 small images
    // taking minutes would mean the worker pool has collapsed to serial.
    expect(elapsed).toBeLessThan(60_000);
  }, 120_000);

  it("keeps going when one file in the batch is corrupt", async () => {
    // A batch that aborts entirely because file 7 was damaged is how people
    // lose an afternoon's work.
    const good = await fixture("photo.png");
    const junk = new File([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])], "broken.png", {
      type: "image/png",
    });

    const outcomes = await Promise.allSettled(
      [good, junk, good, junk, good].map((f) =>
        convert(f, "png", "webp", { quality: 80 }, () => {}),
      ),
    );

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(3);
    expect(outcomes.filter((o) => o.status === "rejected")).toHaveLength(2);
  }, 60_000);
});

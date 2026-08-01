import { describe, it, expect, beforeEach, vi } from "vitest";
import { installUploadMonitor, getSentBytes, __resetUploadMonitor } from "./uploadMonitor";

/**
 * These tests exist because the first implementation of this counter was wrong
 * in the most damaging possible way: it summed PerformanceResourceTiming's
 * `transferSize`, which is bytes RECEIVED. Loading a sample image made it read
 * "600 B uploaded" — actively disproving the one claim the product makes.
 */
describe("uploadMonitor", () => {
  beforeEach(() => {
    __resetUploadMonitor();
    // jsdom-free: stub the globals the monitor patches.
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok")));
    class FakeXHR {
      send() {}
    }
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    installUploadMonitor();
  });

  it("does not count downloads", async () => {
    // A GET has no body. Fetching a 10 MB file must still read zero uploaded.
    await fetch("/samples/checker.png");
    await fetch("/some/large/asset.wasm");
    expect(getSentBytes()).toBe(0);
  });

  it("counts a string body", async () => {
    await fetch("/x", { method: "POST", body: "hello" });
    expect(getSentBytes()).toBe(5);
  });

  it("counts a Blob body by its real size", async () => {
    await fetch("/x", { method: "POST", body: new Blob([new Uint8Array(1024)]) });
    expect(getSentBytes()).toBe(1024);
  });

  it("counts typed arrays and ArrayBuffers", async () => {
    await fetch("/x", { method: "POST", body: new Uint8Array(256) });
    await fetch("/y", { method: "POST", body: new ArrayBuffer(128) });
    expect(getSentBytes()).toBe(384);
  });

  it("counts file bytes inside FormData — the realistic leak shape", async () => {
    // If an upload ever gets added, this is almost certainly how it arrives.
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array(2048)], "photo.jpg"));
    await fetch("/upload", { method: "POST", body: fd });
    expect(getSentBytes()).toBeGreaterThanOrEqual(2048);
  });

  it("accumulates across requests", async () => {
    await fetch("/a", { method: "POST", body: "12345" });
    await fetch("/b", { method: "POST", body: "678" });
    expect(getSentBytes()).toBe(8);
  });
});

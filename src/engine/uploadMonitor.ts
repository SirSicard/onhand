/**
 * Counts bytes this page SENDS to the network.
 *
 * This is the product's central claim made checkable, so it has to be right.
 *
 * The obvious implementation — summing `transferSize` from PerformanceObserver —
 * is wrong: `transferSize` is bytes *received*. Wired that way the counter reads
 * "600 B uploaded" after merely loading a sample image, which is worse than
 * having no counter at all, because it disproves the thing it exists to prove.
 *
 * PerformanceResourceTiming exposes no request-body size, so the only honest way
 * to measure outgoing bytes is to wrap the two APIs that can send them.
 *
 * Deliberately NOT counted: request headers, cookies, TLS overhead, and the
 * bytes of the URL itself. Those are unavoidable in any HTTP request and are not
 * what "uploaded" means to someone asking whether their file left the machine.
 * We count request bodies — which for Onhand should be zero, forever.
 */

let sentBytes = 0;
const listeners = new Set<(n: number) => void>();
let installed = false;

function add(n: number) {
  if (n <= 0) return;
  sentBytes += n;
  for (const l of listeners) l(sentBytes);
}

/** Best-effort byte length of anything acceptable as a request body. */
function bodySize(body: unknown): number {
  if (body == null) return 0;
  if (typeof body === "string") return new Blob([body]).size;
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (body instanceof FormData) {
    let total = 0;
    for (const [key, value] of body.entries()) {
      total += new Blob([key]).size;
      total += value instanceof File ? value.size : new Blob([String(value)]).size;
    }
    return total;
  }
  if (body instanceof URLSearchParams) return new Blob([body.toString()]).size;
  // ReadableStream bodies cannot be measured without consuming them. Report a
  // sentinel so the UI can say "streaming upload" rather than silently zero.
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) return -1;
  return 0;
}

export function installUploadMonitor(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const originalFetch = window.fetch;
  window.fetch = function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
    const body = init?.body ?? (input instanceof Request ? input.body : undefined);
    const size = bodySize(body);
    // -1 means an unmeasurable stream; count it as "something" rather than zero.
    add(size === -1 ? 1 : size);
    return originalFetch.call(this, input as RequestInfo, init);
  };

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function patchedSend(
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    const size = bodySize(body);
    add(size === -1 ? 1 : size);
    return originalSend.call(this, body as XMLHttpRequestBodyInit | null);
  };

  // sendBeacon is the classic telemetry escape hatch. We ship none, but if any
  // dependency ever tries, it lands in the counter rather than slipping past it.
  if (typeof navigator.sendBeacon === "function") {
    const originalBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function patchedBeacon(url: string | URL, data?: BodyInit | null) {
      add(bodySize(data) || 1);
      return originalBeacon(url, data);
    };
  }
}

export function getSentBytes(): number {
  return sentBytes;
}

export function onSentBytesChange(fn: (n: number) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Test seam. Clears the count AND the install guard, so a suite that swaps the
 * global fetch between cases can re-wrap the new one.
 */
export function __resetUploadMonitor(): void {
  sentBytes = 0;
  installed = false;
  listeners.clear();
}

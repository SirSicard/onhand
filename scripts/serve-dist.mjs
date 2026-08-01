/**
 * Serve dist/ the way Cloudflare Pages will.
 *
 * `astro preview` does not apply `_headers`, so it serves the built site
 * WITHOUT cross-origin isolation — `crossOriginIsolated` is false, and any bug
 * that only appears in the isolated state stays hidden until production. Since
 * the entire multithreaded path depends on that state, previewing without it
 * tests a different application from the one we ship.
 *
 * This is deliberately dumb: static files, the COOP/COEP pair, correct MIME
 * types for .wasm (a wrong one makes wasm instantiation fail with a message
 * about magic bytes that reads like file corruption).
 *
 *   node scripts/serve-dist.mjs [port]
 */

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)), "dist");
const PORT = Number(process.argv[2] ?? 4322);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

createServer(async (req, res) => {
  // The headers under test. Setting them on every response, including errors,
  // because that is what the _headers rule does.
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");

  const url = new URL(req.url ?? "/", "http://localhost");
  // normalize() collapses any ../ before it can escape dist/.
  let path = join(ROOT, normalize(decodeURIComponent(url.pathname)));
  if (!path.startsWith(ROOT)) {
    res.writeHead(403).end("forbidden");
    return;
  }

  try {
    let info = await stat(path);
    if (info.isDirectory()) {
      path = join(path, "index.html");
      info = await stat(path);
    }
    res.writeHead(200, {
      "content-type": TYPES[extname(path)] ?? "application/octet-stream",
      "content-length": info.size,
      "cache-control": "no-store",
    });
    createReadStream(path).pipe(res);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end(`not found: ${url.pathname}`);
  }
}).listen(PORT, () => {
  console.log(`serving dist/ with COOP+COEP on http://localhost:${PORT}`);
});

import { defineConfig } from "vitest/config";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

type BrowserName = "chromium" | "firefox" | "webkit";

/**
 * Chromium runs as the full browser in headless mode, not as Playwright's
 * default `chrome-headless-shell`.
 *
 * The shell is a separate, stripped-down binary, and it handles a wasm fault
 * differently: its renderer takes a SIGSEGV and the whole tab dies, where the
 * full browser raises a catchable `RuntimeError: memory access out of bounds`.
 * The stereo Opus test depends on that error — ffmpeg.wasm's libopus faults on
 * stereo, and the broker catches it and bridges through WAV. On the Linux
 * runner the shell crashed instead ("Received signal 11 SEGV_ACCERR", then
 * vitest's "Browser connection was closed"), which kept CI red from 2026-08-02
 * on a test that passes in the full browser. Measured on CI: that test alone
 * crashes the shell and passes on `channel: "chromium"`.
 *
 * `playwright install chromium` fetches both binaries, so CI needs no change.
 */
function instance(browser: BrowserName) {
  return browser === "chromium" ? { browser, launch: { channel: "chromium" } } : { browser };
}

/**
 * Browser-mode suite: the real conversion matrix.
 *
 * These tests cannot run in node. wasm codecs, OffscreenCanvas, createImageBitmap
 * and WebCodecs all need a genuine browser, and mocking them would test the mocks.
 *
 *   pnpm test:browser              # chromium
 *   pnpm test:browser:all          # chromium, firefox, webkit
 *
 * Cross-origin isolation is set here too, matching production. Without it
 * SharedArrayBuffer is unavailable and any multithread path silently disappears —
 * a test suite that runs un-isolated would pass while testing a different
 * configuration from the one users get.
 */
export default defineConfig({
  plugins: [
    // Tailwind must run here too, or `@import "tailwindcss"` stays raw and
    // every utility class is inert. axe then measures default black-on-white
    // and reports flawless contrast for a component shipping 2.7:1 grey —
    // which is exactly what happened: this suite passed while Lighthouse
    // failed the real page.
    tailwindcss(),
    {
      // Same dev-only fixture route as astro.config, so browser tests fetch real
      // bytes rather than an HTML fallback that fails like a broken codec.
      name: "onhand:fixtures",
      configureServer(server) {
        server.middlewares.use("/fixtures", (req, res, next) => {
          const name = decodeURIComponent((req.url ?? "").split("?")[0] ?? "").replace(/^\//, "");
          if (!name || name.includes("/") || name.includes("..")) return next();
          try {
            const data = readFileSync(
              fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
            );
            res.setHeader("content-type", "application/octet-stream");
            res.setHeader("cache-control", "no-store");
            res.end(data);
          } catch {
            res.statusCode = 404;
            res.setHeader("content-type", "text/plain");
            res.end(`fixture not found: ${name}`);
          }
        });
      },
    },
  ],
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  optimizeDeps: {
    // Pre-bundle these EXPLICITLY. They are imported only from inside workers,
    // which Vite's initial dependency scan does not walk — so it discovers them
    // mid-run, re-optimises, and invalidates the URL a worker is already
    // holding. The failure is "Failed to fetch dynamically imported module:
    // .../deps/utif.js?v=<hash>", which reads like a missing package and is a
    // race. It only appears on a COLD cache, so it passes locally and fails in
    // CI — twice, before this line existed. Listed exhaustively from the
    // workers' imports rather than one package per red CI run; the wasm codec
    // packages are deliberately absent, they belong in `exclude` below.
    include: ["utif", "pdf-lib", "pdfjs-dist", "mediabunny", "comlink"],
    // Same rule as production: wasm codec packages must not be pre-bundled or
    // their relative .wasm paths break. utif is pure JS and must NOT be here.
    exclude: [
      "@jsquash/jpeg",
      "@jsquash/png",
      "@jsquash/webp",
      "@jsquash/avif",
      "@jsquash/resize",
      "@jsquash/oxipng",
      "libheif-js",
      "@resvg/resvg-wasm",
      // @ffmpeg/ffmpeg creates its own worker via `new Worker(new URL('./worker.js',
      // import.meta.url))`. The dep optimizer rewrites that URL to a file it never
      // emits, and the failure mode is the worst kind: ff.load() hangs forever
      // with no error at all, because it is waiting for a message from a worker
      // that was never constructed.
      "@ffmpeg/ffmpeg",
    ],
  },
  test: {
    include: ["src/**/*.browser.test.ts", "src/**/*.browser.test.tsx"],
    testTimeout: 60_000, // wasm codecs load slowly on the first test
    browser: {
      enabled: true,
      provider: "playwright",
      headless: true,
      // One browser by default (fast inner loop); all three in CI and before a
      // release, because the codec differences between them are the entire
      // reason this suite exists — Chromium refuses SVG blobs, Firefox has no
      // AAC encoder, Safari decodes HEIC natively while the others cannot.
      // ONHAND_BROWSER picks exactly one. CI uses that with a job matrix so
      // each browser gets a runner to itself: three wasm-heavy browsers sharing
      // one 2-core box ran ffmpeg out of heap, and the OOM looked like a codec
      // bug rather than the memory contention it was.
      instances: process.env.ONHAND_BROWSER
        ? [instance(process.env.ONHAND_BROWSER as BrowserName)]
        : process.env.ONHAND_ALL_BROWSERS
          ? [instance("chromium"), instance("firefox"), instance("webkit")]
          : [instance("chromium")],
    },
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});

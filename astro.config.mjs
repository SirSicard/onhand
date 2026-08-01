// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

// Static output only. There is no server in this product and there never will be —
// the whole thesis is that conversion happens on the visitor's machine (BATTLEPLAN §
// prime directive 1). If something here ever needs a server adapter, that is a bug in
// the design, not a missing dependency.
export default defineConfig({
  site: "https://onhand.pages.dev",
  output: "static",
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    worker: {
      // Codec workers are ES modules (Comlink + dynamic wasm imports).
      format: "es",
    },
    build: {
      // wasm blobs are big and content-hashed; never inline them into JS.
      assetsInlineLimit: 0,
    },
    optimizeDeps: {
      // Codec packages locate their .wasm via `new URL('./x.wasm', import.meta.url)`.
      // Vite's dep pre-bundling rewrites import.meta.url, so the wasm request
      // resolves to a path that doesn't exist and the dev server answers with
      // index.html — which surfaces as the wonderfully cryptic
      //   "WebAssembly.instantiate(): expected magic word 00 61 73 6d, found 3c 21 64 6f"
      // (3c 21 64 6f is "<!do"). Excluding them keeps the URLs intact.
      exclude: [
        "@jsquash/jpeg",
        "@jsquash/png",
        "@jsquash/webp",
        "@jsquash/avif",
        "@jsquash/resize",
        "@jsquash/oxipng",
        "libheif-js",
        "@resvg/resvg-wasm",
        "@ffmpeg/ffmpeg",
        "@ffmpeg/util",
      ],
    },
  },
  server: {
    // Dev must mirror production's cross-origin isolation, otherwise
    // crossOriginIsolated is false locally and the multithread path silently
    // never engages. Mismatched dev/prod headers is exactly the class of bug
    // that only shows up after deploy.
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});

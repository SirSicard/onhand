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
      // Emscripten/wasm packages break under Vite's dep pre-bundling.
      exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
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

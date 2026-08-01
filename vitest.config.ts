import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Node-environment tests only, for pure logic. Codec work cannot be tested here —
// wasm codecs need a real browser, so engine tests move to @vitest/browser with the
// playwright provider in P1 (BATTLEPLAN P1). Keeping the two suites separate stops
// us from faking codec behaviour with mocks, which would test nothing.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    // `*.browser.test.ts` also matches the glob above, and in node those tests
    // fail for the wrong reason ("Failed to parse URL from /fixtures/...") — the
    // relative fetch has no origin, and crossOriginIsolated is undefined. They
    // belong to vitest.browser.config.ts; run them with `pnpm test:browser`.
    exclude: ["**/node_modules/**", "**/dist/**", "src/**/*.browser.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});

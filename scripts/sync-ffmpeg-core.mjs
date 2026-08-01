/**
 * Copy the ffmpeg.wasm core into public/ffmpeg/ so we serve it ourselves.
 *
 * @ffmpeg/ffmpeg defaults to loading its core from unpkg. We cannot use that,
 * for two independent reasons and either one alone would be enough:
 *
 *   1. The site sets COEP: require-corp. A cross-origin script without a
 *      Cross-Origin-Resource-Policy header is blocked outright.
 *   2. Prime directive 1 is that nothing leaves the device. A CDN fetch is a
 *      request to a third party carrying the user's IP and a referrer that says
 *      exactly which converter they are using. That it carries no file bytes is
 *      not the point.
 *
 * Runs on prebuild and predev. Copying rather than symlinking because Astro's
 * static copy of public/ follows neither symlinks nor pnpm's store layout.
 */

import { copyFile, mkdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dest = join(root, "public", "ffmpeg");

// The ESM build, not the UMD one, and this is not interchangeable.
//
// @ffmpeg/ffmpeg always constructs its worker with `type: "module"` — both
// branches of its code do, there is no classic path. `importScripts` does not
// exist in a module worker, so ffmpeg's first attempt at loading the core
// always throws and it always falls back to `await import(coreURL)`. That
// needs an ES module. Handing it the UMD build produces "Failed to fetch
// dynamically imported module", which reads like a network or path problem and
// is neither.
//
// @ffmpeg/core's "exports" map has no "./package.json" entry, so resolve the
// entry points and rewrite the condition directory rather than reading it.
const FILES = [require.resolve("@ffmpeg/core"), require.resolve("@ffmpeg/core/wasm")].map((p) =>
  p.replace(`${sep}umd${sep}`, `${sep}esm${sep}`),
);

await mkdir(dest, { recursive: true });

for (const from of FILES) {
  const name = basename(from);
  const to = join(dest, name);

  // Skip an unchanged copy — the wasm is 32 MB and this runs before every dev
  // server start.
  const [src, existing] = await Promise.all([stat(from), stat(to).catch(() => null)]);
  if (existing && existing.size === src.size) {
    console.log(`ffmpeg core: ${name} up to date (${(src.size / 1e6).toFixed(1)} MB)`);
    continue;
  }

  await copyFile(from, to);
  console.log(`ffmpeg core: copied ${name} (${(src.size / 1e6).toFixed(1)} MB)`);
}

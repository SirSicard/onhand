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

import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
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

/**
 * Cloudflare Pages refuses any single file over 25 MiB, and the core wasm is
 * 30.7 MiB — it cannot be served as a static asset at all. So it is stored
 * gzipped (9.7 MiB) and decompressed in the browser with DecompressionStream,
 * which all three engines support.
 *
 * This applies in development too, deliberately. Shipping the raw file locally
 * and the compressed one in production would mean the decompression path was
 * never exercised until it was live.
 */
const MAX_ASSET_BYTES = 25 * 1024 * 1024;

for (const from of FILES) {
  const name = basename(from);
  const src = await stat(from);

  if (name.endsWith(".wasm")) {
    const to = join(dest, `${name}.gz`);
    // Skip if the compressed copy is already newer than the source.
    const existing = await stat(to).catch(() => null);
    if (existing && existing.mtimeMs >= src.mtimeMs) {
      console.log(`ffmpeg core: ${name}.gz up to date (${(existing.size / 1e6).toFixed(1)} MB)`);
      continue;
    }

    await pipeline(createReadStream(from), createGzip({ level: 9 }), createWriteStream(to));
    const out = await stat(to);
    if (out.size > MAX_ASSET_BYTES) {
      // Fail the build rather than fail the deploy. wrangler rejects the whole
      // upload, and finding out then means the reason is a line in a deploy log.
      throw new Error(
        `${name}.gz is ${(out.size / 1024 ** 2).toFixed(1)} MiB, over the 25 MiB ` +
          `Cloudflare Pages limit. It cannot be deployed.`,
      );
    }
    console.log(
      `ffmpeg core: gzipped ${name} → ${(src.size / 1e6).toFixed(1)} MB into ` +
        `${(out.size / 1e6).toFixed(1)} MB`,
    );
    continue;
  }

  const to = join(dest, name);
  const existing = await stat(to).catch(() => null);
  if (existing && existing.size === src.size) {
    console.log(`ffmpeg core: ${name} up to date (${(src.size / 1e6).toFixed(1)} MB)`);
    continue;
  }
  await copyFile(from, to);
  console.log(`ffmpeg core: copied ${name} (${(src.size / 1e6).toFixed(1)} MB)`);
}

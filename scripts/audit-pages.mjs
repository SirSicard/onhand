/**
 * Audit the BUILT pages: accessibility, and whether every asset they reference
 * actually exists.
 *
 * The existing axe test renders the Converter component in isolation, which is
 * the right place to catch a bad contrast token but never sees a real page.
 * Between them there are 158 documents from four templates, and a heading level
 * skipped in a layout or a landmark missing from an intent page is invisible to
 * a component test.
 *
 * The reference check is the more valuable half, and it exists because of a
 * specific failure mode: Cloudflare answers a request for a MISSING file with
 * the 404 page and HTTP 200. A <meta property="og:image"> pointing at a card
 * that was never generated therefore looks fine to every automated check that
 * asks for a status code, and renders as a broken image in every preview. Only
 * the top of the pair ranking gets a bespoke card, so this is a live risk every
 * time the ranking moves.
 *
 *     pnpm build && pnpm audit:pages
 *
 * Exits non-zero on any critical/serious a11y violation or any dangling
 * reference. Not part of `pnpm build` — it needs a browser, and Cloudflare's
 * build image has none.
 */

import { chromium } from "playwright";
import { readFile, readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const PORT = 4399;

/** Every built HTML document, as a site-relative URL. */
async function allPages(dir = dist, prefix = "/") {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith("_") || entry.name === "fixtures") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await allPages(full, `${prefix}${entry.name}/`)));
    else if (entry.name === "index.html") out.push(prefix);
    // 404.html is a page too, and it is the one nobody looks at. It is not an
    // index.html in a directory, so matching only those quietly skipped it —
    // the audit reported 158 of 159 built pages and read as complete.
    else if (entry.name === "404.html") out.push(`${prefix}404.html`);
  }
  return out.sort();
}

// ── 1. Every referenced local asset exists on disk ──────────────────────────
// Static analysis, no browser needed, and it covers all 158 pages rather than a
// sample — the whole point is catching the one page whose card went missing.

const pages = await allPages();
const dangling = [];

for (const path of pages) {
  // A path ending in .html IS the file; everything else is a directory whose
  // index.html is.
  const file = path.endsWith(".html")
    ? join(dist, path)
    : join(dist, path === "/" ? "" : path, "index.html");
  const html = await readFile(file, "utf8");

  const refs = [
    ...[...html.matchAll(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<link[^>]+rel="icon"[^>]+href="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<(?:script|img)[^>]+(?:src)="([^"]+)"/g)].map((m) => m[1]),
  ];

  for (const ref of refs) {
    // Absolute URLs are the site's own origin here; anything genuinely external
    // is a separate failure the build already blocks.
    const local = ref.replace(/^https?:\/\/[^/]+/, "");
    if (!local.startsWith("/")) continue;
    const target = join(dist, decodeURIComponent(local));
    const exists = await stat(target).then(
      () => true,
      () => false,
    );
    if (!exists) dangling.push(`${path} → ${local}`);
  }
}

if (dangling.length) {
  console.error(`\n${dangling.length} dangling reference(s):`);
  for (const d of dangling.slice(0, 20)) console.error(`  ${d}`);
  if (dangling.length > 20) console.error(`  … and ${dangling.length - 20} more`);
} else {
  console.log(`references: every asset referenced by ${pages.length} pages exists in dist/`);
}

// ── 2. Accessibility, on one page per template ──────────────────────────────
// One per template rather than all 158: the pair pages are the same document
// with different nouns, so checking 148 of them tests the same markup 148 times
// and turns a two-second audit into a five-minute one.

const SAMPLE = [
  { path: "/", why: "homepage" },
  { path: "/formats/", why: "the format matrix — a large table" },
  { path: "/why/", why: "the manifesto — long prose, a definition list" },
  { path: "/tools/", why: "the tool index" },
  { path: "/tools/remove-exif/", why: "an intent page" },
  { path: "/heic-to-jpg/", why: "a pair page" },
  { path: "/opus-to-ogg/", why: "a long-tail pair page, which uses the same template" },
  { path: "/404.html", why: "the not-found page, which Cloudflare serves for any bad URL" },
];

const server = spawn("node", [join(root, "scripts", "serve-dist.mjs"), String(PORT)], {
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 1200));

const axeSource = await readFile(join(root, "node_modules", "axe-core", "axe.min.js"), "utf8");
const browser = await chromium.launch();
const violations = [];

try {
  for (const { path, why } of SAMPLE) {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${PORT}${path}`, { waitUntil: "networkidle" });
    await page.addScriptTag({ content: axeSource });

    const result = await page.evaluate(async () => {
      // `incomplete` is treated as failure for colour contrast specifically.
      // axe reports "incomplete" when it cannot compute a background — which is
      // exactly what happens with a translucent token over a gradient, and is
      // how two real contrast failures shipped here before.
      const r = await window.axe.run(document, {
        resultTypes: ["violations", "incomplete"],
      });
      return {
        violations: r.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.length,
        })),
        incomplete: r.incomplete
          .filter((v) => v.id === "color-contrast")
          .map((v) => ({ id: v.id, impact: "serious", nodes: v.nodes.length })),
      };
    });

    const bad = [...result.violations, ...result.incomplete].filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    for (const v of bad) violations.push(`${path} (${why}): ${v.id} × ${v.nodes}`);
    console.log(`  ${bad.length === 0 ? "ok  " : "FAIL"} ${path.padEnd(22)} ${why}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}

if (violations.length) {
  console.error(`\n${violations.length} accessibility problem(s):`);
  for (const v of violations) console.error(`  ${v}`);
}

const failed = dangling.length + violations.length;
console.log(
  failed === 0
    ? `\naudit: ${pages.length} pages, ${SAMPLE.length} audited for a11y — clean`
    : `\naudit: ${failed} problem(s)`,
);
process.exit(failed === 0 ? 0 : 1);

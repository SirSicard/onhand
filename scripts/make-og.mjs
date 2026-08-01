/**
 * Render the social cards: one for the site, one per conversion pair.
 *
 * Deliberately NOT part of the build. It needs a browser to rasterise, and
 * Cloudflare's build image has no Playwright — wiring it into `pnpm build`
 * would work locally and fail on deploy, which is the failure mode this project
 * has already paid for twice. Run it by hand when the copy changes and commit
 * the result:
 *
 *     pnpm build && pnpm og && pnpm build
 *
 * Two builds, and the reason is worth stating: this script reads the BUILT
 * pages to learn what each card should say, then writes into `public/`, which
 * the next build copies into `dist/`. Reading the built HTML rather than
 * importing the pair table means the card can never disagree with the page —
 * the page is the source of truth for its own title.
 *
 * Backgrounds are flat on purpose. An earlier version had a radial gradient and
 * weighed 112 KB per image; flat is 31 KB, and 45 of those is the difference
 * between 1.4 MB and 5 MB of committed binaries for the same information.
 *
 * Serviceable rather than designed. When there is a real visual identity this
 * gets replaced wholesale.
 */

import { chromium } from "playwright";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const outDir = join(root, "public", "og");

// Same tokens as @theme in global.css. Duplicated because this runs outside the
// bundler; if the palette changes, it changes in both places or the cards drift.
const COPPER = "#c87d42";
const GLASS_950 = "#0e121a";
const GLASS_100 = "#eceef2";
const GLASS_400 = "#8e99ab";

const STYLE = `
  * { margin: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px;
    background: ${GLASS_950}; color: ${GLASS_100};
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    display: flex; flex-direction: column; justify-content: center;
    padding: 0 88px; position: relative;
  }
  .mark { position: absolute; top: 56px; left: 88px; font-size: 26px;
          color: ${GLASS_400}; letter-spacing: 2px; }
  h1 { font-size: 88px; font-weight: 600; letter-spacing: -2px; line-height: 1.05; }
  .arrow { color: ${COPPER}; }
  p { font-size: 34px; color: ${GLASS_400}; margin-top: 22px; line-height: 1.3; }
  em { color: ${GLASS_100}; font-style: normal; }
  /* The counter is the product's whole claim, so it belongs on every card. */
  .counter {
    margin-top: 44px; font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 26px; color: ${COPPER};
    border: 2px solid ${COPPER}55; border-radius: 999px;
    padding: 10px 24px; align-self: flex-start;
  }
`;

function card(headingHtml, subHtml) {
  return `<!doctype html><meta charset="utf-8"><style>${STYLE}</style><body>
    <div class="mark">ONHAND</div>
    <h1>${headingHtml}</h1>
    <p>${subHtml}</p>
    <div class="counter">↑ 0 bytes uploaded</div>
  </body>`;
}

/** Pull "HEIC" and "JPEG" out of a built pair page's own <h1>. */
async function pairsFromDist() {
  const entries = await readdir(dist, { withFileTypes: true }).catch(() => []);
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.includes("-to-")) continue;
    const html = await readFile(join(dist, entry.name, "index.html"), "utf8").catch(() => null);
    if (!html) continue;
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "";
    const text = h1
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const m = text.match(/^Convert (.+?) to (.+)$/);
    if (m) found.push({ slug: entry.name, from: m[1], to: m[2] });
  }
  return found.sort((a, b) => a.slug.localeCompare(b.slug));
}

const pairs = await pairsFromDist();
if (pairs.length === 0) {
  console.error("No pair pages found in dist/. Run `pnpm build` first.");
  process.exit(1);
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });

// The site-wide card.
await page.setContent(
  card(
    `Onhand`,
    `Every file converter on one page.<br>Nothing is uploaded — <em>including video</em>.`,
  ),
  { waitUntil: "load" },
);
await page.screenshot({ path: join(root, "public", "og.png") });

let total = 0;
for (const { slug, from, to } of pairs) {
  await page.setContent(
    card(
      `${from} <span class="arrow">→</span> ${to}`,
      `Converted in your browser.<br>Nothing is uploaded — <em>not even video</em>.`,
    ),
    { waitUntil: "load" },
  );
  const buffer = await page.screenshot();
  await writeFile(join(outDir, `${slug}.png`), buffer);
  total += buffer.byteLength;
}

await browser.close();
console.log(
  `og: 1 site card + ${pairs.length} pair cards ` +
    `(${(total / 1024 / 1024).toFixed(1)} MB, ${Math.round(total / pairs.length / 1024)} KB each)`,
);
console.log("run `pnpm build` again so public/og/ is copied into dist/");

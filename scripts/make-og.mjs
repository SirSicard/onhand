/**
 * Render public/og.png, the social card.
 *
 * Deliberately NOT part of the build. It needs a browser to rasterise, and
 * Cloudflare's build image has no Playwright — wiring it into `pnpm build`
 * would work locally and fail on deploy, which is the failure mode this project
 * has already paid for twice. Run it by hand when the card changes and commit
 * the result:
 *
 *     pnpm og
 *
 * Serviceable rather than designed. When there is a real visual identity this
 * gets replaced wholesale.
 */

import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// Same tokens as @theme in global.css. Duplicated because this runs outside the
// bundler; if the palette changes, it changes in both places or the card drifts.
const COPPER = "#c87d42";
const GLASS_950 = "#0e121a";
const GLASS_100 = "#eceef2";
const GLASS_400 = "#8e99ab";

const html = `<!doctype html>
<meta charset="utf-8">
<style>
  * { margin: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px;
    background: ${GLASS_950};
    color: ${GLASS_100};
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    display: flex; flex-direction: column; justify-content: center;
    padding: 0 88px;
    position: relative; overflow: hidden;
  }
  /* A single warm bloom, so the card is not a flat rectangle of text. */
  body::after {
    content: ""; position: absolute; right: -180px; top: -180px;
    width: 640px; height: 640px; border-radius: 50%;
    background: radial-gradient(circle, ${COPPER}33 0%, transparent 70%);
  }
  h1 { font-size: 104px; font-weight: 600; letter-spacing: -3px; }
  p  { font-size: 40px; color: ${GLASS_400}; margin-top: 20px; line-height: 1.3; }
  em { color: ${GLASS_100}; font-style: normal; }
  .counter {
    margin-top: 52px; font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 30px; color: ${COPPER};
    border: 2px solid ${COPPER}55; border-radius: 999px;
    padding: 12px 28px; align-self: flex-start;
  }
</style>
<body>
  <h1>Onhand</h1>
  <p>Every file converter on one page.<br>Nothing is ever uploaded — <em>including video</em>.</p>
  <!-- The counter is the product's whole claim, so it belongs on the card. -->
  <div class="counter">↑ 0 bytes uploaded</div>
</body>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: "load" });
await page.screenshot({ path: join(root, "public", "og.png") });
await browser.close();

console.log("wrote public/og.png (1200x630)");

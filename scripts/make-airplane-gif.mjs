/**
 * Record the airplane-mode demo: a real conversion with the network genuinely
 * dead.
 *
 * The claim this project makes is unusual enough that a screenshot proves
 * nothing — anyone can screenshot anything. So the recording does the one thing
 * a viewer can check: it kills the network first, visibly, and converts anyway.
 *
 * Not simulated. `context.setOffline(true)` puts Chromium's network stack
 * offline for real, and the page's own `navigator.onLine` reads false on
 * camera. If the codecs were not genuinely cached on disk, the conversion would
 * fail here rather than produce a file.
 *
 *     pnpm build && pnpm airplane
 *
 * Writes docs/media/airplane-mode.gif. Run it when the UI changes; it is not
 * part of the build and never should be.
 */

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "docs", "media");
const frameDir = join(root, ".airplane-frames");
const PORT = 4488;

/** A real HEIC off an iPhone — the format the product exists for. */
const heic = await readFile(join(root, "fixtures", "photo.heic"));

await mkdir(outDir, { recursive: true });
await rm(frameDir, { recursive: true, force: true });
await mkdir(frameDir, { recursive: true });

// Serve the built site with the production headers.
const server = spawn("node", [join(root, "scripts", "serve-dist.mjs"), String(PORT)], {
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 1500));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 780 } });
const page = await context.newPage();

let frame = 0;
const shoot = async (n = 1) => {
  for (let i = 0; i < n; i++) {
    await page.screenshot({ path: join(frameDir, `f${String(frame++).padStart(4, "0")}.png`) });
  }
};

/** A caption bar drawn into the page, so the recording explains itself. */
async function caption(text, tone = "normal") {
  await page.evaluate(
    ([t, kind]) => {
      let el = document.getElementById("__cap");
      if (!el) {
        el = document.createElement("div");
        el.id = "__cap";
        Object.assign(el.style, {
          position: "fixed",
          left: "0",
          right: "0",
          top: "0",
          padding: "14px 20px",
          font: "600 17px ui-sans-serif, system-ui, sans-serif",
          textAlign: "center",
          zIndex: "9999",
        });
        document.body.appendChild(el);
      }
      el.textContent = t;
      el.style.background = kind === "offline" ? "#7f1d1d" : "#96562c";
      el.style.color = "#ffffff";
    },
    [text, tone],
  );
}

try {
  // ── 1. Normal visit, so the codecs land in the cache ──────────────────────
  await page.goto(`http://127.0.0.1:${PORT}/heic-to-jpg/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 20_000 });
  // The very first navigation happens before the worker takes control, so it is
  // never cached. One reload while still online is what puts this page in the
  // cache — otherwise going offline would fall back to the homepage, which is
  // correct behaviour but not what this demo is about.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 20_000 });

  await caption("Online. Converting a HEIC — this caches the codecs.");
  await shoot(8);

  const drop = async () => {
    await page.evaluate((bytes) => {
      const input = document.querySelector("input[type=file]");
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], "photo.heic", { type: "image/heic" }));
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, Array.from(heic));
    await page.waitForTimeout(400);
    await shoot(4);
    await page.getByRole("button", { name: /^Convert/ }).click();
    await page.waitForFunction(() => /→/.test(document.querySelector("li")?.textContent ?? ""), {
      timeout: 60_000,
    });
    // Bring the finished row into view — the size delta is the payoff shot.
    await page.evaluate(() => document.querySelector("li")?.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(200);
    await shoot(12);
  };

  await drop();

  // ── 2. Kill the network, for real ─────────────────────────────────────────
  await context.setOffline(true);
  await caption("Network OFF. Not simulated — Chromium is offline.", "offline");
  await shoot(10);

  // Prove it from inside the page: navigator.onLine, and a fetch that fails.
  await page.evaluate(async () => {
    const el = document.getElementById("__cap");
    let reachable = true;
    try {
      await fetch("/robots.txt?cb=" + Math.random(), { cache: "no-store" });
    } catch {
      reachable = false;
    }
    el.textContent = `navigator.onLine = ${navigator.onLine} · network reachable = ${reachable}`;
  });
  await shoot(12);

  // ── 3. Reload with no network, then convert again ─────────────────────────
  await page.reload({ waitUntil: "domcontentloaded" });
  await caption("Reloaded with no network. Served from cache.", "offline");
  await shoot(10);

  await caption("Converting again — offline.", "offline");
  await shoot(4);
  await drop();

  await caption("Done. Offline the whole time, nothing uploaded.", "offline");
  await shoot(16);
} finally {
  await browser.close();
  server.kill();
}

// ── Frames → GIF ────────────────────────────────────────────────────────────
const frames = (await readdir(frameDir)).filter((f) => f.endsWith(".png")).length;
const gif = join(outDir, "airplane-mode.gif");

await new Promise((resolve, reject) => {
  // palettegen/paletteuse rather than the default 216-colour palette: without
  // it, the copper accent and the dark background both band badly.
  const ff = spawn(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-framerate",
      "6",
      "-i",
      join(frameDir, "f%04d.png"),
      "-filter_complex",
      "[0:v] fps=6,scale=900:-1:flags=lanczos,split [a][b];[a] palettegen=max_colors=128 [p];[b][p] paletteuse=dither=bayer:bayer_scale=3",
      gif,
    ],
    { stdio: "inherit" },
  );
  ff.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  ff.on("error", reject);
});

await rm(frameDir, { recursive: true, force: true });

const { size } = await import("node:fs/promises").then((m) => m.stat(gif));
console.log(`airplane-mode.gif — ${frames} frames, ${(size / 1024 / 1024).toFixed(1)} MB`);
if (size > 6 * 1024 * 1024) {
  console.warn("over 6 MB; GitHub will render it but it will be slow to load.");
}

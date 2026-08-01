/**
 * Check that what is live is actually the thing that was built.
 *
 * Exists because production lied twice in ways that looked like real bugs:
 *
 *   1. Cloudflare's alias lags a deployment by a minute or two, so a fresh
 *      deploy 404s or serves the previous build. Checking immediately after a
 *      push reports a broken site that is fine ninety seconds later. Both times
 *      that cost real debugging effort.
 *   2. Cloudflare answers a request for a MISSING asset with the 404 page and
 *      HTTP 200. A missing file is therefore indistinguishable from a present
 *      one unless you look at the content type — which is how a completely
 *      empty deployment once looked healthy.
 *
 * So this polls rather than sampling once, and asserts content types rather
 * than status codes.
 *
 *     pnpm verify:live [url]
 */

const origin = process.argv[2] ?? "https://onhand.pages.dev";
const ATTEMPTS = 10;
const GAP_MS = 20_000;

/** Each asset and the content type that proves it is really there. */
const CHECKS = [
  { path: "/", type: /text\/html/, why: "the page itself" },
  { path: "/sw.js", type: /javascript/, why: "service worker — postbuild ran" },
  {
    path: "/ffmpeg/ffmpeg-core.wasm.gz",
    type: /application\/gzip/,
    why: "ffmpeg core — prebuild ran",
  },
  { path: "/og.png", type: /image\/png/, why: "social card" },
  { path: "/og/heic-to-jpg.png", type: /image\/png/, why: "per-pair social card" },
  { path: "/sitemap.xml", type: /xml/, why: "sitemap" },
  { path: "/robots.txt", type: /text\/plain/, why: "robots" },
  { path: "/heic-to-jpg/", type: /text\/html/, why: "a pair page" },
  { path: "/formats/", type: /text\/html/, why: "formats matrix" },
  { path: "/why/", type: /text\/html/, why: "manifesto" },
  { path: "/tools/", type: /text\/html/, why: "tool index" },
  { path: "/tools/remove-exif/", type: /text\/html/, why: "an intent page" },
  // A long-tail pair page. The head of the ranking was always going to be
  // fine; the risk introduced by growing to 148 pages is that the tail silently
  // does not deploy, and nothing else would notice.
  { path: "/opus-to-ogg/", type: /text\/html/, why: "a long-tail pair page" },
  { path: "/mp4-to-gif/", type: /text\/html/, why: "video to animated GIF" },
];

async function check(path) {
  try {
    const res = await fetch(origin + path, { redirect: "manual" });
    return { status: res.status, type: res.headers.get("content-type") ?? "" };
  } catch (err) {
    return { status: 0, type: `unreachable (${err.message})` };
  }
}

for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  const results = await Promise.all(CHECKS.map(async (c) => ({ ...c, ...(await check(c.path)) })));
  const wrong = results.filter((r, i) => !CHECKS[i].type.test(r.type));

  if (wrong.length === 0) {
    console.log(`live at ${origin} — all ${CHECKS.length} checks pass`);
    for (const r of results) console.log(`  ${r.status} ${r.type.padEnd(28)} ${r.path}`);
    process.exit(0);
  }

  console.log(`attempt ${attempt}/${ATTEMPTS}: ${wrong.length} not ready yet`);
  for (const r of wrong) {
    console.log(`  ${r.status} ${(r.type || "no type").padEnd(28)} ${r.path}  (${r.why})`);
  }
  if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, GAP_MS));
}

console.error(
  `\n${origin} did not settle after ${(ATTEMPTS * GAP_MS) / 1000}s. ` +
    `An HTML content type where a binary is expected means the asset is MISSING — ` +
    `Cloudflare serves its 404 page with status 200.`,
);
process.exit(1);

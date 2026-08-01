# ONHAND — battle plan for Opus

**You are building a client-side file converter.** Read `RESEARCH.md` (market + tech facts)
and `SPEC.md` (product) first — this file is the execution order. All three are canon; when
reality contradicts them, fix reality's paperwork: append a dated erratum to §9 here rather
than silently diverging (same protocol as the showcase CANON — it worked).

**Prime directives**
1. File bytes NEVER leave the device. No exceptions, no "just for this format", no analytics.
2. Main thread never blocks. Every codec call lives in a worker.
3. Silent fallback: users pick a target format, never an "engine".
4. When a format can't be done locally, say so plainly — never proxy through a server.
5. MIT. Do not read or copy VERT (AGPL) source. Clean-room from specs and upstream docs.

---

## P0 — Rails (½ day)

- [ ] Repo `onhand` under SirSicard, MIT LICENSE, README stub with the one-liner
- [ ] Astro (static output) + React 19 islands + TS strict + Tailwind v4 (CSS-first — **no
      tailwind.config**, same as the showcase; @theme in CSS)
- [ ] pnpm; Node 22; `.nvmrc`
- [ ] Cloudflare Pages project wired to the repo (Direct Upload via wrangler is fine too;
      CF Pages does preview deploys per PR natively). **NOT Vercel** — bandwidth math and
      the Hobby commit-author trap both say CF (see RESEARCH §2)
- [ ] `public/_headers` exactly as SPEC §2 (COOP/COEP + immutable assets)
- [ ] CI: GitHub Actions — typecheck, vitest, build. Keep < 3 min

**AC-P0:** deployed hello page; DevTools console shows `crossOriginIsolated === true`;
Lighthouse ≥ 95 on the empty shell.

## P1 — Engine substrate + images (2–3 days)

- [ ] `packages/engine` (or `src/engine`): types first —
      `Job {id, file, sourceFmt, targetFmt, options, status, progress, output?}`;
      `Engine {id, canHandle(pair, caps), estimate(job), run(job): AsyncIterable<Progress>}`
- [ ] Capability probe (module, cached): WebCodecs `isConfigSupported` for h264/vp9/av1/aac/opus,
      SAB/crossOriginIsolated, `navigator.deviceMemory`, FS Access API
- [ ] Worker pool + Comlink; broker picks cheapest capable engine, falls through on error
- [ ] **images.worker**: jSquash (mozjpeg, oxipng, webp, avif, resize) + libheif-js (HEIC
      decode) + resvg-wasm (svg→png). Lazy-import per codec; each wasm cached via CacheStorage
- [ ] pdf-lib (images→PDF, one image per page) + pdf.js (PDF→pngs, per-page)
- [ ] **Fixtures corpus** in `fixtures/`: one tiny real file per format (a 4-photo HEIC from
      an actual iPhone, 1 s mp4/mov/webm/mkv, 2 s mp3/wav/flac, multi-page PDF…). Committed,
      < 5 MB total. Every engine test runs against real fixtures, not mocks
- [ ] Vitest (happy-dom won't run wasm codecs — use `@vitest/browser` w/ playwright provider
      for engine tests; pure-logic tests stay in node)

**AC-P1:** heic→jpg, png→webp, jpg→avif, svg→png, pdf↔png all pass in chromium + firefox +
webkit browser-mode tests; quality slider changes output size monotonically; a 50-file batch
doesn't jank the UI (main-thread long-task budget < 200 ms).

## P2 — Audio + video (3–4 days, the hard phase)

- [ ] **ffmpeg.worker**: @ffmpeg/ffmpeg single-thread core, lazy-loaded on first audio/exotic
      job, cached in CacheStorage (~31 MB — show a one-time "loading engine (31 MB, once)"
      progress). Audio pairs first: mp3/wav/m4a/ogg/opus/flac + bitrate presets
- [ ] Wire ffmpeg `progress` events → job progress (they're log-parsed and flaky for some
      containers — floor at indeterminate spinner when ratio is NaN, never fake numbers)
- [ ] **webcodecs.worker**: web-demuxer (mp4/webm/mkv demux) → decode → encode → mp4-muxer /
      webm-muxer with StreamTarget. Pairs: mov→mp4, webm→mp4, mkv→mp4, mp4→webm
- [ ] AAC-encode gap (Firefox, Linux — RESEARCH §2): if `AudioEncoder` unsupported for AAC →
      route the whole job to ffmpeg (simplest correct thing); revisit hybrid muxing in v1.1
- [ ] Video→audio extract (mp3/m4a/wav) via ffmpeg (fast, small); mp4↔gif via ffmpeg
      (palettegen/paletteuse for quality)
- [ ] mt ffmpeg core: load ONLY if `crossOriginIsolated && deviceMemory >= 8`; feature-flag
      it off by default until E2E proves it stable — single-thread is the documented-stable path
- [ ] Pre-flight guardrail: estimate peak memory (input size × format multiplier table);
      warn at 1.2 GB, hard-stop at 1.8 GB on ffmpeg path with an honest explainer
- [ ] Worker-crash recovery: OOM kills the worker, not the app — respawn, mark job failed
      with "this file is too large for in-browser conversion (~2 GB engine limit)"

**AC-P2:** mov→mp4 uses WebCodecs in Chrome/Safari (assert via engine telemetry in test
hooks) and completes a 100 MB 1080p fixture ≈ realtime on dev machine; same pair falls back
to ffmpeg in Firefox when needed and still passes; mkv→mp4 300 MB fixture passes all three
browsers; video→mp3 passes; UI stays interactive throughout (long-task budget).

## P3 — Queue UX + trust surface (2 days)

- [ ] Queue table per SPEC §3: smart target defaults, per-source-type memory, presets
      (Smallest/Balanced/Best/Lossless) with Advanced behind a disclosure
- [ ] `Convert all to ▾`, Start, per-file + overall progress, tab-title %, Download all as
      zip (fflate streaming — do NOT buffer the whole archive)
- [ ] FS Access API streaming writes when available; blob URL fallback (revoke after click)
- [ ] Size-delta readout on done rows
- [ ] **"↑ 0 bytes uploaded" live counter** (PerformanceObserver resource entries; unit test
      that it trips if anything POSTs)
- [ ] Drag/drop + paste + browse + folder; duplicate-name disambiguation `(2)`
- [ ] Error states: unsupported pair (say why + nearest supported), corrupt file, OOM

**AC-P3:** keyboard-only run-through converts a mixed 10-file batch; axe-core zero critical;
zip of 20 outputs streams without memory spike; counter reads 0 after a full session.

## P4 — PWA + polish (1–2 days)

- [ ] Service worker: precache app shell; runtime-cache codec wasm on first use; offline page
- [ ] Offline badge lights when the current pair's engine is cached; README airplane-mode GIF
- [ ] Dark/light, reduced-motion, focus rings, empty-state illustration, favicon/OG
- [ ] Perf pass: landing JS < 250 KB pre-codec; `<link rel=preload>` the pair page's likely codec

**AC-P4:** airplane-mode heic→jpg works after one prior visit; Lighthouse PWA + perf + a11y
≥ 95; no console errors across the browser matrix.

## P5 — Pages, SEO, launch (2 days)

- [ ] Pair-page generator: `pairs.ts` (curated ~200, ranked by search volume — start from the
      incumbent sitemaps' obvious heads: heic-jpg, mov-mp4, mp4-mp3, webp-jpg, png-pdf…);
      Astro `getStaticPaths`; unique H1/how-to/FAQ per page, FAQPage schema, canonical
- [ ] `/tools/*` intent pages; `/formats` matrix (generated from engine capability table so it
      never lies); `/why` manifesto (name the dark patterns, link VERT as the OSS alternative)
- [ ] sitemap.xml, robots, per-pair OG images (satori at build)
- [ ] README, Inkwell-style: measured numbers from AC runs, honest limits section (2 GB, docs
      formats absent, Firefox AAC), licence notices (THIRD_PARTY.md incl. ffmpeg core mix)
- [ ] Launch: Show HN ("client-side converter — video included, nothing uploaded"), r/privacy,
      r/degoogle, Product Hunt later. Lead with the airplane-mode GIF and the 0-bytes counter

**AC-P5:** 200 pages build < 60 s; all indexed-page CWV green in CrUX-lab; `pnpm build` +
deploy is one command; README numbers are real measurements, not claims.

---

## 6. Risk register (pre-loaded answers)

| Risk | Answer |
|---|---|
| Safari WebCodecs quirks below 26 | Probe per-config at runtime, never per-UA; ffmpeg fallback is always present |
| SAB/mt instability | mt is OFF by default; single-thread everywhere is the shipping config |
| 2 GB wasm ceiling | Pre-flight estimator + honest hard-stop copy; never crash mid-way |
| COEP breaks a future embed | We embed nothing; keep it that way (fonts local, no CDNs, no analytics) |
| ffmpeg core licence (x264 = GPL) | THIRD_PARTY notice now; custom LGPL-only core is v1.1; H.264 encode rides WebCodecs anyway |
| VERT ships local video first | Their architecture routes video out by design (daemon); still — ship P2 before polishing P5 |
| iOS memory limits | Cap concurrent jobs at 1 on iOS; document honestly |
| Someone asks for YouTube download | /why explains the refusal once, link it forever |

## 7. Sequencing note for Opus

P1 images alone (HEIC→JPG + WebP/AVIF) is already a shippable, useful site behind a feature
flag — deploy it to production the day P1 passes and let it start earning index age while
P2 is built. Do not wait for video to ship pixels.

## 8. Explicit non-goals (do not drift)

No accounts, no server conversion path, no telemetry, no "pro tier", no office docs in v1,
no URL fetching, no AI features. The product is boring on purpose; the moat is that it costs
us nothing and lies to no one.

## 9. Errata

*(append as `- YYYY-MM-DD: finding → ruling`)*
- 2026-08-01: Node 26 is what's installed locally; `.nvmrc` pins 26 rather than the
  plan's 22 so CI matches the dev machine. `engines.node` stays `>=22`.
- 2026-08-01: pnpm 11 gates postinstall scripts via `allowBuilds` in
  `pnpm-workspace.yaml` (booleans), NOT `onlyBuiltDependencies` in package.json —
  the latter is silently ignored and the install exits 1, which fails `astro build`
  through its dep-check. esbuild + sharp allowed deliberately.
- 2026-08-01: **WebCodecs support is per-PROFILE, not per-codec.** Measured in
  Chromium: H.264 encode is UNSUPPORTED for Baseline (avc1.42E01E) and Main
  (avc1.4D401E) but SUPPORTED for High (avc1.640028). Probing a single "safe"
  profile produced a false negative that would have demoted every mp4 job to
  ffmpeg.wasm on hardware that could encode natively. `capabilities.ts` now walks
  a ladder per codec and returns the exact working codec string; the encoder must
  be configured with that string, never a reconstructed guess. Locked by test.
- 2026-08-01: Renamed **Alembic → Onhand**. Alembic is an existing CG interchange
  file format (.abc) and the SQLAlchemy migration tool; naming a converter after a
  format it doesn't convert is unwinnable in search. Alchemy register is mined out
  (Athanor, Crucible, Retort, Kiln all taken).
- 2026-08-01: `pnpm/action-setup@v4` refuses to run without a pinned version and
  reads `packageManager` from package.json. Added `pnpm@11.9.0` there — it also
  stops CI and the dev machine drifting apart.
- 2026-08-01: P0 SHIPPED. https://onhand.pages.dev — production verified
  `crossOriginIsolated: true`, SharedArrayBuffer available, **zero external
  requests**, `_headers` applied by CF Pages, `_astro/*` immutable-cached. CI green
  in 48s. GitHub repo is PRIVATE for now; flip to public when P1 renders something.

### P1 errata
- 2026-08-01: Vite dep pre-bundling rewrites `import.meta.url` inside codec packages,
  breaking their relative `.wasm` paths so the request 404s and the dev server
  returns index.html. Surfaces as `WebAssembly.instantiate(): expected magic word
  00 61 73 6d, found 3c 21 64 6f` ("<!do"). ALL wasm codec packages must go in
  `optimizeDeps.exclude`.
- 2026-08-01: `@jsquash/avif` v2 takes plain 0-100 `quality`. Older wrappers used an
  inverted 0-63 `cqLevel`; passing that is silently ignored and every AVIF lands at
  default quality regardless of preset. Verified monotonic q55<q80<q95 in-browser.
- 2026-08-01: jSquash decoders return `ImageData | null`. Null = codec ran, produced
  nothing (truncated/malformed input) and must be raised, not passed downstream.
- 2026-08-01: **`createImageBitmap` does not accept SVG blobs in Chromium** (Firefox
  only). Browser-native SVG rasterisation is not viable — use @resvg/resvg-wasm,
  which also works in a worker.
- 2026-08-01: **Upload counter was measuring the wrong direction.** First version
  summed `PerformanceResourceTiming.transferSize`, which is bytes RECEIVED — merely
  loading a sample image made it read "600 B uploaded", disproving the one claim the
  product makes. `PerformanceResourceTiming` exposes no request-body size, so
  `uploadMonitor.ts` wraps fetch/XHR/sendBeacon and measures request bodies. Locked
  by 6 tests incl. "does not count downloads".
- 2026-08-01: **HEIC needed the .mjs build.** `libheif-js` root and `wasm-bundle`
  entries are CommonJS/UMD → `ReferenceError: module is not defined` in an ES-module
  worker. Use `libheif-js/libheif-wasm/libheif-bundle.mjs`, which default-exports an
  async factory and embeds its own wasm. Verified against a real Apple-encoded HEIC.
- 2026-08-01: TIFF now decodes via `utif` (pure JS, ~30 KB). NOTE: utif must NOT go in
  `optimizeDeps.exclude` — it has no wasm, and excluding it skips Vite's CommonJS
  interop so `UTIF.default` is undefined. Only wasm packages belong in that list.
- 2026-08-01: Test corpus built (`fixtures/generate.py`, 18 files, 2.2 MB) from Apple's
  `sips` + PIL. Real encoders, no downloads, MIT-clean, reproducible. Full matrix
  **64/64** (16 sources × 4 targets) with dimensions asserted. Only 3 small samples
  (64 KB) ship to production; the corpus stays in fixtures/.
- 2026-08-01: EXIF orientation is honoured — `rotated-exif.jpg` (orientation 6, 640x480)
  correctly outputs 480x640. createImageBitmap applies it; do not "fix" this.

### P1 close-out
- 2026-08-01: PDF both directions. pdf.js v6 REQUIRES `GlobalWorkerOptions.workerSrc`
  — setting it to "" throws rather than running inline; point it at the bundled
  worker via `?url`. PDFs render onto transparent canvas (comes out black) so fill
  white first; render at scale 2.0 or text is mush. Multi-page → zip, and engines can
  now override the output filename because naming a zip ".png" misleads the OS.
- 2026-08-01: Dev-only `/fixtures/*` route added (astro.config + vitest.browser.config).
  Fixtures live outside public/, so fetching one returned index.html and a "JPEG" that
  is 4,311 bytes of HTML fails exactly like a broken codec. Cost ~40 min across two
  incidents. The route 404s loudly in plain text instead. Test helpers check for
  `<!doctype html`, NOT for a leading `<` — SVG legitimately starts with `<`.
- 2026-08-01: **Shared-worker hazard, found by the batch test.** Both engines called
  `resetWorker()` in their catch block. The worker is shared across concurrent jobs,
  so one corrupt file terminated it and every in-flight conversion never settled — a
  5-file batch with 2 bad files HUNG for 60s instead of finishing in <1s with 3
  successes. Codec errors are normal and leave the worker healthy; only a
  worker-level `error` event justifies discarding the instance. Fixed in both engines.
- 2026-08-01: Browser-mode suite added. **264 tests green across Chromium, Firefox and
  WebKit** — full matrix, quality monotonicity, PDF both ways, 50-file batch (worst
  main-thread block < 400ms), and batch resilience. Wired into CI.

## P2 — Audio + video — DONE 2026-08-01

**Deviation from plan, and why.** The plan specified web-demuxer + mp4-muxer +
webm-muxer + a hand-written WebCodecs pipeline. Shipped **mediabunny** instead:
one pure-TypeScript library, zero runtime dependencies, no extra wasm, and it
covers demux, decode, encode and mux for every container we care about. It also
exposes `canEncodeVideo`/`canEncodeAudio`, which is what makes the routing
honest — see below. Four packages and a pipeline became one dependency.

**Two engines, and the user never sees either.**
- `webcodecs` (cost 2) — mediabunny over the browser's own codecs. Fast, no
  download, real progress.
- `ffmpeg` (cost 10) — ffmpeg.wasm. Correct for everything, first choice for
  nothing.

Routing is **declared, not tabulated**: the WebCodecs engine names the codec it
wants for a container and asks the browser at runtime whether it can encode it.
If not, it throws a `NotMyJobError` the broker treats as a fall-through and
ffmpeg picks it up. No hardcoded browser table to go stale — measured
`mov -> mp4`: **Chromium 106ms and WebKit 157ms via WebCodecs, Firefox 3708ms
via ffmpeg** (no AAC encoder), all three producing correct output.

### What went wrong, in order

- **`ff.load()` hangs forever rather than rejecting.** Vite's dep optimizer
  rewrote @ffmpeg/ffmpeg's internal worker URL to a file it never emitted, so
  load() sat waiting for a ready message from a worker that was never
  constructed. No error, no console output, nothing — 10 minutes of a test run
  producing zero bytes of output. Fixed by excluding the package, and
  independently by giving `load()` a 120s deadline, because a dependency that
  can hang forever will eventually hang in production too.
- **The UMD core was the wrong build.** @ffmpeg/ffmpeg always constructs its
  worker with `type: "module"`, in both code branches — there is no classic
  path. `importScripts` doesn't exist there, so it always falls back to
  `await import(coreURL)`, which needs ESM. The UMD build fails with "Failed to
  fetch dynamically imported module", which reads like a missing file.
- **Then the ESM core failed too**, because a dev server treats a real path as
  a module to transform: Vite appended `?import` and choked on 111 KB of
  emscripten output. Fixed with `toBlobURL` — a `blob:` URL is opaque to the
  bundler, so dev and production run the same path.
- **The core is served from our own origin, never a CDN.** COEP would block it,
  and a CDN fetch leaks the user's IP and a referrer naming the tool. 32 MB is
  copied to `public/ffmpeg/` on prebuild by `scripts/sync-ffmpeg-core.mjs`.
- **The rotation fixture tested nothing.** `-metadata:s:v:0 rotate=90` is
  deprecated and modern ffmpeg ignores it silently — exit 0, file written, no
  display matrix. The test failed and the *engine was innocent*; mediabunny had
  been handling rotation correctly all along. Fixed with `-display_rotation` on
  the input, and the generator now verifies with ffprobe rather than trusting
  an exit code.
- **ffmpeg exits 0 having written a 0-byte file.** The native Vorbis encoder is
  stereo-only and fails *after* creating the output. A 0-byte fixture passes a
  presence check, so the generator now checks size and deletes empties.
- **Two servers on one port.** A stale `astro dev` was bound to [::1]:4322 and
  won `localhost` resolution, so the first round of "production verification"
  was reading a dev server serving the repo root. Verified on a clean port
  afterwards; `scripts/serve-dist.mjs` now serves `dist/` with the real
  COOP/COEP headers, which `astro preview` does not do.

### Found by driving the built UI, not by reading code
- The target dropdown offered **JPEG, PNG and PDF for an audio file**. Now
  `targetsFor(source)` — an option that cannot work is not shown.
- **Smallest/Balanced/Best did nothing on audio or video.** The presets only
  carried image quality; they now carry an audio bitrate too.
- Footer still claimed "Images now. Audio and video next."

**AC-P2 status:** mov→mp4 uses WebCodecs in Chromium/WebKit and falls back
cleanly in Firefox, asserted by engine telemetry. mkv→mp4, avi→mp4, video→mp3
and the full audio matrix pass in all three browsers. Memory guardrail refuses
oversized input in under 500ms rather than crashing the tab mid-encode.

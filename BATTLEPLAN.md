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

| Risk                              | Answer                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| Safari WebCodecs quirks below 26  | Probe per-config at runtime, never per-UA; ffmpeg fallback is always present                |
| SAB/mt instability                | mt is OFF by default; single-thread everywhere is the shipping config                       |
| 2 GB wasm ceiling                 | Pre-flight estimator + honest hard-stop copy; never crash mid-way                           |
| COEP breaks a future embed        | We embed nothing; keep it that way (fonts local, no CDNs, no analytics)                     |
| ffmpeg core licence (x264 = GPL)  | THIRD_PARTY notice now; custom LGPL-only core is v1.1; H.264 encode rides WebCodecs anyway  |
| VERT ships local video first      | Their architecture routes video out by design (daemon); still — ship P2 before polishing P5 |
| iOS memory limits                 | Cap concurrent jobs at 1 on iOS; document honestly                                          |
| Someone asks for YouTube download | /why explains the refusal once, link it forever                                             |

## 7. Sequencing note for Opus

P1 images alone (HEIC→JPG + WebP/AVIF) is already a shippable, useful site behind a feature
flag — deploy it to production the day P1 passes and let it start earning index age while
P2 is built. Do not wait for video to ship pixels.

## 8. Explicit non-goals (do not drift)

No accounts, no server conversion path, no telemetry, no "pro tier", no office docs in v1,
no URL fetching, no AI features. The product is boring on purpose; the moat is that it costs
us nothing and lies to no one.

## 9. Errata

_(append as `- YYYY-MM-DD: finding → ruling`)_

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
  display matrix. The test failed and the _engine was innocent_; mediabunny had
  been handling rotation correctly all along. Fixed with `-display_rotation` on
  the input, and the generator now verifies with ffprobe rather than trusting
  an exit code.
- **ffmpeg exits 0 having written a 0-byte file.** The native Vorbis encoder is
  stereo-only and fails _after_ creating the output. A 0-byte fixture passes a
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

### P2 errata — the deploy, which was the real test

Everything above was verified locally and in a local production build. Actually
deploying found three more things, each of which would have shipped broken.

- **Cloudflare Pages refuses any file over 25 MiB.** The ffmpeg core wasm is
  30.7 MiB, so it could not be deployed at all — `wrangler` rejects the entire
  upload, not just that file. It is now stored gzipped (9.7 MiB) and
  decompressed in the browser with `DecompressionStream`, in development too, so
  the decompression path is exercised on every run rather than first in
  production. The build now fails if any file exceeds the limit.
- **Cloudflare answers a missing asset with the 404 page and HTTP 200.**
  Measured: `/ffmpeg/ffmpeg-core.wasm` returned `200 text/html`, 7,305 bytes of
  markup. A missing file is indistinguishable from a present one at the HTTP
  level, and wrapping that markup in a blob labelled `application/wasm` makes
  ffmpeg fail deep inside instantiation with a magic-bytes error that reads like
  a corrupt build. Both assets are now sniffed before use.
- **The Pages project is Direct Upload — `Git Provider: No`.** Pushing to GitHub
  deployed nothing, and nothing said so: the site stayed up serving an old
  build, CI went green, and it sat three commits behind. Added
  `.github/workflows/deploy.yml`, which also verifies the live URL afterwards
  rather than trusting wrangler's exit code. **It needs `CLOUDFLARE_API_TOKEN`
  and `CLOUDFLARE_ACCOUNT_ID` as repository secrets before it can run.**

Also replaced `@ffmpeg/util`'s `downloadWithProgress`. It breaks on exactly the
response we serve: with `Content-Encoding: gzip` the `Content-Length` is the
wire size while the stream yields the larger decompressed body, its progress
loop throws on the mismatch, and its fallback then calls `arrayBuffer()` on a
body its own reader already consumed — surfacing as "body stream already read",
which points nowhere near the cause.

CI now runs Chromium on every push and the full three-browser matrix nightly
(`cross-browser.yml`). All three on every push took ten minutes on a 2-core
runner, and CI that slow stops being read.

**Verified live at https://onhand.pages.dev:** `crossOriginIsolated: true`,
WAV→MP3 86.2 KB → 25.1 KB through ffmpeg.wasm, `0 bytes uploaded`.

## P3 — Queue UX + trust surface — DONE 2026-08-01

Queue mechanics (`src/engine/queue.ts`), getting files out (`src/engine/download.ts`),
and a rewritten `Converter.tsx`. All of it driven in a real browser rather than
jsdom, because focus order, layout and axe's contrast checks are meaningless
without real rendering.

### What shipped

- **Per-source target memory.** A folder of HEICs needs telling once that it
  should become PNG, not thirty times. Scoped by source format, validated on
  read — a remembered target that is no longer reachable would render a select
  whose value is not among its options, and browsers resolve that by silently
  showing the first option instead.
- **Folder drop.** `DataTransfer.files` is flat and omits folder contents
  entirely, so dropping a folder appeared to do nothing. The entries API needs
  reading synchronously during the event, and `readEntries` returns at most 100
  at a time — reading it once silently truncates a large folder.
- **Duplicate-name disambiguation.** `photo.png` and `photo.jpg` both become
  `photo.webp`; downloading them in turn left one file and no sign the other was
  overwritten. Numbered before the extension, not after.
- **Download all as a streamed zip.** Entries are STORED, not deflated —
  everything here is already compressed, so deflating burns CPU proportional to
  batch size for nothing. Streams to disk via File System Access where
  available; otherwise built from chunks so the browser can spill to disk rather
  than holding one contiguous buffer.
- **Lossless preset**, and the row says "(lossy format)" when the chosen target
  cannot honour it, rather than producing a big file and letting the label imply
  otherwise.
- **Advanced disclosure** (longest edge, strip metadata), cancel a running job,
  remove a row, overall progress mirrored into the tab title.

### Fixed on the way

- **A blob URL was created on every render and never revoked**, pinning every
  output in memory for the life of the tab. On a 50-file video batch that is the
  difference between working and not.
- **The drop zone was a `role="button"` containing a file input.** axe flags it
  as `nested-interactive` and screen readers genuinely disagree about what such
  a control is; the input also had no label. Now a real `<button>` with the
  input beside it, labelled, out of tab order.
- **`utif`, `pdfjs-dist`, `pdf-lib` are reachable only through workers**, which
  Vite's dependency scan does not walk. It discovered them mid-run,
  re-optimised, and invalidated a URL a worker was already holding — "Failed to
  fetch dynamically imported module: .../deps/utif.js?v=<hash>", which reads
  like a missing package and is a race. **It only appears on a cold cache, so it
  passed locally and failed in CI twice.** Now listed exhaustively in
  `optimizeDeps.include`, enumerated from the workers' imports rather than one
  package per red CI run.

**AC-P3:** ten mixed files converted **keyboard-only in 801ms**, zero axe
critical or serious violations in both the empty and populated states, a 20-file
/ 20 MB zip verified readable entry-by-entry, and the counter reads
`↑ 0 bytes uploaded` after a full session.

## P4 — PWA + polish — DONE 2026-08-01

Offline-capable, not installable — a tool people use twice a year does not need
an install prompt. Service worker is hand-rolled (`scripts/build-sw.mjs`) rather
than Workbox: the caching rules are unusual enough that a generic tool would
need as much configuration as this has code.

**Two cache tiers, and the split is the design.** The shell (253 KB — HTML,
CSS, React, the Converter and its static import graph) is precached on install.
The codecs are not: caching 9.7 MB on someone who came to convert a PNG defeats
the point. They land in the cache the first time a conversion pulls one.

**The offline badge is honest per pair.** "A service worker exists therefore
offline works" is false for any pair whose codec has never been downloaded. The
page asks the worker what it actually holds and answers for the queued pairs
specifically — and correctly reports that most audio and video work offline
immediately, because WebCodecs uses codecs already in the browser.

### Found by building it

- **The precache list stopped at what the HTML references**, but a module's
  static import graph goes deeper. Missing one dependency fails the whole module
  and is reported against the entry chunk — "Failed to fetch dynamically
  imported module: Converter.js" while Converter.js sits in the cache.
- **Content-hashed chunks were cached in the VERSIONED shell**, which `activate`
  wipes on every deploy. Every deploy silently destroyed offline support until
  the user repeated every conversion. They are content-hashed, so they can never
  be stale — they belong in the unversioned cache.
- **The worker replied to the client, not to the transferred port**, so the
  badge's `MessageChannel` never resolved. It timed out and resolved empty, so
  the badge simply never appeared rather than erroring.
- **Astro islands name their chunks with `component-url`**, not `src`, so a
  src/href-only scrape produced a 20 KB "shell" that could not render.

### Colour contrast, and why one test was theatre

Lighthouse: **performance 96, accessibility 100, best-practices 100, SEO 100.**

Getting there found two real failures:

- `glass-400` on the light background is **2.7:1**, needing 4.5:1. Dark mode was
  fine at 6.6:1, so light mode had been failing since P0.
- White on `copper-500` is **3.25:1**. Buttons now use `copper-600` (4.71:1) and
  copper text on light uses `copper-700` (5.35:1); 500 stays for borders, rings
  and hover, where the rule does not bite.

**The axe test in the component suite could not have caught either**, and passed
throughout. `vitest.browser.config.ts` had no Tailwind plugin, so `@import
"tailwindcss"` stayed raw, every utility class was inert, and axe measured
default black-on-white — reporting flawless contrast for a component shipping
2.7:1 grey. Verified the fix by reintroducing the bug: the test now fails on it.

**And Lighthouse could not have caught the second one**, because it only ever
loads the zero state, which has no buttons. The two checks are complementary,
which is the actual lesson.

**AC-P4:** airplane-mode heic→jpg verified by **killing the server**, not
simulating offline — page rendered from cache, conversion completed 25.7 KB →
22.2 KB, counter read zero. Lighthouse ≥ 95 on all four categories. (The PWA
category no longer exists in Lighthouse 12; offline was verified directly
instead, which is a stronger test than the audit was.)

### P4 errata — found on production

- **The first git-triggered Cloudflare build deployed an EMPTY site.** Every
  path 404'd, including `/`. Invisible from outside: the deployment lists as
  Production with a working-looking URL, and the previous manual deploy stays
  live, so the site appears healthy and silently stops receiving changes. Fixed
  by `wrangler.toml` pinning `pages_build_output_dir`. **The build command must
  be `pnpm build`** — `astro build` skips the hooks that gzip the ffmpeg core
  and generate the service worker.
- **Mixing manual `wrangler pages deploy` with a git-connected project is
  confusing to diagnose**: the alias serves whichever succeeded last, so a
  broken git build hides behind a good manual one. Manual deploys are now a
  break-glass tool, not a habit.
- **The offline badge demanded a PNG decoder that is never fetched.** PNG, JPEG,
  WebP, GIF, BMP and ICO decode through `createImageBitmap` — no wasm at all —
  but `NATIVE_DECODABLE` lived only in the worker while the badge kept its own
  guess. It reported "not available offline" for pairs that work fine, which
  undersells the product exactly where it is making a promise. One table now,
  in `formats.ts`, read by both.
- CI now asserts the service worker shipped, is the generated one, and
  **precaches no codecs** — a shell that quietly grew to include a 10 MB wasm
  would pass every other check.

## P5 — Pages and SEO (in progress) 2026-08-01

**44 pair pages, /formats, /why, sitemap, robots.** Staying on
`onhand.pages.dev` — no domain bought, so no SEO work is stranded by a later
move.

- **Pair pages are not a template with the nouns swapped.** Each carries its own
  `reason` sentence, and the "what changes" facts are derived from the format
  table — lossy versus lossless, whether the source is read-only, whether the
  pair needs the 9.7 MB engine. Measured: **44 distinct lead paragraphs across the
  44 pair pages**, and every `<title>` on the site distinct.
- **`pairs.ts` is validated against the engine at build time.** A page cannot
  exist for a pair the broker would refuse — which is the exact failure this
  project criticises competitors for.
- **The ranking is judgement, and says so.** No keyword tool here, so it is
  derived from what is knowable: which formats people are trapped in (HEIC,
  MOV), which pairs the incumbents surface in their own navigation, and which
  are a real job rather than a curiosity.
- **`/formats` is generated from the capability table**, so it physically cannot
  advertise something that doesn't work, and it names what is missing and why.
- **FAQPage schema is generated from the same array the page renders**, so it
  can never mark up a question that isn't visible.

### A real hang, found by CI and not reproducible locally

Every `tone.ogg` conversion timed out at 90 s on CI while passing on this
machine in milliseconds. Locally all three browsers report
`canDecodeAudio("vorbis") === true` and mediabunny reports `isValid`, so the
capability check is a hint, not a promise.

Rather than chase a Linux-specific codec quirk, the fix is the one that holds
regardless of cause: **a conversion must never hang forever.**
`withStallTimeout` watches for _silence_ rather than duration — a 2 GB video
legitimately takes minutes but never goes 30 s without a packet. On a stall it
cancels the worker-side job and lets the broker fall through to ffmpeg, so the
user still gets their file. Tested directly rather than by waiting.

### Also fixed

- **The browser tests needed `public/ffmpeg/`, which only the build hooks
  create**, and CI runs tests before build. It passed locally the whole time on
  a leftover artifact. `pretest:browser` now syncs it, verified from a clean
  tree.
- Removed the last `eslint-disable`: the offline effect closed over `jobs`
  without declaring it. Reading the pairs back out of the key means the key is
  the only dependency, which it always was.

### P5 — social cards

One card per pair, generated by `pnpm og` and committed. **Not** part of the
build: it needs a browser to rasterise and Cloudflare's build image has no
Playwright, so wiring it in would work locally and fail on deploy — the failure
this project has already paid for twice.

The script reads the BUILT pages to learn what each card should say, so a card
can never disagree with its page. That does mean two builds when regenerating
(`pnpm build && pnpm og && pnpm build`), which is documented at the top of the
script.

Backgrounds are flat deliberately. The first version had a radial gradient and
weighed **112 KB per image**; flat is **36 KB**, which across 44 cards is the
difference between 5 MB and 1.6 MB of committed binaries for identical
information.

CI now fails if a pair page has no card. Adding a pair without regenerating
leaves that page pointing at a 404, and a missing social card looks like nothing
at all until someone shares the link.

**Deployed output: 153 files, 30 MB** — against Cloudflare's limits of 20,000
files and 25 MiB per file, with the largest single file being the 9.7 MiB
gzipped ffmpeg core.

### P5 errata — found by Lighthouse on the new pages

- **`/why` scored 93 on accessibility: `link-in-text-block`.** Links inside
  prose were distinguished from surrounding text by colour alone. `hover:underline`
  is not enough — the distinction has to exist before you hover, and for anyone
  who cannot hover at all. In-prose links are now underlined by default; nav and
  footer links are not, because the rule only applies to links surrounded by text.
- **Every sitemap URL was a 308 redirect.** Astro emits directory routes, so each
  page's canonical is `/formats/`, while the sitemap and internal links said
  `/formats`. A wasted crawl hop on all 47 URLs, and each page advertising an
  address that disagreed with its own canonical. Now verified equal as sets:
  **47 sitemap URLs, 47 canonicals, no difference either way.**

**Lighthouse across all four page types** (home, pair, formats, why):
perf 96–100, accessibility 100, best-practices 100, SEO 100.

## Closing the CI-only failures — 2026-08-01

Four failures that never reproduced locally. Each turned out to be a real
defect, not an environment quirk.

**The queue ignored its own concurrency limit.** `maxConcurrency` was written in
P0 and only ever _displayed_ — the diagnostics panel told people "3 at a time"
while `runAll` fired every job simultaneously. On 18 cores that is merely untrue;
on a 2-core runner with three browsers competing it is a ten-file batch
finishing seven, because each job holds a wasm instance and they starve each
other. Now a worker pool pulling from a shared cursor, with a test that counts
concurrent in-flight rows and fails if the advertised limit is exceeded.

**A 10 KB file was reported as "too large to convert".** ffmpeg.wasm says
"Aborted()" for almost any internal failure, and the error classifier matched
`/abort/`. Claiming a file is too large now requires two things: a message that
names memory specifically, _and_ an input over 64 MB. Below that, whatever went
wrong was not memory — and telling someone to trim a 10 KB file is the kind of
message that makes them give up on a tool that was one fallback away from
working.

**A test asserted a belief rather than behaviour.** "Uses ffmpeg for MP3,
because no browser can encode it" failed on Linux WebKit, which is
GStreamer-backed and genuinely _does_ encode MP3 — so the WebCodecs path
correctly won and the test was wrong. It now asserts the output is a real MP3
and records which engine ran, the same pattern as `mov → mp4`.

**The claim was in the prose too, in six places**, including the README section
that sells the routing. Firefox encodes Vorbis; some Linux WebKit builds encode
MP3. Corrected everywhere. The capability-based routing was right all along —
it takes the fast path wherever one exists, with no code change — and the
overstatement undersold it.

Also: an offline visit to a pair page that was never cached serves the homepage
at that URL. The converter works, so the fallback stays, but the page now says
what happened instead of silently looking wrong. And `pnpm verify:live` exists
because production lied twice in ways that looked like real bugs — the alias
lags a deploy by a minute or two, and Cloudflare answers a _missing_ asset with
its 404 page and HTTP 200, so the script polls and asserts content types rather
than status codes.

**540 browser tests across Chromium, Firefox and WebKit. All green.**

### The ffmpeg OOM cascade — 2026-08-01

Eight consecutive WebKit failures on CI, each in about 70 ms. The real error,
once the "too large" misclassification stopped hiding it:

```
RuntimeError: Out of bounds memory access (evaluating 'Module["_malloc"](len*SIZE_I32)')
```

**One genuine OOM, then seven jobs talking to a dead instance.** The reset that
should have discarded the wedged engine only fired on `/abort/`, and that
message does not contain the word — so every subsequent job failed instantly
against a corrupted heap. Both judgements are now named functions
(`looksLikeMemoryExhaustion`, `shouldDiscardInstance`) with tests that pin them
against **the exact string emscripten produced**, not a paraphrase. An earlier
attempt matched "memory access out of bounds" — the same words in the wrong
order — which is precisely the kind of error a paraphrased test cannot catch.

**Two contributing causes, both fixed:**

- **mediabunny accepted work it could not do.** Only encodability was checked,
  never decodability, so a pair whose source codec the browser cannot decode
  reported `isValid`, failed partway through `execute()`, and was handed to
  ffmpeg — putting load on the one engine that was running out of heap. It now
  checks `canDecodeAudio`/`canDecodeVideo` first and declines cleanly.
- **CI ran three wasm-heavy browsers on one 2-core runner.** The cross-browser
  workflow is now a job matrix, one browser per runner. No extra wall-clock,
  since they run concurrently, and no shared heap to exhaust.

### A pool makes hangs worse — 2026-08-01

Adding the concurrency limit changed what a stuck job costs. Before, a job that
never settled blocked only itself; with a pool it holds a slot, so everything
queued behind it waits too. The mixed batch went from 10/10 to **8/10 after the
"fix"**, which is the sort of regression that only shows up under load.

The image engine had no protection at all — mediabunny got a stall detector and
ffmpeg a load deadline, but image codecs are one-shot with no intermediate
progress, so there is no silence to detect, only elapsed time. They now get an
absolute 120 s ceiling, defensible because the memory guardrail already caps
images near 90 MB and decode-plus-encode of that never approaches two minutes.

**And the harness was manufacturing its own contention.** `test:browser:all` ran
three browsers concurrently on one machine; WebKit **passed alone and failed in
that run**. It is sequential now, matching CI's job matrix. Same root cause as
the ffmpeg OOM one commit earlier — three wasm-heavy browsers on hardware sized
for one.

The pattern worth remembering: twice a CI-only failure looked environmental and
twice it exposed a genuine defect underneath. Load does not create these bugs,
it makes them reproducible.

**180 tests per browser, all three green, sequentially.**

## Design pass — 2026-08-01

Serviceable, not a visual identity. That comes with a designer.

**The one real bug it found: on a 375 px viewport the filename truncated to a
single character.** The row was one flex line, so `flex-1` on the name got
almost nothing once the select, size, Save and ✕ had taken their width. A queue
row has exactly one job — telling you which file it is — and on mobile it did
not do it. Now a grid that gives the name its own full-width cell on small
screens and stays one line on desktop.

**The counter moved into the zero state.** It is the strongest thing this
product has to say and it only appeared once a file was queued — absent at
precisely the moment someone is deciding whether to believe the page.

Also: the mark from the favicon in the drop zone, copper on the counter so the
accent exists before you interact, a "Common conversions" grid generated from
the ranked pair list (which doubles as internal linking to all 44 pair pages),
and a shorter drop zone on mobile where it was eating half the screen.

### What the design pass broke, and what caught it

- **A translucent drop-zone fill** (`bg-glass-100/40`) meant axe could not
  resolve what the text sat on and reported contrast as _incomplete_. The suite
  treats that as a failure on purpose — "could not determine" is not "fine" —
  so it was caught immediately. Solid tints look the same and stay checkable.
- **A copper drag fill measured 1.6:1 against light text in dark mode.** Caught
  by computing it rather than looking at it. The copper border and icon carry
  the accent; the fill is a neutral lift at 11.9:1.
- **A decorative `·` separator** axe could not classify. Deleted rather than
  filtered — it added nothing.
- **Two tests found the counter by tag** and broke when it became a `<p>`. They
  now find it by what it says.

**Lighthouse after: 96 / 100 / 100 / 100** on both the homepage and a pair page.

## The last red test — 2026-08-01

One failing test survived every fix: `tone.ogg → opus` on Playwright's Linux
WebKit. Chasing it properly took three rounds and each round was worth it.

**Round 1 — the diagnostic was wrong.** CI reported "Converting OGG to Opus
failed." and nothing else. Surfacing `cause` gave `encoder : Lavc59.37.100
libopus`, which is ffmpeg saying the encoder loaded _successfully_ — because the
engine kept only the LAST log line, and ffmpeg's final output is always
harmless metadata. Now a twenty-line ring, preferring lines that match
error/invalid/unable/failed.

**Round 2 — it was never WebKit.** With the real error visible
(`RuntimeError: memory access out of bounds`, thrown as a string, so
`err.message` was undefined) it reproduced in **Chromium, locally**. WebKit was
simply the only browser without a WebCodecs Opus encoder, so the only one that
ever reached the ffmpeg path.

**Round 3 — isolate it.** A fresh ffmpeg instance per case:

| case                | result                           |
| ------------------- | -------------------------------- |
| ogg (stereo) → opus | crash                            |
| ogg `-ac 1` → opus  | fine, 19 KB                      |
| stereo.wav → opus   | crash — different input entirely |
| mp3 (mono) → opus   | fine, 18 KB                      |
| ogg (stereo) → flac | fine, 97 KB                      |

Not the container, not the source codec, not the fixture:
**ffmpeg.wasm 5.1.4's libopus faults on any stereo input.**

Forcing mono would turn the test green by silently discarding a channel — the
exact quiet data loss `/why` says we refuse. So Onhand reports it, the README
and THIRD_PARTY name it, and the test asserts **that specific message** rather
than accepting any failure. A test that tolerates "it broke somehow" is not a
test.

In practice it is unreachable: Chrome, Firefox and Safari all encode Opus
natively, so ffmpeg is never asked.

**180/180 on WebKit.**

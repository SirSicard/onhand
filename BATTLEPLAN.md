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

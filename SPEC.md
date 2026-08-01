# ALEMBIC — product spec v1

**One line:** every file converter on one page, nothing ever uploaded — *including video*.

**Thesis:** the cloud converters must meter because they pay for compute. We don't, so we
don't. VERT proved the demand for the local model but left video on a server; WebCodecs
(near-baseline 2026, Safari 26) lets us kill that asterisk with *hardware-accelerated* video
conversion in the tab. Free forever is structural: static site, user's silicon.

**Non-negotiables** (the Inkwell values, restated):
MIT · no accounts · no telemetry (not even "privacy-friendly" analytics in v1) · no ads ·
no email gates · no fake progress · file bytes provably never leave the device.

---

## 1. Scope

### v1 formats (three engines, ~40 formats, ~200 curated pairs)

| Engine | In | Out | Notes |
|---|---|---|---|
| **Images** (jSquash + libheif-js + resvg + pdf-lib/pdf.js) | jpg png webp avif **heic/heif** gif bmp tiff ico svg pdf | jpg png webp avif gif ico pdf | HEIC→JPG is the hero pair (every iPhone). pdf↔images both directions. Quality slider + resize + strip-metadata toggle |
| **Audio** (ffmpeg.wasm single-thread) | mp3 wav m4a aac ogg opus flac aiff wma | mp3 wav m4a ogg opus flac | Fast even in wasm (audio is small). Bitrate presets |
| **Video** (WebCodecs fast path → ffmpeg.wasm fallback) | mp4 mov webm mkv avi m4v gif | **mp4 (H.264/AAC)** webm gif mp3/wav/m4a (extract) | mov→mp4, webm→mp4, mkv→mp4, video→mp3, mp4→gif, gif→mp4. Resolution presets (keep/1080/720), trim (start–end) v1.1 |

### Explicitly OUT of v1 (write these in the README as honesty)
- Office docs (docx/xlsx/pptx) — LibreOffice-WASM is ~250 MB and unstable in 2026; revisit
- Anything YouTube/URL-download shaped — legal tarpit, requires network, off-thesis
- OCR, editing suites, AI upscaling — different products
- Batch > browser memory (2 GB wasm ceiling) — pre-flight warning instead of pretending

## 2. Architecture

```
Astro (static output, ~200 prerendered pair pages + tool pages)
 └─ React 19 island: <Converter/>  (one component, hydrated on every page, pair-preset via props)
     ├─ queue store (zustand)
     ├─ engine broker (worker pool, Comlink)
     │    ├─ images.worker    — jSquash codecs, lazy per-codec wasm (~0.2–2 MB each)
     │    ├─ webcodecs.worker — web-demuxer → VideoDecoder/AudioDecoder → VideoEncoder/
     │    │                     AudioEncoder → mp4-muxer/webm-muxer (StreamTarget)
     │    └─ ffmpeg.worker    — @ffmpeg/ffmpeg single-thread core (~31 MB, lazy, CacheStorage)
     │         └─ mt core swapped in ONLY if crossOriginIsolated && deviceMemory ≥ 8
     └─ capability probe at load: WebCodecs config support, SAB, memory → route table
```

**Engine selection per job:** try cheapest engine that supports the pair on THIS browser;
fall through silently (user sees one progress bar, never "engine"). AAC-encode gap on
Firefox/Linux → ffmpeg audio track mux, or full ffmpeg fallback. Every engine runs in a
worker; the main thread never blocks.

**Memory strategy:** File System Access API `showSaveFilePicker` streaming writes where
available (Chromium) so outputs never sit in RAM; blob fallback elsewhere. Pre-flight
estimator warns > ~1.2 GB inputs on the ffmpeg path (2 GB wasm ceiling is real).

**Hosting:** Cloudflare Pages (free, unlimited bandwidth — the 31 MB core makes this the
deciding factor over Vercel's 100 GB cap). `_headers`:
```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```
Everything self-hosted (COEP breaks third-party embeds; we have none — fonts local, zero
external requests, which is also the marketing claim).

## 3. UX spec

**Zero state:** one full-viewport drop zone. Headline: *"Drop anything."* Sub: *"Converted on
your device. Nothing is uploaded — watch the network tab if you don't believe us."* Paste
(⌘V), click-to-browse, folder drop. Beneath the fold: format grid linking the pair pages.

**Queue (the whole app):** one row per file —
`[icon] name · size → [target format ▾] [⚙ options] [progress/●done] [↓] [✕]`
- Target picker defaults smartly (heic→jpg, mov→mp4, wav→mp3); remembers last choice per source type
- Options = presets first (**Smallest / Balanced / Best / Lossless**), knobs behind "Advanced"
- Global bar: `Convert all to ▾` · `Start` · `Download all (.zip)` (fflate, streamed)
- Real progress (ffmpeg progress events / frames-encoded ÷ frames-total), overall % mirrored in tab title
- Output row shows size delta: `12.4 MB → 3.1 MB (−75 %)`

**Trust surface (differentiator, not decoration):**
- Live **"↑ 0 bytes uploaded"** counter in the header (PerformanceObserver over fetch/XHR)
- Offline badge once service worker has the visited codecs cached; "works in airplane mode"
- Footer: GitHub link, licence, "read the code" — the Inkwell README voice

**A11y & feel:** full keyboard operation, `aria-live` progress announcements, reduced-motion
respected, dark/light via `prefers-color-scheme`. Mobile works (with honest memory limits on
video). Lighthouse ≥ 95 across the board on pair pages.

**Anti-dark-pattern manifesto page** (`/why`): name the practices we refuse — upload-then-
paywall, fake queues, email gates. It's a marketing asset, same move as Inkwell's measured-
numbers README.

## 4. Pages & SEO

- `/` — converter, zero-state
- `/{from}-to-{to}` — ~200 curated pairs (traffic-ranked, not the permutation explosion):
  static H1 + 3-step how-to + honest FAQ (FAQPage schema) + converter island preset to the pair
- `/tools/{compress-image, video-to-mp3, make-gif, images-to-pdf}` — intent aliases of the same island
- `/why` manifesto · `/formats` support matrix · sitemap.xml, OG images per pair
- Target queries the incumbents can't honestly own: "… converter **no upload**", "… **private**", "… **offline**"

## 5. Success criteria (measured, README-grade)

1. `crossOriginIsolated === true` in production; airplane-mode conversion works after one visit
2. HEIC→JPG ×50 batch < 20 s on an M-series laptop
3. 100 MB 1080p mov→mp4 via WebCodecs ≈ real-time or faster on M-series; never blocks UI
4. E2E asserts **zero network requests containing file bytes** during a conversion
5. First-load JS (landing, before any codec) < 250 KB; pair pages LCP < 1.8 s on 4G
6. mkv→mp4 (ffmpeg path) succeeds on a 300 MB fixture in Chrome, Firefox, Safari

## 6. Licence positioning

App MIT. Stock @ffmpeg/core is LGPL+GPL-mix (x264) — v1 ships it with a THIRD_PARTY notice,
**mainline H.264 encodes go through WebCodecs (OS codecs) anyway**; a custom LGPL-only core
(drop x264/x265) is a listed v1.1 task to make the licence story pristine. jSquash codecs
carry their upstream licences (fine). VERT is AGPL — nothing is copied from it, ever; link
them as the OSS alternative on /why. Gracious beats silent.

# ONHAND — market + technology research

**2026-08-01 · researched by Fable, all claims from live searches, sources at bottom.**
Name **ONHAND** — files converted on your own hardware, close at hand.

> Naming history, so it isn't relitigated: the working name was **Alembic**, killed
> 2026-08-01. Alembic is already an open computer-graphics interchange **file format**
> (`.abc`, Sony Imageworks + ILM, in the Library of Congress format registry) *and* the
> standard SQLAlchemy migration tool. Naming a file converter after an existing file
> format it does not convert poisons every search worth winning. The alchemy register
> generally is mined out — Athanor, Crucible, Retort and Kiln are all taken by existing
> software. Domain availability could not be checked reliably by machine (RDAP
> rate-limits, DNS gives parking false-positives) — verify at a registrar.

---

## 1. The market, priced

### Cloud converters (the incumbents)

| Product | Free tier | Paid | The catch |
|---|---|---|---|
| **CloudConvert** | 10–25 conversions/day | $8 for 500 min (pay-as-you-go, $0.016/min) or $8/mo for 1,000 min | Credit anxiety — every minute metered. API-grade quality, 200+ formats |
| **Convertio** | 100 MB/file | $9.99–25.99/mo | The 100 MB wall hits the moment you touch video |
| **Zamzar** | 50 MB/file, 2/day | ~$9.99–25/mo | Oldest brand, most aggressive free-tier squeeze |
| **FreeConvert** | 1 GB/file, ads | $9.99–25.99/mo | Most generous free tier, monetises with ads + upsell |
| **TinyWow / smallpdf / ilovepdf class** | free w/ ads | ~$6–15/mo | Ad-walled, file goes to their server |

**Their shared architecture is the product's weakness:** upload → queue → convert on their
server → download. Every one of them bears real compute + bandwidth costs per conversion,
which is *why* they must meter, cap, ad-wall or subscribe. A client-side converter has no
marginal cost, so "free" is structural, not promotional.

### Desktop

| Product | Price | Notes |
|---|---|---|
| HandBrake | free, OSS | Video only, intimidating for normals |
| FFmpeg | free, OSS | CLI; the engine everyone wraps |
| Permute (Mac) | ~$15 | Polished, Mac-only |
| Wondershare UniConverter | ~$40–60/yr | Adware-adjacent upsell machine |

### The direct competitor: VERT.sh — exists, is good, and has one asterisk

- Open source (**AGPL**), Svelte/TS, "250+ formats", strong press (XDA, Medium, HN).
- Images/audio/documents run locally via WASM.
- **Video is NOT local** — "all processing (other than video) is done on your device."
  Video routes to their hosted daemon (VERTd) or a self-hosted one. Their own tagline
  carries the asterisk: *"fully local\*"*.
- No programmatic SEO surface to speak of — it's an app, not a thousand landing pages.

**Positioning consequence:** the category is half-taken. What is NOT taken:
1. **Fully-local video** — now feasible (see WebCodecs below). Kill the asterisk.
2. **The SEO long tail** — CloudConvert/FreeConvert live off `x-to-y` pages; VERT doesn't play.
3. MIT licence + measured-numbers README (the Inkwell playbook).
Do not copy VERT's code (AGPL). Link them graciously as the OSS alternative; beat them on video + reach.

---

## 2. Technology — what changed that makes this buildable NOW

### WebCodecs is near-baseline (the big one)
- **Safari 26 ships full support** (video + audio encode/decode); Safari 16.4–18.7 video-only.
- Chrome/Edge 94+ full. Firefox 130+ decode + most encode paths.
- Hardware-accelerated → near-native speed, ~0 % CPU drama, no GPL x264 needed (OS codecs).
- Caveat that matters: **AAC encode missing on Firefox (all platforms) and every browser on
  desktop Linux** → those jobs fall back to ffmpeg.wasm's native AAC (LGPL) or Opus.
- WebCodecs does NOT mux. Pure-TS muxers are mature: **mp4-muxer / webm-muxer** (tiny, fast,
  StreamTarget = progressive writes). Demux: **mp4box.js / web-demuxer**.

### ffmpeg.wasm — the universal fallback, with hard edges
- **2 GB WASM memory ceiling** (hard); real-world failures start well below on low-RAM devices.
- Single-thread is the stable path; **mt build needs SharedArrayBuffer** → cross-origin
  isolation (COOP `same-origin` + COEP `require-corp`), and is documented "unstable, ~2 GB RAM".
- Perf reality check: ~25 fps for 1080p H.264 encode on a 2018 MBP, 100 % CPU. Fine for audio
  and exotic-format rescue; wrong tool for mainline video → WebCodecs first, ffmpeg fallback.
- Core download ~31 MB → lazy-load only when needed, cache forever (CacheStorage + immutable).

### Images — small, fast, proven
- **jSquash** (Squoosh's codecs repackaged for browser/worker): mozjpeg, oxipng, png, webp,
  avif, jxl, resize. Battle-tested, per-codec lazy bundles.
- HEIC decode via libheif-js (iPhone photos = the single highest-demand image pair).
- SVG→raster via resvg-wasm; ICO/BMP/TIFF have small decoders or go through ffmpeg.

### Documents — deliberately OUT of v1
- LibreOffice-WASM (ZetaOffice) is real but **~250 MB artifact and "unrealistic/unstable in
  2026"** per practitioners. docx-wasm is commercial. Verdict: pdf↔image only in v1; office
  formats revisited when the WASM matures. This is also VERT's weakest area — nobody wins
  docs client-side yet, so nothing is lost by waiting.

### Hosting mechanics (decides the platform)
- Cross-origin isolation via **`_headers` on Cloudflare Pages** — two lines, done. All assets
  self-hosted (COEP `require-corp` breaks third-party embeds; we have none, fonts local).
- **Cloudflare Pages free = unlimited bandwidth.** Vercel free = 100 GB/mo — a 31 MB ffmpeg
  core times real traffic murders that cap. CF Pages is the call (he already has CF for
  Inkwell's updater Worker). Bonus: avoids the Vercel-Hobby commit-author trap entirely.

---

## 3. UX research — what the category teaches

**Dark patterns to explicitly reject** (documented across Convertio/FreeConvert/Zamzar
reviews; these are the complaints that fill their 1-star pages):
- Upload → wait → "create an account to download your file"
- Fake progress/queues to sell "priority processing"
- Email-gated downloads, drip-limit counters, ad interstitials mid-flow
- File-size walls discovered only AFTER the upload finishes (Convertio 100 MB)

**Patterns worth stealing:**
- **Squoosh**: instant preview, quality slider with live size readout, keyboard-first, PWA.
- **VERT**: drop → it just converts; no ceremony; praised in every review for exactly this.
- **HandBrake presets**: normals don't want bitrate ladders, they want "for email / for web /
  best quality" — three presets beat thirty knobs.

**The trust surface IS the UX** for this product: a live "0 bytes uploaded" network counter,
an offline badge once cached, airplane-mode demo in the README, open devtools invitation.
Nobody else can honestly show that; it converts privacy from a claim into a visible fact.

---

## 4. Traffic model (why this gets found at all)

CloudConvert/FreeConvert's real moat is thousands of indexed `x-to-y` pages. A static site
can play the same game at £0: generate `/heic-to-jpg`, `/mov-to-mp4`, `/mp4-to-mp3` … from
the support matrix (curate ~150–300 high-volume pairs, not the full permutation explosion),
each a real page: H1, 3-step how-to, honest FAQ (+ FAQPage schema), the converter island
preloaded with that pair. "No upload" is also a *search differentiator* — "heic to jpg no
upload / private / offline" queries exist and nobody owns them.

---

## Sources
- CloudConvert pricing: cloudconvert.com/pricing via search (credits $8/500 min PAYG, $8/mo sub)
- Convertio 100 MB / Zamzar 50 MB / FreeConvert 1 GB free-tier limits: spotsaas, morphjet, saasworthy comparisons
- VERT: github.com/VERT-sh/VERT (AGPL, "fully local\*", video via daemon), xda-developers review
- WebCodecs status: caniuse.com/webcodecs, webcodecsfundamentals.org (Safari 26 full, Firefox 130+ partial, AAC-encode gaps)
- ffmpeg.wasm: ffmpegwasm.netlify.app FAQ/perf docs + GH issues #876/#623 (2 GB ceiling, mt unstable, 25 fps 1080p)
- jSquash: github.com/jamsinclair/jSquash
- LibreOffice-WASM state: dev.to practitioner writeup + ZetaOffice web editor (~250 MB, unstable 2026)
- COOP/COEP: web.dev/articles/coop-coep; CF Pages `_headers` support confirmed

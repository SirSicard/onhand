# Onhand

**Every file converter on one page. Nothing is ever uploaded — including video.**

Images, audio and video converted entirely inside your browser tab, on your own machine.
No accounts, no ads, no email gates, no upload. Free forever, because it costs nothing to run.

> **Status: images working.** Drop a HEIC, JPEG, PNG, WebP, AVIF, TIFF, BMP, GIF,
> ICO or SVG and get JPEG, PNG, WebP or AVIF back. Audio and video land in P2.
> See [`BATTLEPLAN.md`](./BATTLEPLAN.md) for the build order.

---

## Why this exists

Every cloud converter — CloudConvert, Convertio, Zamzar, FreeConvert — works the same way:
you upload your file to their server, they convert it, you download it back. That
architecture is why they all have to meter you. CloudConvert charges by the minute,
Convertio caps free files at 100 MB, Zamzar at 50 MB and two files a day.

They aren't being greedy. Server conversion genuinely costs them money per file.

Onhand doesn't have that cost, because there is no server. WebAssembly and WebCodecs run
the codecs in your tab, on your silicon. So "free" isn't a promotional tier that will be
squeezed later — it's just what the thing costs.

The nearest thing to this is [VERT.sh](https://vert.sh), which is open source, good, and
worth your time. Its own tagline says "fully local\*" — the asterisk is video, which routes
to a server. Onhand's bet is that [WebCodecs going near-baseline in 2026](https://caniuse.com/webcodecs)
means that asterisk no longer has to exist.

## How you can check we mean it

- A live **"↑ 0 bytes uploaded"** counter runs in the header while you convert
- Open DevTools → Network and watch. There is nothing to see
- Turn off your wifi. After one visit it still works
- The site makes **zero external requests** — no CDN, no fonts, no analytics, nothing
- Read the source. It's MIT

## What it will support

|            |                                                                     |
| ---------- | ------------------------------------------------------------------- |
| **Images** | jpg png webp avif **heic** gif bmp tiff ico svg → jpg png webp avif |
| **Audio**  | mp3 wav m4a aac ogg opus flac aiff wma                              |
| **Video**  | mp4 mov webm mkv avi gif, plus extract-audio                        |

**Not supported, honestly:** Office documents (docx/xlsx/pptx). LibreOffice-in-the-browser is
a ~250 MB download and unstable as of 2026. When that changes, this line changes.

**Known limit:** the WebAssembly memory ceiling is 2 GB, so very large video files will be
refused rather than half-converted. You'll be told before the job starts, not after.

## Development

```bash
pnpm install
pnpm dev        # http://localhost:4321
pnpm typecheck
pnpm test
pnpm build
```

Requires Node 22+ (see `.nvmrc`). Deploys to Cloudflare Pages as a fully static site.

The dev server sets the same COOP/COEP headers as production. That isn't optional — without
cross-origin isolation `SharedArrayBuffer` is unavailable and the multithreaded codec path
silently never engages, which is a bug you'd only find after deploying.

## Licence

MIT — see [LICENSE](./LICENSE). Third-party codec licences are listed in
[THIRD_PARTY.md](./THIRD_PARTY.md) as they're added.

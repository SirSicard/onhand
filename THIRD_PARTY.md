# Third-party components

Onhand's own source is MIT (see [LICENSE](LICENSE)). It relies on codecs written
by other people under other licences, and two of those need more than a line in
a table. This document exists so you can check that for yourself rather than
take my word for it.

I am not a lawyer. What follows is the reasoning behind how this is shipped,
stated plainly so you can disagree with it.

---

## The ffmpeg core is GPL, and that is the interesting one

|               |                                                                             |
| ------------- | --------------------------------------------------------------------------- |
| Component     | `@ffmpeg/core` 0.12.10 — FFmpeg compiled to WebAssembly                     |
| Licence       | **GPL-2.0-or-later**                                                        |
| Source        | https://github.com/ffmpegwasm/ffmpeg.wasm (which builds https://ffmpeg.org) |
| How it ships  | `public/ffmpeg/ffmpeg-core.wasm.gz`, unmodified, served from our own origin |
| When it loads | Only when a conversion needs it — MP3 or Vorbis output, an AVI input, a GIF |

The threaded build (`@ffmpeg/core-mt`, same licence) was evaluated and is not
shipped — it is 2x faster on video and froze three different ways. The reasoning
is in `src/engine/engines/ffmpegEngine.ts`.

**We distribute this binary**, so the GPL's source-availability obligation
applies to it. It is unmodified upstream, and the corresponding source is at the
link above.

**Onhand's own code stays MIT.** The argument is the ordinary one: the core is a
separate program, downloaded separately, that we talk to across a worker
boundary by message passing — the same relationship an application has with an
`ffmpeg` binary it invokes. It is not linked into our code and our code is not
derived from it. This is what essentially every project shipping an ffmpeg
binary relies on. It is widely accepted and, as far as I know, has never been
tested in court.

If that reasoning ever stops being comfortable, the escape hatch is to build the
core without `--enable-gpl` (dropping libx264 and friends) and ship an LGPL
core instead. The cost is real and worth stating: **no H.264 encoding on the
ffmpeg path, which is exactly the fallback Firefox uses for `mov` → `mp4`.**
That trade has not been made.

### A known defect in this build

ffmpeg.wasm 5.1.4's **libopus faults on stereo input** — `RuntimeError: memory
access out of bounds`. Isolated with a fresh instance per case: mono input
encodes fine, stereo crashes regardless of container or source codec, and the
same stereo audio converts to FLAC without complaint. It is libopus plus more
than one channel in this build, nothing narrower.

Onhand reports it rather than silently downmixing, and in practice it is
unreachable: every browser worth naming encodes Opus through WebCodecs, so the
ffmpeg path is never asked for it.

## libheif is LGPL

|              |                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------ |
| Component    | `libheif-js` 1.19.8 — HEIC/HEIF decoding                                                         |
| Licence      | **LGPL-3.0**                                                                                     |
| Source       | https://github.com/catdad-experiments/libheif-js, building https://github.com/strukturag/libheif |
| How it ships | A separate, unmodified chunk, loaded on demand                                                   |

LGPL asks that a user be able to replace the library. It ships as its own
unmodified file rather than being bundled into ours, this repository is public,
and the build is reproducible from it — so replacing it means swapping one file
and rebuilding.

---

## Everything else

All permissive, all unmodified, none of it altering Onhand's own licence.

| Component                                                  | Licence    | What it does                                                                                 |
| ---------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| `@jsquash/jpeg`, `png`, `webp`, `avif`, `oxipng`, `resize` | Apache-2.0 | Image codecs (MozJPEG, libwebp, libavif, oxipng) compiled to wasm                            |
| `@resvg/resvg-wasm`                                        | MPL-2.0    | SVG rasterising — Chromium refuses SVG blobs to `createImageBitmap`, so this is not optional |
| `mediabunny`                                               | MPL-2.0    | Demux, mux and the WebCodecs pipeline for audio and video                                    |
| `pdfjs-dist`                                               | Apache-2.0 | PDF → images                                                                                 |
| `pdf-lib`                                                  | MIT        | Images → PDF                                                                                 |
| `utif`                                                     | MIT        | TIFF decoding — no browser decodes TIFF natively                                             |
| `comlink`                                                  | Apache-2.0 | The worker RPC layer                                                                         |
| `fflate`                                                   | MIT        | Zip writing for "Download all"                                                               |
| `@ffmpeg/ffmpeg`, `@ffmpeg/util`                           | MIT        | The JS wrapper around the core (the _wrapper_ is MIT; the core above is not)                 |
| `astro`, `react`, `react-dom`                              | MIT        | The site and its one interactive island                                                      |

Full text of each licence is in that package's directory under `node_modules`
after `pnpm install`, and in each project's own repository.

## Test corpus

Everything in `fixtures/` is synthetic — generated by `fixtures/generate.py` and
`fixtures/generate_av.py` from test patterns and tones. No stock photography, no
sample media from anyone else, so there is nothing here with a licence question
attached. See [fixtures/README.md](fixtures/README.md).

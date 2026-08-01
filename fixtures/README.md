# Test corpus

Real files, real encoders, no downloads. Regenerate with:

```bash
python3 fixtures/generate.py
```

Everything here is produced from two synthesised source images by encoders that
actually ship: **Apple's `sips`** for HEIC/AVIF/TIFF/BMP/ICO and **PIL** for the
rest. Nothing is fetched from the internet, so the corpus is unambiguously ours
to ship under MIT and it rebuilds identically on any Mac.

**Why synthesised rather than a stock photo:** licensing is unambiguous, and we
know the ground truth — exact dimensions and exact colours at known pixels — so a
test can assert the *image survived* rather than merely asserting bytes appeared.

## The files

| File | Bytes | What it is for |
|---|---:|---|
| `photo.png` | 32,036 | The master. 640×480 RGB, gradients + fine detail + hard edges |
| `photo.jpg` | 57,582 | Lossy source, q92 |
| `photo.webp` | 36,660 | WebP source (PIL, lossy) |
| **`photo.heic`** | **26,354** | **Apple-encoded HEIC, `ftypheic` brand, HEVC Main Still Picture.** The hero pair's input — genuinely what an iPhone writes |
| `photo.avif` | 29,137 | Apple-encoded AVIF |
| `photo.tiff` | 925,056 | Big-endian TIFF, 14 bps — deliberately awkward |
| `photo.bmp` | 921,654 | Uncompressed BMP |
| `graphic-alpha.png` | 1,902 | Flat colour + **gradient alpha wedge** |
| `graphic-alpha.webp` | 812 | Lossless WebP with alpha |
| `graphic-alpha.heic` | 3,301 | HEIC carrying alpha |
| `greyscale.png` | 22,387 | Colour type 0 — not RGBA |
| `palette.png` | 11,372 | Colour type 3, 64-colour palette |
| `icon.ico` | 17,470 | 64×64, 32bpp |
| `animated.gif` | 1,364 | **4 frames.** We support frame one only — this proves that is deliberate |
| `rotated-exif.jpg` | 52,844 | **EXIF orientation 6** (rotate 90° CW) |
| `two-page.pdf` | 32,473 | Multi-page |
| `vector.svg` | 399 | Markup, with text and stroke |
| `tiny-1x1.png` | 69 | Degenerate dimensions |

Total ≈ 2.2 MB.

## The awkward cases, and why each is here

These are not padding. Each one is a place converters actually break:

- **`rotated-exif.jpg`** — orientation 6 means "rotate 90° clockwise when
  displaying". A converter that decodes to pixels without honouring it outputs a
  sideways photo. This is the single most common complaint about image tooling,
  and it is invisible unless you test for it.
- **`animated.gif`** — we decode the first frame only. A four-frame source proves
  that is a deliberate, stable behaviour rather than a crash waiting for its
  moment.
- **`greyscale.png` / `palette.png`** — PNG colour types 0 and 3. Decoders written
  against 8-bit RGBA assumptions fall over on these.
- **`graphic-alpha.*`** — the alpha wedge is a gradient, not a binary mask.
  Encoders that flatten or binarise transparency fail visibly.
- **`tiny-1x1.png`** — degenerate dimensions break naive resize maths.
- **`photo.tiff`** — big-endian and 14 bits per sample. TIFF is a container of
  wildly varying contents and this is the least convenient plausible one.

## Ground truth

`photo.*` are all **640×480**. `graphic-alpha.*` are **320×320**. `icon.ico` is
**64×64**. `animated.gif` is **120×120** across 4 frames. `two-page.pdf` has
**2 pages**.

A conversion that returns the wrong dimensions has failed even if it produced a
valid file — assert on both.

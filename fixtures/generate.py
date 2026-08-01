#!/usr/bin/env python3
"""
Regenerate the Onhand test corpus.

    python3 fixtures/generate.py

Every fixture is produced from two synthesised source images, then encoded by a
REAL encoder — Apple's `sips` for HEIC/AVIF/TIFF/BMP/ICO/GIF/PDF, PIL for the
rest. Nothing is downloaded, so the whole corpus is unambiguously ours to ship
under MIT, and it is reproducible on any Mac.

Why synthesised sources rather than a stock photo:
  * Licensing is unambiguous.
  * We know the ground truth (exact dimensions, exact colours at known pixels),
    so a test can assert the image survived a round trip rather than merely
    asserting bytes came out.
  * The gradient/detail mix exercises the things that actually break codecs:
    smooth areas reveal banding, fine detail reveals chroma subsampling, hard
    edges reveal ringing, and the alpha wedge catches encoders that silently
    flatten transparency.

Deliberately included awkward cases, because these are where converters fail:
  * EXIF orientation 6 (rotated 90°) — the classic "why is my photo sideways"
  * an animated GIF — we only support the first frame, so the corpus must prove
    we handle it predictably rather than crashing
  * a 1x1 image — degenerate dimensions
  * a greyscale PNG and a palette PNG — non-RGBA colour types
  * a multi-page PDF — page handling
"""

from __future__ import annotations  # system python is 3.9; PEP 604 unions need this

import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).parent
OUT = HERE
W, H = 640, 480


def photographic() -> Image.Image:
    """Smooth gradients + fine detail + hard edges: the mix that breaks codecs."""
    img = Image.new("RGB", (W, H))
    px = img.load()
    for y in range(H):
        for x in range(W):
            # Broad diagonal gradient — smooth areas show banding if quality is low.
            r = int(255 * (x / W))
            g = int(255 * (y / H))
            b = int(255 * ((x + y) / (W + H)))
            # High-frequency detail — the first thing chroma subsampling destroys.
            if (x // 3 + y // 3) % 2 == 0:
                r = min(255, r + 18)
                b = max(0, b - 18)
            px[x, y] = (r, g, b)
    d = ImageDraw.Draw(img)
    # Hard edges and flat fills — ringing artefacts show up against these.
    d.rectangle([40, 40, 200, 160], fill=(200, 30, 30))
    d.ellipse([260, 60, 420, 220], fill=(20, 120, 200))
    d.line([0, H - 1, W - 1, 0], fill=(255, 255, 255), width=3)
    for i in range(0, W, 40):
        d.line([i, 0, i, 20], fill=(0, 0, 0), width=1)
    return img


def graphic_with_alpha() -> Image.Image:
    """Flat colour + a real alpha wedge — catches encoders that drop transparency."""
    img = Image.new("RGBA", (320, 320), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 319, 319], fill=(14, 18, 26, 255))
    d.ellipse([60, 60, 259, 259], fill=(200, 125, 66, 255))
    for x in range(320):
        # Gradient alpha: an encoder that binarises alpha fails visibly here.
        d.line([x, 280, x, 319], fill=(255, 255, 255, int(255 * x / 319)))
    return img


def sips(src: Path, dst: Path, fmt: str, extra: list[str] | None = None) -> bool:
    cmd = ["sips", "-s", "format", fmt, str(src), "--out", str(dst)]
    if extra:
        cmd[1:1] = extra
    res = subprocess.run(cmd, capture_output=True, text=True)
    ok = res.returncode == 0 and dst.exists()
    if not ok:
        print(f"  ! sips {fmt} failed: {res.stderr.strip()[:120]}", file=sys.stderr)
    return ok


def main() -> int:
    OUT.mkdir(exist_ok=True)
    photo = photographic()
    graphic = graphic_with_alpha()

    # --- PIL-written masters -------------------------------------------------
    photo.save(OUT / "photo.png", "PNG")
    photo.save(OUT / "photo.jpg", "JPEG", quality=92)
    photo.save(OUT / "photo.webp", "WEBP", quality=90)
    graphic.save(OUT / "graphic-alpha.png", "PNG")
    graphic.save(OUT / "graphic-alpha.webp", "WEBP", lossless=True)

    # Non-RGBA colour types — decoders often assume 8-bit RGBA and fall over.
    photo.convert("L").save(OUT / "greyscale.png", "PNG")
    photo.convert("P", palette=Image.ADAPTIVE, colors=64).save(OUT / "palette.png", "PNG")

    # Degenerate size.
    Image.new("RGB", (1, 1), (200, 125, 66)).save(OUT / "tiny-1x1.png", "PNG")

    # Animated GIF — we support the first frame only; this proves that is
    # deliberate and stable rather than a crash waiting to happen.
    frames = []
    for i in range(4):
        f = Image.new("RGB", (120, 120), (14, 18, 26))
        ImageDraw.Draw(f).ellipse([10 + i * 20, 30, 60 + i * 20, 80], fill=(200, 125, 66))
        frames.append(f)
    frames[0].save(
        OUT / "animated.gif", save_all=True, append_images=frames[1:], duration=150, loop=0
    )

    # EXIF orientation 6 = "rotate 90° CW on display". A converter that ignores
    # this produces a sideways photo, which is the single most common complaint
    # about image tooling.
    exif = Image.Exif()
    exif[0x0112] = 6
    photo.save(OUT / "rotated-exif.jpg", "JPEG", quality=90, exif=exif)

    # Multi-page PDF.
    p2 = graphic.convert("RGB")
    photo.save(OUT / "two-page.pdf", "PDF", save_all=True, append_images=[p2])

    # SVG — markup, written by hand so it is readable and obviously ours.
    (OUT / "vector.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" '
        'viewBox="0 0 320 320">\n'
        '  <rect width="320" height="320" fill="#0e121a"/>\n'
        '  <circle cx="160" cy="160" r="100" fill="#c87d42"/>\n'
        '  <path d="M60 260 L160 80 L260 260 Z" fill="none" stroke="#eceef2" stroke-width="6"/>\n'
        '  <text x="160" y="300" font-family="sans-serif" font-size="24" fill="#eceef2" '
        'text-anchor="middle">onhand</text>\n'
        "</svg>\n"
    )

    # --- sips-written formats (Apple's real encoders) ------------------------
    src = OUT / "photo.png"
    made = {
        "photo.heic": sips(src, OUT / "photo.heic", "heic"),
        "photo.avif": sips(src, OUT / "photo.avif", "avif"),
        "photo.tiff": sips(src, OUT / "photo.tiff", "tiff"),
        "photo.bmp": sips(src, OUT / "photo.bmp", "bmp"),
        "icon.ico": sips(OUT / "graphic-alpha.png", OUT / "icon.ico", "ico", ["-z", "64", "64"]),
        "photo-small.heic": sips(
            OUT / "graphic-alpha.png", OUT / "graphic-alpha.heic", "heic"
        ),
    }

    print("\nCorpus:")
    total = 0
    for f in sorted(OUT.iterdir()):
        if f.name in ("generate.py", "README.md") or f.is_dir():
            continue
        size = f.stat().st_size
        total += size
        print(f"  {f.name:24} {size:>9,} B")
    print(f"  {'TOTAL':24} {total:>9,} B")

    missing = [k for k, v in made.items() if not v]
    if missing:
        print(f"\n! sips could not produce: {', '.join(missing)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

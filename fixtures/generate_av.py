#!/usr/bin/env python3
"""Generate the audio/video corpus.

Separate from generate.py because this one needs ffmpeg, and the image corpus
deliberately does not — it uses sips so that Apple's own HEIC encoder produces
the HEIC fixtures, which is the only way to get files shaped like the ones
coming off a real iPhone.

    brew install ffmpeg
    python3 fixtures/generate_av.py

Everything here is synthetic (test patterns and tones), so the corpus carries no
licence questions and can live in the repo. Files are kept deliberately small —
a few seconds each — because the point is to exercise every container/codec
path, not to benchmark throughput. The one large fixture is generated on demand
by the perf test rather than committed.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

OUT = Path(__file__).parent
FF = shutil.which("ffmpeg")


def ff(args: list[str], name: str) -> bool:
    """Run ffmpeg, overwriting, and report honestly if it failed.

    Checks the output is non-empty, not just that ffmpeg exited 0 — and deletes
    it if it isn't. ffmpeg can fail after creating the file, and a leftover
    0-byte fixture is worse than a missing one: the corpus test that looks for
    presence passes, and the conversion test then blames the codec.
    """
    dest = OUT / name
    proc = subprocess.run(
        [FF, "-y", "-hide_banner", "-loglevel", "error", *args, str(dest)],
        capture_output=True,
        text=True,
    )
    size = dest.stat().st_size if dest.exists() else 0
    if proc.returncode != 0 or size == 0:
        detail = (proc.stderr.strip().splitlines() or ["failed"])[-1]
        print(f"  ! {name}: {detail}", file=sys.stderr)
        dest.unlink(missing_ok=True)
        return False
    print(f"  ✓ {name:28} {size:>9,} B")
    return True


# A 2s 640x360 test pattern plus a 440 Hz tone. Two distinct inputs so that a
# muxer that drops one track is caught — a "converted" video with silent audio
# is the classic silent failure in this space.
VIDEO_IN = ["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=2"]
AUDIO_IN = ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=2"]
AV_IN = [*VIDEO_IN, *AUDIO_IN, "-shortest"]


def main() -> int:
    if not FF:
        print("ffmpeg not found — brew install ffmpeg", file=sys.stderr)
        return 1

    results: dict[str, bool] = {}

    print("Audio:")
    # Every audio fixture is the same 2s tone in a different container/codec, so
    # any decode difference is the container's fault and nothing else's.
    results["tone.wav"] = ff([*AUDIO_IN, "-c:a", "pcm_s16le"], "tone.wav")
    results["tone.mp3"] = ff([*AUDIO_IN, "-c:a", "libmp3lame", "-b:a", "192k"], "tone.mp3")
    results["tone.m4a"] = ff([*AUDIO_IN, "-c:a", "aac", "-b:a", "192k"], "tone.m4a")
    results["tone.aac"] = ff([*AUDIO_IN, "-c:a", "aac", "-b:a", "192k", "-f", "adts"], "tone.aac")
    # Homebrew's ffmpeg ships without libvorbis, so use ffmpeg's own encoder.
    # It is marked experimental (hence -strict) and encodes stereo only (hence
    # -ac 2) — without that it exits 255 having already created a 0-byte file.
    # The bitstream it writes is ordinary Vorbis and decodes anywhere.
    results["tone.ogg"] = ff(
        [*AUDIO_IN, "-ac", "2", "-c:a", "vorbis", "-strict", "experimental", "-b:a", "192k"],
        "tone.ogg",
    )
    results["tone.opus"] = ff([*AUDIO_IN, "-c:a", "libopus", "-b:a", "128k"], "tone.opus")
    results["tone.flac"] = ff([*AUDIO_IN, "-c:a", "flac"], "tone.flac")
    # Stereo with different content per channel — catches a downmix that silently
    # collapses to mono, which sounds "fine" until someone notices it isn't.
    results["stereo.wav"] = ff(
        [
            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=2",
            "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=44100:duration=2",
            "-filter_complex", "[0:a][1:a]amerge=inputs=2[a]",
            "-map", "[a]", "-c:a", "pcm_s16le",
        ],
        "stereo.wav",
    )

    print("\nVideo:")
    # H.264 in MP4 and MOV: the two most common things anyone drops on a converter.
    results["clip.mp4"] = ff(
        [*AV_IN, "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-b:v", "300k",
         "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"],
        "clip.mp4",
    )
    results["clip.mov"] = ff(
        [*AV_IN, "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-b:v", "300k",
         "-c:a", "aac", "-b:a", "128k"],
        "clip.mov",
    )
    results["clip.webm"] = ff(
        [*AV_IN, "-c:v", "libvpx-vp9", "-b:v", "250k", "-deadline", "realtime",
         "-c:a", "libopus", "-b:a", "128k"],
        "clip.webm",
    )
    results["clip.mkv"] = ff(
        [*AV_IN, "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-b:v", "300k",
         "-c:a", "aac", "-b:a", "128k"],
        "clip.mkv",
    )
    # AVI with MPEG-4 Part 2 — an old-format escape route, and the codec is one
    # WebCodecs has never heard of, so this fixture must route to ffmpeg.
    results["clip.avi"] = ff(
        [*AV_IN, "-c:v", "mpeg4", "-vtag", "xvid", "-b:v", "300k", "-c:a", "libmp3lame", "-b:a", "128k"],
        "clip.avi",
    )
    # Video with no audio track at all — a muxer that assumes one track of each
    # kind throws here rather than on a user's file.
    results["silent.mp4"] = ff(
        [*VIDEO_IN, "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-b:v", "300k"],
        "silent.mp4",
    )
    # Portrait, odd dimensions. Encoders that assume even sizes fail on this, and
    # 1079 is exactly the kind of number a phone crop produces.
    results["portrait-odd.mp4"] = ff(
        ["-f", "lavfi", "-i", "testsrc2=size=607x1079:rate=24:duration=2",
         "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-b:v", "300k"],
        "portrait-odd.mp4",
    )
    # Rotation metadata: the MOV/MP4 display matrix says 90°, so a correct
    # conversion comes out 360x640 while a naive one comes out 640x360 sideways.
    #
    # This has to be written with -display_rotation on the INPUT and a stream
    # copy. The obvious `-metadata:s:v:0 rotate=90` is deprecated and modern
    # ffmpeg ignores it silently — it exits 0 and writes a file with no display
    # matrix at all, so the fixture looks fine and tests nothing. Verified with
    # ffprobe -show_entries stream_side_data=rotation, which is the only way to
    # tell the difference.
    results["rotated.mov"] = ff(
        ["-display_rotation", "90", "-i", str(OUT / "clip.mov"), "-c", "copy"],
        "rotated.mov",
    )

    # Verify the property the fixture exists to test, not just that a file
    # appeared. The rotation fixture silently lost its display matrix once
    # already; a fixture that no longer tests what it claims is worse than a
    # missing one, because the suite stays green.
    probe = subprocess.run(
        [shutil.which("ffprobe") or "ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream_side_data=rotation", "-of", "default=nw=1",
         str(OUT / "rotated.mov")],
        capture_output=True, text=True,
    )
    if "rotation" not in probe.stdout:
        print("  ! rotated.mov carries no display matrix — it tests nothing", file=sys.stderr)
        results["rotated.mov"] = False

    print("\nCorpus:")
    total = sum(
        (OUT / n).stat().st_size for n, ok in results.items() if ok
    )
    print(f"  {len(results)} files, {total:,} B total")

    failed = [k for k, v in results.items() if not v]
    if failed:
        print(f"\n! could not produce: {', '.join(failed)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

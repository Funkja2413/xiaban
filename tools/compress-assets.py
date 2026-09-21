#!/usr/bin/env python3
"""Shrink public raster assets in place. Same filenames, no catalog edits."""
from __future__ import annotations

from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / "public"
SKIP_SUFFIX = {".webp"}  # already small
FACE_MAX = 1536
FLOOR_MAX = 1024
JPEG_Q = 90
MIN_SAVE = 0.06  # need at least 6% to overwrite


def has_useful_alpha(im: Image.Image) -> bool:
    if im.mode not in ("RGBA", "LA") and "transparency" not in im.info:
        return False
    if im.mode != "RGBA":
        im = im.convert("RGBA")
    extrema = im.getchannel("A").getextrema()
    return extrema[0] < 255


def resize_max(im: Image.Image, cap: int) -> Image.Image:
    w, h = im.size
    m = max(w, h)
    if m <= cap:
        return im
    scale = cap / m
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    return im.resize((nw, nh), Image.Resampling.LANCZOS)


def png_bytes(im: Image.Image) -> bytes:
    buf = BytesIO()
    im.save(buf, format="PNG", optimize=True, compress_level=9)
    return buf.getvalue()


def jpeg_bytes(im: Image.Image) -> bytes:
    if im.mode != "RGB":
        im = im.convert("RGB")
    buf = BytesIO()
    im.save(buf, format="JPEG", quality=JPEG_Q, optimize=True, progressive=True)
    return buf.getvalue()


def process(path: Path) -> tuple[int, int, str]:
    raw = path.read_bytes()
    before = len(raw)
    im = Image.open(path)
    im.load()
    rel = str(path.relative_to(ROOT))
    suffix = path.suffix.lower()

    useful_a = has_useful_alpha(im)
    if not useful_a and im.mode in ("RGBA", "LA"):
        im = im.convert("RGB")

    note = []
    if "levels/textures" in rel and "-face-" in path.name:
        nxt = resize_max(im, FACE_MAX)
        if nxt.size != im.size:
            note.append(f"resize {im.size}->{nxt.size}")
            im = nxt
    if "levels/textures" in rel and "-floor." in path.name:
        nxt = resize_max(im, FLOOR_MAX)
        if nxt.size != im.size:
            note.append(f"resize {im.size}->{nxt.size}")
            im = nxt

    candidates: list[bytes] = []
    if suffix in {".jpg", ".jpeg"}:
        candidates.append(jpeg_bytes(im))
    else:
        if useful_a and im.mode != "RGBA":
            im = im.convert("RGBA")
        elif not useful_a and im.mode not in ("RGB", "P"):
            im = im.convert("RGB")
        candidates.append(png_bytes(im))
        # 大图照片型 RGB：JPEG 更小，仍写成原后缀。浏览器按文件头解码，不改 catalog。
        if (
            not useful_a
            and ("levels/textures" in rel or rel.startswith("ui/result-"))
            and max(im.size) >= 512
        ):
            candidates.append(jpeg_bytes(im))

    best = min(candidates, key=len) if candidates else raw
    if before - len(best) < before * MIN_SAVE and not note:
        return before, before, "skip"
    if len(best) >= before and not note:
        return before, before, "skip"
    path.write_bytes(best)
    kind = "jpg-bytes" if best[:2] == b"\xff\xd8" else "png"
    return before, len(best), f"{kind} {' '.join(note)}".strip()


def main() -> None:
    files = sorted(
        p
        for p in ROOT.rglob("*")
        if p.suffix.lower() in {".png", ".jpg", ".jpeg"} and not p.name.startswith(".")
    )
    total_b = total_a = 0
    changed = 0
    for p in files:
        try:
            b, a, why = process(p)
        except Exception as e:
            print(f"FAIL {p.relative_to(ROOT)} {e}")
            continue
        total_b += b
        total_a += a
        if b != a:
            changed += 1
            print(f"{b/1024:8.1f} -> {a/1024:7.1f} KB  {why:20} {p.relative_to(ROOT)}")
    print(f"\n{changed} files  {total_b/1024/1024:.1f}MB -> {total_a/1024/1024:.1f}MB")


if __name__ == "__main__":
    main()

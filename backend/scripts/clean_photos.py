"""Fill the black side bars on product photos with white.

Many catalogue photos are a white picture with solid black bars down the left and right
sides. Inside the site's white product cards those bars look like a broken image. This
script finds those photos and writes a copy with the bars filled white to
data/products_clean/. The originals in data/products/ are never changed. main.py serves the
cleaned copy when there is one, so image URLs and the database stay the same.

A photo counts as "black bars around a white center" when the columns at its left and
right edges are black from top to bottom and the columns just inside them are white.
Photos on a black background all the way around (yale-dad-t-shirt.jpg) or on plain white
are left alone.

Run from the backend/ folder after adding or replacing product photos (needs Pillow):

    python scripts/clean_photos.py            # write the cleaned copies
    python scripts/clean_photos.py --dry-run  # only list the photos that would be cleaned
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageChops

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools import PRODUCT_IMAGES_CLEAN_DIR, PRODUCT_IMAGES_DIR  # noqa: E402

BLACK = 40  # a pixel is black if no channel is above this (0-255)
WHITE = 225  # a pixel is white if every channel is at least this
FULL = 0.98  # share of a column's pixels that must be black (bar) or white (center)
MIN_BAR = 0.02  # each bar must be at least 2% of the photo's width


def column_shares(photo: Image.Image, keep) -> list[float]:
    """For each column, the share of its pixels (0-1) whose value passes `keep`."""
    mask = photo.point(lambda v: 255 if keep(v) else 0)
    # Squashing the mask to one row averages each column (one byte per column).
    row = mask.resize((mask.width, 1), Image.Resampling.BOX)
    return [v / 255 for v in row.tobytes()]


def side_bars(photo: Image.Image) -> tuple[int, int] | None:
    """Widths of the black bars on the photo's left and right, or None if it has none."""
    r, g, b = photo.convert("RGB").split()
    black = column_shares(ImageChops.lighter(ImageChops.lighter(r, g), b), lambda v: v <= BLACK)
    white = column_shares(ImageChops.darker(ImageChops.darker(r, g), b), lambda v: v >= WHITE)

    def bar_width(columns: list[float]) -> int:
        width = 0
        while width < len(columns) and columns[width] >= FULL:
            width += 1
        return width

    left = bar_width(black)
    right = bar_width(black[::-1])
    width = photo.width
    if min(left, right) < MIN_BAR * width or left + right >= width:
        return None  # no bar on one side (white photo), or black all the way across
    if white[left] < FULL or white[width - 1 - right] < FULL:
        return None  # the middle isn't white next to the bars: a black-background photo
    return left, right


def main() -> int:
    dry_run = "--dry-run" in sys.argv[1:]
    photos = sorted(p for p in PRODUCT_IMAGES_DIR.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"})
    if not dry_run:
        PRODUCT_IMAGES_CLEAN_DIR.mkdir(exist_ok=True)

    cleaned = set()
    for path in photos:
        with Image.open(path) as photo:
            bars = side_bars(photo)
            if bars is None:
                continue
            left, right = bars
            print(f"  {path.name}: bars {left}px left, {right}px right")
            cleaned.add(path.name)
            if dry_run:
                continue
            photo.paste("white", (0, 0, left, photo.height))
            photo.paste("white", (photo.width - right, 0, photo.width, photo.height))
            # "keep" reuses the original JPEG settings, so the photo isn't compressed again.
            options = {"quality": "keep"} if photo.format == "JPEG" else {}
            photo.save(PRODUCT_IMAGES_CLEAN_DIR / path.name, **options)

    # A cleaned copy whose original no longer has bars (or is gone) would hide the original.
    if not dry_run:
        for old in PRODUCT_IMAGES_CLEAN_DIR.iterdir():
            if old.name not in cleaned:
                old.unlink()
                print(f"  removed old copy {old.name}")

    where = "would be cleaned" if dry_run else f"cleaned into {PRODUCT_IMAGES_CLEAN_DIR}"
    print(f"{len(cleaned)} of {len(photos)} photos {where}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

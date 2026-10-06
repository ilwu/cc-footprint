"""Draws the tray icon: a bare footprint in the tool's orange.

monitor/icon.ico is for Windows, in five sizes; monitor/icon.png is for the
macOS menu bar, 44 px for a 22-point icon at 2x.

    python scripts/make-icon.py            writes monitor/icon.ico
    python scripts/make-icon.py preview    also writes icon-preview.png beside it

Needs Pillow. The two smallest Windows sizes are drawn from a bolder shape
with four toes: five do not survive 16 pixels.
"""
import os
import sys

from PIL import Image, ImageDraw

ORANGE = (217, 119, 87, 255)
S = 512  # drawing canvas; shapes are given on a 64-unit grid
MONITOR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "monitor")
OUT = os.path.join(MONITOR, "icon.ico")
PNG = os.path.join(MONITOR, "icon.png")


def u(v):
    return v * S / 64


def footprint(toes, sole):
    """The sole (two circles and what joins them) and one circle per toe."""
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    (bx0, by0, bx1, by1), (hx0, hy0, hx1, hy1), joint = sole
    d.ellipse((u(bx0), u(by0), u(bx1), u(by1)), fill=ORANGE)   # ball of the foot
    d.ellipse((u(hx0), u(hy0), u(hx1), u(hy1)), fill=ORANGE)   # heel
    d.polygon([(u(x), u(y)) for x, y in joint], fill=ORANGE)
    for cx, cy, r in toes:
        d.ellipse((u(cx - r), u(cy - r), u(cx + r), u(cy + r)), fill=ORANGE)
    return im


def large():
    return footprint(
        toes=((13, 13, 6.5), (25, 7, 5.2), (36, 6, 4.6), (46, 9, 4.0), (54, 15, 3.4)),
        sole=((14, 20, 46, 46), (22, 40, 44, 62), [(16, 36), (45, 34), (44, 52), (22, 50)]),
    )


def small():
    return footprint(
        toes=((12, 12, 7.5), (27, 6, 6.0), (41, 7, 5.5), (53, 14, 5.0)),
        sole=((12, 23, 48, 47), (20, 40, 46, 64), [(14, 38), (47, 36), (46, 54), (20, 52)]),
    )


def at(size):
    return (small() if size <= 20 else large()).resize((size, size), Image.LANCZOS)


def main():
    sizes = (16, 20, 24, 32, 48)
    icons = [at(size) for size in sizes]
    icons[-1].save(OUT, format="ICO", sizes=[(s, s) for s in sizes], append_images=icons[:-1])
    print("wrote", os.path.normpath(OUT))
    at(44).save(PNG, format="PNG")
    print("wrote", os.path.normpath(PNG))

    if sys.argv[1:] == ["preview"]:
        # Each size as it is, then the two smallest enlarged, on a dark and a light taskbar
        sheet = Image.new("RGB", (700, 320), (255, 255, 255))
        for row, bg in enumerate(((32, 32, 32), (243, 243, 243))):
            y = row * 160
            ImageDraw.Draw(sheet).rectangle((0, y, 700, y + 160), fill=bg)
            x = 20
            for icon in icons:
                sheet.paste(icon, (x, y + 80 - icon.height // 2), icon)
                x += icon.width + 24
            for size in (16, 24):
                big = at(size).resize((128, 128), Image.NEAREST)
                sheet.paste(big, (300 + (0 if size == 16 else 190), y + 16), big)
        path = os.path.join(os.path.dirname(OUT), "icon-preview.png")
        sheet.save(path)
        print("wrote", os.path.normpath(path))


if __name__ == "__main__":
    main()

"""Contact sheets: assets scaled up with nearest-neighbour and labelled.

Usage: python sheet.py [assets_dir] [out_dir]
Writes contact sheets into out_dir (default tools/art/out):
  sheet_small.png   icons, caravan, portraits, logo at 6x (the "6x contact sheet")
  sheet_scenes.png  city banners at 2x
  sheet_map.png     world map at 1x (it is already 960x540)
  sheet_1x.png      every small asset at true 1x size, for readability checks
"""
import os
import sys

from PIL import Image

from font5x7 import GLYPH_H, draw_text, text_width
from grid import Canvas
from palette import PALETTE

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ASSETS = os.path.normpath(os.path.join(HERE, "..", "..", "apps", "web", "public", "assets"))
DEFAULT_OUT = os.path.join(HERE, "out")

BG = "night"
LABEL = "cloth"
PAD = 10


def scaled(img, scale):
    return img.resize((img.width * scale, img.height * scale), Image.NEAREST)


def _checker(w, h, cell=8):
    c = Canvas(w, h, "stone")
    for y in range(0, h, cell):
        for x in range(0, w, cell):
            if (x // cell + y // cell) % 2 == 0:
                c.rect(x, y, cell, cell, "dune")
    return c


def make_sheet(items, max_width=1600, label_scale=2):
    """items: list of (label, Image, scale). Returns an RGBA image on a night background.

    Each tile is drawn on a checkerboard so transparency is visible.
    """
    tiles = []
    for label, img, scale in items:
        big = scaled(img, scale) if scale != 1 else img
        tag = f"{label} {img.width}X{img.height} {scale}X"
        lw = text_width(tag, label_scale)
        tiles.append((tag, big, max(big.width, lw)))
    rows, cur, cur_w = [], [], PAD
    for t in tiles:
        if cur and cur_w + t[2] + PAD > max_width:
            rows.append(cur)
            cur, cur_w = [], PAD
        cur.append(t)
        cur_w += t[2] + PAD
    if cur:
        rows.append(cur)
    lh = GLYPH_H * label_scale + 6
    height = PAD
    for r in rows:
        height += lh + max(t[1].height for t in r) + PAD
    width = max(sum(t[2] + PAD for t in r) + PAD for r in rows)
    sheet = Canvas(width, height, BG)
    y = PAD
    for r in rows:
        x = PAD
        th = max(t[1].height for t in r)
        for tag, big, w in r:
            draw_text(sheet, x, y, tag, LABEL, label_scale)
            checker = _checker(big.width, big.height)
            checker.im.alpha_composite(big)
            sheet.im.paste(checker.im, (x, y + lh))
            x += w + PAD
        y += lh + th + PAD
    return sheet.im


def load_assets(assets_dir):
    """Return {rel_path_without_ext: Image} for every PNG under assets_dir."""
    out = {}
    for root, _, files in os.walk(assets_dir):
        for f in sorted(files):
            if f.endswith(".png"):
                p = os.path.join(root, f)
                rel = os.path.relpath(p, assets_dir).replace(os.sep, "/")[:-4]
                out[rel] = Image.open(p).convert("RGBA")
    return out


def build_sheets(assets_dir=DEFAULT_ASSETS, out_dir=DEFAULT_OUT):
    os.makedirs(out_dir, exist_ok=True)
    a = load_assets(assets_dir)
    small = [k for k in sorted(a) if k.startswith(("goods/", "ui/coin", "ui/guard"))]
    small += [k for k in sorted(a) if k.startswith("merchants/")]
    small += ["ui/caravan", "ui/logo"]
    items6 = []
    for k in small:
        sc = 6 if a[k].width <= 96 else 3
        items6.append((k, a[k], sc))
    paths = {}
    paths["small"] = os.path.join(out_dir, "sheet_small.png")
    make_sheet(items6, max_width=1700).save(paths["small"])
    scenes = [(k, a[k], 2) for k in sorted(a) if k.startswith("cities/")]
    paths["scenes"] = os.path.join(out_dir, "sheet_scenes.png")
    make_sheet(scenes, max_width=1400).save(paths["scenes"])
    paths["map"] = os.path.join(out_dir, "sheet_map.png")
    make_sheet([("map/world", a["map/world"], 1)], max_width=1400).save(paths["map"])
    items1 = [(k, a[k], 1) for k in small] + [(k, a[k], 1) for k in sorted(a) if k.startswith("cities/")]
    # also portraits at 48 px (the "recognizable at 48" check)
    for k in sorted(a):
        if k.startswith("merchants/"):
            items1.append((k + " HALF", a[k].resize((48, 48), Image.NEAREST), 1))
    paths["1x"] = os.path.join(out_dir, "sheet_1x.png")
    make_sheet(items1, max_width=1400).save(paths["1x"])
    return paths


if __name__ == "__main__":
    assets = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_ASSETS
    out = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_OUT
    for name, path in build_sheets(assets, out).items():
        print(name, path)

"""Tests for the art pipeline. Run from tools/art:  python -m unittest discover -s tests -v
(also works with pytest). No network; Pillow only."""
import os
import re
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.dirname(HERE)
sys.path.insert(0, ART)
sys.path.insert(0, os.path.join(ART, "assets_src"))

from PIL import Image  # noqa: E402

import build  # noqa: E402
import font5x7  # noqa: E402
import grid  # noqa: E402
import quantize  # noqa: E402
import sheet  # noqa: E402
from palette import ALLOWED_RGBA, PALETTE, PALETTE_HEX, TRANSPARENT  # noqa: E402

REPO = os.path.normpath(os.path.join(ART, "..", ".."))

# Spec 2.15, in order.
SPEC_PALETTE = {
    "sand": "#E8D5A3", "dune": "#C99A52", "terracotta": "#A8503A", "night": "#1B1F2B",
    "ink": "#0F1118", "oasis": "#2F8F83", "sky": "#6FB1D6", "gold": "#E0A526",
    "leaf": "#5A8F3C", "blood": "#9C2F2F", "cloth": "#F2EAD3", "stone": "#7A7468",
}

_GENERATED = None


def generated():
    global _GENERATED
    if _GENERATED is None:
        _GENERATED = build.generate()
    return _GENERATED


class PaletteTests(unittest.TestCase):
    def test_palette_matches_spec(self):
        self.assertEqual(PALETTE_HEX, SPEC_PALETTE)
        self.assertEqual(len(PALETTE), 12)
        self.assertEqual(len(set(PALETTE.values())), 12)

    def test_allowed_is_palette_plus_transparent(self):
        self.assertEqual(len(ALLOWED_RGBA), 13)
        self.assertIn(TRANSPARENT, ALLOWED_RGBA)


class GridTests(unittest.TestCase):
    def test_render_exact_size_and_colours(self):
        im = grid.render(["S.K", "GBN"], size=(3, 2))
        self.assertEqual(im.size, (3, 2))
        self.assertEqual(im.getpixel((0, 0)), PALETTE["sand"])
        self.assertEqual(im.getpixel((1, 0)), TRANSPARENT)
        self.assertEqual(im.getpixel((2, 1)), PALETTE["night"])

    def test_render_rejects_bad_input(self):
        with self.assertRaises(ValueError):
            grid.render(["SS", "S"])
        with self.assertRaises(ValueError):
            grid.render(["SS"], size=(3, 1))
        with self.assertRaises(ValueError):
            grid.render(["?"])

    def test_canvas_drawing_stays_in_palette(self):
        c = grid.Canvas(40, 40)
        c.ellipse(20, 20, 15, 10, "gold")
        c.line(0, 0, 39, 39, "blood", r=1.5)
        c.poly([(3, 3), (30, 8), (12, 35)], "oasis")
        c.dither(0, 0, 40, 40, "sand", "dune", 8)
        c.outline("ink")
        self.assertFalse(quantize.off_palette_pixels(c.image()))

    def test_canvas_rejects_off_palette_tuple(self):
        c = grid.Canvas(2, 2)
        with self.assertRaises(KeyError):
            c.put(0, 0, (1, 2, 3, 255))


class QuantizeTests(unittest.TestCase):
    def test_nearest_color_and_resize(self):
        src = Image.new("RGBA", (2, 2), (230, 210, 160, 255))  # near sand
        out = quantize.quantize(src, size=(8, 8))
        self.assertEqual(out.size, (8, 8))
        self.assertEqual({c for _, c in out.getcolors()}, {PALETTE["sand"]})

    def test_partial_alpha_becomes_binary(self):
        src = Image.new("RGBA", (2, 1))
        src.putpixel((0, 0), (10, 10, 10, 60))
        src.putpixel((1, 0), (10, 10, 10, 200))
        out = quantize.quantize(src)
        self.assertEqual(out.getpixel((0, 0)), TRANSPARENT)
        self.assertEqual(out.getpixel((1, 0)), PALETTE["ink"])

    def test_arbitrary_image_ends_up_in_palette(self):
        src = Image.effect_noise((17, 13), 90).convert("RGBA")
        self.assertFalse(quantize.off_palette_pixels(quantize.quantize(src)))


class FontTests(unittest.TestCase):
    def test_every_glyph_is_5x7(self):
        for ch, rows in font5x7.GLYPHS.items():
            self.assertEqual(len(rows), 7, ch)
            for r in rows:
                self.assertEqual(len(r), 5, ch)
        for ch in "CARAVNROD":
            self.assertIn(ch, font5x7.GLYPHS)

    def test_text_width(self):
        self.assertEqual(font5x7.text_width("AB", 1, 1), 11)
        self.assertEqual(font5x7.text_width("AB", 3, 2), 2 * 15 + 6)


class AssetTests(unittest.TestCase):
    def test_all_slots_generated(self):
        self.assertEqual(set(generated()), set(build.SLOTS))

    def test_exact_sizes(self):
        for rel, img in generated().items():
            self.assertEqual(img.size, build.SLOTS[rel], rel)

    def test_slots_match_master_plan_table(self):
        expect = {"map/world.png": (960, 540), "ui/caravan.png": (96, 32), "ui/coin.png": (16, 16),
                  "ui/guard.png": (16, 16), "ui/logo.png": (256, 64)}
        for c in ("dasht", "madan", "bandar", "shahr"):
            expect[f"cities/{c}.png"] = (320, 180)
        for m in ("golnar", "rostam", "nahid", "sohrab"):
            expect[f"merchants/{m}.png"] = (96, 96)
        for g in ("grain", "salt", "iron", "spice", "silk"):
            expect[f"goods/{g}.png"] = (32, 32)
        self.assertEqual(build.SLOTS, expect)

    def test_every_pixel_in_palette(self):
        for rel, img in generated().items():
            self.assertEqual(img.mode, "RGBA", rel)
            self.assertFalse(quantize.off_palette_pixels(img), rel)

    def test_scenes_and_map_and_portraits_are_opaque(self):
        for rel, img in generated().items():
            if rel.startswith(("cities/", "map/", "merchants/")):
                self.assertEqual(img.getchannel("A").getextrema(), (255, 255), rel)

    def test_icons_have_transparent_background_and_content(self):
        for rel, img in generated().items():
            if rel.startswith(("goods/", "ui/coin", "ui/guard", "ui/caravan", "ui/logo")):
                lo, hi = img.getchannel("A").getextrema()
                self.assertEqual((lo, hi), (0, 255), rel)
                self.assertEqual(img.getpixel((0, 0))[3], 0, rel)

    def test_caravan_frames_differ(self):
        im = generated()["ui/caravan.png"]
        f1, f2 = im.crop((0, 0, 48, 32)), im.crop((48, 0, 96, 32))
        self.assertNotEqual(f1.tobytes(), f2.tobytes())
        self.assertTrue(f1.getchannel("A").getbbox() and f2.getchannel("A").getbbox())

    def test_portraits_are_distinct(self):
        data = {k: v.tobytes() for k, v in generated().items() if k.startswith("merchants/")}
        self.assertEqual(len(set(data.values())), 4)

    def test_goods_icons_are_distinct(self):
        data = {k: v.tobytes() for k, v in generated().items() if k.startswith("goods/")}
        self.assertEqual(len(set(data.values())), 5)

    def test_deterministic(self):
        again = build.generate()
        for rel, img in generated().items():
            self.assertEqual(img.tobytes(), again[rel].tobytes(), rel)

    def test_committed_files_match_generator(self):
        out = build.DEFAULT_OUT
        if not os.path.isdir(out):
            self.skipTest("assets not built yet")
        for rel, img in generated().items():
            path = os.path.join(out, *rel.split("/"))
            self.assertTrue(os.path.exists(path), rel)
            disk = Image.open(path).convert("RGBA")
            self.assertEqual(disk.size, img.size, rel)
            self.assertEqual(disk.tobytes(), img.tobytes(), f"{rel} is stale: run python tools/art/build.py")

    def test_map_city_positions_match_ui_config(self):
        import worldmap

        cfg = os.path.join(REPO, "apps", "web", "src", "ui", "map-config.ts")
        if not os.path.exists(cfg):
            self.skipTest("map-config.ts not present")
        with open(cfg, encoding="utf8") as fh:
            text = fh.read()
        for city, (x, y) in worldmap.CITY_PCT.items():
            m = re.search(rf"{city}:\s*\{{\s*x:\s*([\d.]+),\s*y:\s*([\d.]+)\s*\}}", text)
            self.assertIsNotNone(m, city)
            self.assertEqual((float(m.group(1)), float(m.group(2))), (x, y), city)


class SheetTests(unittest.TestCase):
    def test_make_sheet_scales_and_stays_in_bounds(self):
        im = Image.new("RGBA", (16, 16), PALETTE["gold"])
        out = sheet.make_sheet([("coin", im, 6)], max_width=400)
        self.assertGreaterEqual(out.width, 16 * 6)
        self.assertEqual(out.mode, "RGBA")
        self.assertFalse(quantize.off_palette_pixels(out))

    def test_build_sheets_writes_files(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            assets = os.path.join(tmp, "assets")
            build.build(assets)
            paths = sheet.build_sheets(assets, os.path.join(tmp, "out"))
            for p in paths.values():
                self.assertTrue(os.path.getsize(p) > 0)


if __name__ == "__main__":
    unittest.main()

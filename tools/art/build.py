"""Generate every Caravan Road art asset into apps/web/public/assets.

Usage: python build.py [out_dir]      (default: <repo>/apps/web/public/assets)
Pure Python 3 + Pillow; no network, no external assets; deterministic output.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "assets_src"))

from quantize import off_palette_pixels, quantize  # noqa: E402

DEFAULT_OUT = os.path.normpath(os.path.join(HERE, "..", "..", "apps", "web", "public", "assets"))

# path (relative to the assets dir) -> exact (width, height) from master plan 7.3
SLOTS = {
    "map/world.png": (960, 540),
    "cities/dasht.png": (320, 180),
    "cities/madan.png": (320, 180),
    "cities/bandar.png": (320, 180),
    "cities/shahr.png": (320, 180),
    "merchants/golnar.png": (96, 96),
    "merchants/rostam.png": (96, 96),
    "merchants/nahid.png": (96, 96),
    "merchants/sohrab.png": (96, 96),
    "goods/grain.png": (32, 32),
    "goods/salt.png": (32, 32),
    "goods/iron.png": (32, 32),
    "goods/spice.png": (32, 32),
    "goods/silk.png": (32, 32),
    "ui/caravan.png": (96, 32),
    "ui/coin.png": (16, 16),
    "ui/guard.png": (16, 16),
    "ui/logo.png": (256, 64),
}


def generate():
    """Return {slot_path: PIL.Image} for every asset (already snapped to the palette)."""
    import caravan
    import icons
    import logo
    import portraits
    import scenes
    import worldmap

    out = {"map/world.png": worldmap.world_map()}
    for name, fn in scenes.CITIES.items():
        out[f"cities/{name}.png"] = fn()
    for name, fn in portraits.PORTRAITS.items():
        out[f"merchants/{name}.png"] = fn()
    for name, fn in icons.GOODS.items():
        out[f"goods/{name}.png"] = fn()
    out["ui/caravan.png"] = caravan.caravan()
    for name, fn in icons.UI_ICONS.items():
        out[f"ui/{name}.png"] = fn()
    out["ui/logo.png"] = logo.logo()
    # final safety net: snap to the palette and enforce the exact slot size
    return {k: quantize(v, SLOTS[k]) for k, v in out.items()}


def build(out_dir=DEFAULT_OUT):
    images = generate()
    for rel, img in images.items():
        assert img.size == SLOTS[rel], (rel, img.size)
        assert not off_palette_pixels(img), rel
        path = os.path.join(out_dir, *rel.split("/"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        img.save(path, optimize=True)
    return sorted(images)


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    for rel in build(out):
        print("wrote", rel)

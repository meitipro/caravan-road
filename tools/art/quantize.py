"""Map any image onto the palette: nearest-neighbour resize, then nearest colour."""
from PIL import Image

from palette import ALLOWED_RGBA, PALETTE, TRANSPARENT

_COLORS = list(PALETTE.values())


def nearest_color(r, g, b):
    best, best_d = None, None
    for c in _COLORS:
        d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2
        if best_d is None or d < best_d:
            best, best_d = c, d
    return best


def quantize(img, size=None, alpha_cutoff=128):
    """Return an RGBA image whose pixels are all palette colours or transparent.

    If `size` is given, the image is first resized with nearest-neighbour.
    Alpha below `alpha_cutoff` becomes fully transparent (no partial alpha).
    """
    img = img.convert("RGBA")
    if size is not None and img.size != tuple(size):
        img = img.resize(tuple(size), Image.NEAREST)
    out = Image.new("RGBA", img.size, TRANSPARENT)
    src, dst = img.load(), out.load()
    cache = {}
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = src[x, y]
            if a < alpha_cutoff:
                continue
            key = (r, g, b)
            if key not in cache:
                cache[key] = nearest_color(r, g, b)
            dst[x, y] = cache[key]
    return out


def off_palette_pixels(img):
    """Return the set of RGBA values in `img` that are not allowed."""
    img = img.convert("RGBA")
    return {c for _, c in img.getcolors(img.width * img.height) if c not in ALLOWED_RGBA}

"""Sprite rendering helpers: character grids and a palette-strict Canvas.

No antialiasing anywhere: every pixel is a palette colour or transparent.
"""
import math

from PIL import Image

from palette import CHARS, TRANSPARENT, rgba


def render(rows, size=None):
    """Render a list of equal-length strings (one char per pixel) to an RGBA image.

    `size` is an optional (w, h) that the grid must match exactly.
    """
    h = len(rows)
    w = len(rows[0]) if h else 0
    for i, row in enumerate(rows):
        if len(row) != w:
            raise ValueError(f"row {i} has width {len(row)}, expected {w}")
    if size is not None and (w, h) != tuple(size):
        raise ValueError(f"grid is {w}x{h}, expected {size[0]}x{size[1]}")
    im = Image.new("RGBA", (w, h), TRANSPARENT)
    px = im.load()
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch not in CHARS:
                raise ValueError(f"unknown grid char {ch!r} at {x},{y}")
            px[x, y] = rgba(ch)
    return im


BAYER4 = (
    (0, 8, 2, 10),
    (12, 4, 14, 6),
    (3, 11, 1, 9),
    (15, 7, 13, 5),
)


class Canvas:
    """A fixed-size RGBA canvas; all drawing resolves colours through the palette."""

    def __init__(self, w, h, fill=None):
        self.w, self.h = w, h
        self.im = Image.new("RGBA", (w, h), rgba(fill))
        self.px = self.im.load()

    # -- basics -----------------------------------------------------------
    def put(self, x, y, color):
        x, y = int(x), int(y)
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[x, y] = rgba(color)

    def get(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.px[x, y]
        return TRANSPARENT

    def opaque(self, x, y):
        return self.get(x, y)[3] > 0

    def rect(self, x, y, w, h, color):
        c = rgba(color)
        for yy in range(int(y), int(y + h)):
            for xx in range(int(x), int(x + w)):
                if 0 <= xx < self.w and 0 <= yy < self.h:
                    self.px[xx, yy] = c

    def hline(self, x0, x1, y, color):
        for x in range(int(x0), int(x1) + 1):
            self.put(x, y, color)

    def vline(self, x, y0, y1, color):
        for y in range(int(y0), int(y1) + 1):
            self.put(x, y, color)

    def line(self, x0, y0, x1, y1, color, r=0):
        """Bresenham line; r > 0 stamps a disc of that radius at each step."""
        x0, y0, x1, y1 = int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1))
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx + dy
        while True:
            if r > 0:
                self.ellipse(x0 + 0.5, y0 + 0.5, r, r, color)
            else:
                self.put(x0, y0, color)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def ellipse(self, cx, cy, rx, ry, color, only=None):
        """Filled ellipse tested at pixel centres. `only` optionally clips by fn(x, y)."""
        c = rgba(color)
        for y in range(int(math.floor(cy - ry)), int(math.ceil(cy + ry)) + 1):
            for x in range(int(math.floor(cx - rx)), int(math.ceil(cx + rx)) + 1):
                if not (0 <= x < self.w and 0 <= y < self.h):
                    continue
                dx = (x + 0.5 - cx) / rx
                dy = (y + 0.5 - cy) / ry
                if dx * dx + dy * dy <= 1.0 and (only is None or only(x, y)):
                    self.px[x, y] = c

    def ring(self, cx, cy, rx, ry, color, thick=1.0):
        c = rgba(color)
        irx, iry = max(rx - thick, 0.01), max(ry - thick, 0.01)
        for y in range(int(math.floor(cy - ry)), int(math.ceil(cy + ry)) + 1):
            for x in range(int(math.floor(cx - rx)), int(math.ceil(cx + rx)) + 1):
                if not (0 <= x < self.w and 0 <= y < self.h):
                    continue
                dx, dy = x + 0.5 - cx, y + 0.5 - cy
                if (dx / rx) ** 2 + (dy / ry) ** 2 <= 1.0 and (dx / irx) ** 2 + (dy / iry) ** 2 > 1.0:
                    self.px[x, y] = c

    def poly(self, points, color):
        """Filled polygon (even-odd scanline on pixel centres)."""
        c = rgba(color)
        ys = [p[1] for p in points]
        n = len(points)
        for y in range(int(math.floor(min(ys))), int(math.ceil(max(ys))) + 1):
            if not 0 <= y < self.h:
                continue
            yc = y + 0.5
            xs = []
            for i in range(n):
                (x0, y0), (x1, y1) = points[i], points[(i + 1) % n]
                if (y0 <= yc < y1) or (y1 <= yc < y0):
                    xs.append(x0 + (yc - y0) * (x1 - x0) / (y1 - y0))
            xs.sort()
            for i in range(0, len(xs) - 1, 2):
                for x in range(int(math.ceil(xs[i] - 0.5)), int(math.floor(xs[i + 1] - 0.5)) + 1):
                    if 0 <= x < self.w:
                        self.px[x, y] = c

    def dither(self, x, y, w, h, c1, c2, level):
        """Ordered dither of c2 over c1; level 0..16 (0 = all c1, 16 = all c2)."""
        a, b = rgba(c1), rgba(c2)
        for yy in range(int(y), int(y + h)):
            for xx in range(int(x), int(x + w)):
                if 0 <= xx < self.w and 0 <= yy < self.h:
                    self.px[xx, yy] = b if BAYER4[yy % 4][xx % 4] < level else a

    # -- layers -----------------------------------------------------------
    def outline(self, color="ink", diagonal=False):
        """Add a 1px outline in `color` around all opaque pixels (on transparent pixels)."""
        c = rgba(color)
        marks = []
        box = self.im.getchannel("A").getbbox()
        if box is None:
            return
        for y in range(max(box[1] - 1, 0), min(box[3] + 1, self.h)):
            for x in range(max(box[0] - 1, 0), min(box[2] + 1, self.w)):
                if self.px[x, y][3] > 0:
                    continue
                n = [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
                if diagonal:
                    n += [(x + 1, y + 1), (x - 1, y - 1), (x + 1, y - 1), (x - 1, y + 1)]
                if any(self.opaque(a, b) for a, b in n):
                    marks.append((x, y))
        for x, y in marks:
            self.px[x, y] = c

    def paste(self, other, x=0, y=0):
        """Copy the opaque pixels of another Canvas/Image onto this one."""
        im = other.im if isinstance(other, Canvas) else other
        src = im.load()
        box = im.getchannel("A").getbbox()
        if box is None:
            return
        for yy in range(box[1], box[3]):
            for xx in range(box[0], box[2]):
                p = src[xx, yy]
                if p[3] > 0 and 0 <= x + xx < self.w and 0 <= y + yy < self.h:
                    self.px[x + xx, y + yy] = p

    def sprite(self, rows, x, y):
        self.paste(render(rows), x, y)

    def image(self):
        return self.im

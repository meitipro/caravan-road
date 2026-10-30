"""The 960x540 world map: dunes, sea, mountains, fields, oases and dashed roads.

City positions follow the UI map config (spec 7.4 task 3, src/ui/map-config.ts),
in percent of the map: dasht 28/62, madan 72/30, bandar 20/22, shahr 74/72.
Procedural and seeded: the same input always yields the same pixels.
"""
import math
import random

from grid import BAYER4, Canvas
from palette import rgba

W, H = 960, 540

CITY_PCT = {"dasht": (28, 62), "madan": (72, 30), "bandar": (20, 22), "shahr": (74, 72)}
CITY_PX = {k: (round(W * x / 100), round(H * y / 100)) for k, (x, y) in CITY_PCT.items()}

ROUTES = [
    ("bandar", "shahr"),
    ("shahr", "dasht"),
    ("dasht", "madan"),
    ("madan", "bandar"),
    ("bandar", "dasht"),
    ("shahr", "madan"),
]
# The UI moves caravans along straight lines between city centres
# (pointOnRoute in src/ui/map-config.ts), so the painted roads are straight too.
BEND = {route: 0.0 for route in ROUTES}


class Noise:
    """Seeded value noise on a lattice, bilinear with smoothstep."""

    def __init__(self, seed, size=64):
        rng = random.Random(seed)
        self.size = size
        self.g = [[rng.random() for _ in range(size)] for _ in range(size)]

    def at(self, x, y):
        n = self.size
        xi, yi = math.floor(x), math.floor(y)
        fx, fy = x - xi, y - yi
        fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
        g = self.g
        a = g[yi % n][xi % n]
        b = g[yi % n][(xi + 1) % n]
        c = g[(yi + 1) % n][xi % n]
        d = g[(yi + 1) % n][(xi + 1) % n]
        return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy


def bezier(p0, p1, p2, steps=240):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0]
        y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]
        pts.append((x, y))
    return pts


def road_points(a, b):
    p0, p2 = CITY_PX[a], CITY_PX[b]
    mx_, my_ = (p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2
    dx, dy = p2[0] - p0[0], p2[1] - p0[1]
    length = math.hypot(dx, dy)
    nx, ny = -dy / length, dx / length
    bend = BEND[(a, b)] * length
    return bezier(p0, (mx_ + nx * bend, my_ + ny * bend), p2)


def sea_value(x, y, noise):
    """> 0 inside the sea (top-left corner), < 0 on land."""
    r = (x / 238.0) ** 2 + (y / 196.0) ** 2
    return 1.0 - r + (noise.at(x / 22.0, y / 22.0) - 0.5) * 0.16


class Placer:
    def __init__(self, roads, noise):
        self.road_pts = [p for pts in roads for p in pts[::3]]
        self.noise = noise
        self.taken = []

    def ok(self, x, y, r, margin=8):
        if not (r + 2 <= x < W - r - 2 and r + 2 <= y < H - r - 2):
            return False
        if sea_value(x, y, self.noise) > -0.10:
            return False
        for cx, cy in CITY_PX.values():
            if math.hypot(x - cx, y - cy) < 46 + r:
                return False
        for px, py in self.road_pts:
            if abs(px - x) < r + margin and abs(py - y) < r + margin:
                if math.hypot(px - x, py - y) < r + margin:
                    return False
        for tx, ty, tr in self.taken:
            if math.hypot(tx - x, ty - y) < tr + r:
                return False
        return True

    def take(self, x, y, r):
        self.taken.append((x, y, r))


# --------------------------------------------------------------------- parts
def base_ground(c, rng, noise, noise2):
    px = c.px
    dune, sand, terra = rgba("dune"), rgba("sand"), rgba("terracotta")
    for y in range(H):
        for x in range(W):
            n = noise.at(x / 70.0, y / 70.0) * 0.7 + noise2.at(x / 18.0, y / 18.0) * 0.3
            b = BAYER4[y % 4][x % 4]
            col = dune
            if n > 0.74:
                col = sand
            elif n > 0.63 and b < (n - 0.63) * 130:
                col = sand
            elif n < 0.24 and b < (0.24 - n) * 60:
                col = terra
            px[x, y] = col


def dune_ridges(c, rng, placer):
    for _ in range(260):
        x, y = rng.randrange(20, W - 20), rng.randrange(20, H - 20)
        if not placer.ok(x, y, 14, margin=4):
            continue
        length = rng.randrange(14, 40)
        curve = rng.choice([-1, 1]) * rng.uniform(0.02, 0.05)
        for i in range(length):
            xx = x + i
            yy = y + int(curve * (i - length / 2) ** 2) - int(curve * (length / 2) ** 2)
            c.put(xx, yy, "sand")
            c.put(xx + 1, yy, "sand")
            if i % 2 == 0:
                c.put(xx, yy + 1, "terracotta")
            if i % 3 == 0:
                c.put(xx + 1, yy + 2, "terracotta")


def draw_sea(c, noise, rng):
    px = c.px
    sky, cloth, sand, oasis = rgba("sky"), rgba("cloth"), rgba("sand"), rgba("oasis")
    for y in range(0, 260):
        for x in range(0, 280):
            v = sea_value(x, y, noise)
            if v > 0.0:
                b = BAYER4[y % 4][x % 4]
                if v > 0.30:
                    px[x, y] = oasis if (v > 0.55 and b < 3) else sky
                elif v > 0.10:
                    px[x, y] = sky
                else:
                    px[x, y] = cloth if b < 7 else sky
            elif v > -0.045:
                px[x, y] = sand
    # wave marks
    for y in range(10, 250, 10):
        for x in range((y * 7) % 18, 280, 18):
            if sea_value(x, y, noise) > 0.22 and sea_value(x + 6, y, noise) > 0.22:
                c.hline(x, x + 5, y, "cloth")


def draw_peak(layer, x, y, w, h):
    layer.poly([(x - w, y), (x, y - h), (x + w, y)], "stone")
    layer.poly([(x, y - h), (x + w, y), (x + w * 0.2, y)], "night")
    layer.poly([(x - w * 0.32, y - h * 0.68), (x, y - h), (x + w * 0.26, y - h * 0.74), (x + w * 0.05, y - h * 0.66)], "cloth")


def draw_mountains(c, rng, placer):
    cluster = []
    for _ in range(400):
        x, y = rng.randrange(520, W - 10), rng.randrange(36, 230)
        w = rng.randrange(14, 26)
        if placer.ok(x, y, w, margin=6):
            h = int(w * rng.uniform(1.1, 1.7))
            cluster.append((y, x, w, h))
            placer.take(x, y, w * 0.8)
        if len(cluster) >= 22:
            break
    cluster.sort()
    layer = Canvas(W, H)
    for y, x, w, h in cluster:
        one = Canvas(W, H)
        draw_peak(one, x, y, w, h)
        one.outline("ink")
        layer.paste(one)
    c.paste(layer)


def draw_field(layer, x, y, w, h, rng):
    cols = rng.choice([("leaf", "oasis"), ("gold", "dune"), ("leaf", "dune"), ("oasis", "leaf")])
    layer.rect(x, y, w, h, cols[0])
    for yy in range(y + 1, y + h, 3):
        layer.hline(x, x + w - 1, yy, cols[1])


def draw_fields(c, rng, placer):
    dx, dy = CITY_PX["dasht"]
    n = 0
    for _ in range(500):
        x, y = dx + rng.randrange(-170, 170), dy + rng.randrange(-110, 120)
        w, h = rng.randrange(18, 36), rng.randrange(12, 22)
        if math.hypot((x - dx) / 170.0, (y - dy) / 118.0) < 1 and placer.ok(x + w // 2, y + h // 2, max(w, h) // 2 + 2, margin=4):
            layer = Canvas(W, H)
            draw_field(layer, x, y, w, h, rng)
            layer.outline("ink")
            c.paste(layer)
            placer.take(x + w // 2, y + h // 2, max(w, h) // 2 + 2)
            n += 1
        if n >= 22:
            break


def draw_palm(layer, x, y, lean=1):
    layer.line(x, y, x + lean, y - 9, "terracotta", r=0.6)
    for fx, fy in ((-7, -1), (-4, -5), (0, -7), (4, -5), (7, -1)):
        layer.line(x + lean, y - 9, x + lean + fx, y - 9 + fy + 3, "leaf", r=0.5)
    layer.put(x + lean, y - 10, "gold")


def draw_oasis(c, x, y, rng):
    layer = Canvas(W, H)
    layer.ellipse(x, y, 14, 9, "leaf")
    layer.ellipse(x, y, 10, 6, "sky")
    layer.hline(x - 6, x - 2, y - 1, "cloth")
    layer.outline("ink")
    c.paste(layer)
    pl = Canvas(W, H)
    draw_palm(pl, x - 12, y + 3, -1)
    draw_palm(pl, x + 11, y + 4, 1)
    pl.outline("ink")
    c.paste(pl)


def draw_oases(c, rng, placer):
    n = 0
    for _ in range(300):
        x, y = rng.randrange(40, W - 40), rng.randrange(40, H - 40)
        if placer.ok(x, y, 18, margin=6):
            draw_oasis(c, x, y, rng)
            placer.take(x, y, 18)
            n += 1
        if n >= 8:
            break


def draw_small_stuff(c, rng, placer):
    for _ in range(900):
        x, y = rng.randrange(6, W - 6), rng.randrange(6, H - 6)
        kind = rng.random()
        if not placer.ok(x, y, 6, margin=4):
            continue
        layer = Canvas(W, H)
        if kind < 0.40:  # rock
            layer.ellipse(x, y, 4, 3, "stone")
            layer.hline(x - 2, x, y - 1, "cloth")
            layer.hline(x, x + 3, y + 1, "night")
        elif kind < 0.75:  # cactus
            layer.rect(x, y - 7, 3, 9, "leaf")
            layer.rect(x - 3, y - 4, 3, 2, "leaf")
            layer.rect(x - 3, y - 6, 2, 3, "leaf")
            layer.rect(x + 3, y - 3, 3, 2, "leaf")
            layer.rect(x + 4, y - 5, 2, 3, "leaf")
        else:  # dry tuft
            for dx in (-2, 0, 2):
                layer.vline(x + dx, y - 3, y, "leaf")
            layer.put(x, y - 4, "gold")
        layer.outline("ink")
        c.paste(layer)
        placer.take(x, y, 6)


def draw_roads(c, roads):
    """Dashed sand roads: 3px cloth-white dashes, each with a 1px ink outline."""
    for pts in roads:
        acc = 0.0
        prev = pts[0]
        dashes = []
        on = True
        cur = []
        for p in pts[1:]:
            seg = math.hypot(p[0] - prev[0], p[1] - prev[1])
            acc += seg
            cur.append(p)
            lim = 9 if on else 6
            if acc >= lim:
                if on:
                    dashes.append(list(cur))
                cur, acc, on = [], 0.0, not on
            prev = p
        layer = Canvas(W, H)
        for d in dashes:
            for (x, y) in d:
                layer.ellipse(x + 0.5, y + 0.5, 1.5, 1.5, "cloth")
        layer.outline("ink")
        c.paste(layer)


def draw_plaza(c, x, y):
    layer = Canvas(W, H)
    layer.ellipse(x, y, 26, 20, "sand")
    layer.ring(x, y, 26, 20, "dune", 2.0)
    layer.outline("ink")
    c.paste(layer)
    c.ellipse(x, y, 20, 14, "cloth")
    c.ring(x, y, 20, 14, "sand", 1.0)


def draw_compass(c, x, y):
    layer = Canvas(W, H)
    layer.ellipse(x, y, 22, 22, "cloth")
    layer.ring(x, y, 22, 22, "dune", 2.0)
    layer.poly([(x, y - 20), (x + 4, y), (x, y + 20), (x - 4, y)], "terracotta")
    layer.poly([(x - 20, y), (x, y - 4), (x + 20, y), (x, y + 4)], "dune")
    layer.poly([(x, y - 20), (x + 4, y), (x - 4, y)], "blood")
    layer.ellipse(x, y, 3, 3, "gold")
    layer.outline("ink")
    c.paste(layer)


def world_map():
    rng = random.Random(7007)
    noise, noise2 = Noise(11), Noise(12)
    c = Canvas(W, H)
    roads = [road_points(a, b) for a, b in ROUTES]
    placer = Placer(roads, noise)
    base_ground(c, rng, noise, noise2)
    dune_ridges(c, rng, placer)
    draw_sea(c, noise, rng)
    draw_mountains(c, rng, placer)
    draw_fields(c, rng, placer)
    draw_oases(c, rng, placer)
    draw_small_stuff(c, rng, placer)
    draw_roads(c, roads)
    for name, (x, y) in CITY_PX.items():
        draw_plaza(c, x, y)
    draw_compass(c, 56, 492)
    return c.image()

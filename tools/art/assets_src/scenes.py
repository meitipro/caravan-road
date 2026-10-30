"""Four 320x180 city banners, procedural and seeded (fully deterministic)."""
import random

from grid import Canvas

W, H = 320, 180


def sky_gradient(c, horizon, top="sky", low="sand", sun=None):
    """Dithered vertical gradient from `top` (y=0) to `low` (y=horizon)."""
    c.rect(0, 0, W, horizon, top)
    # dithered blend in the lower 65% of the sky
    start = int(horizon * 0.35)
    span = horizon - start
    for y in range(start, horizon):
        level = int(16 * (y - start) / max(span, 1))
        c.dither(0, y, W, 1, top, low, level)
    if sun:
        sx, sy, r = sun
        c.ellipse(sx, sy, r + 2, r + 2, "sand")
        c.ellipse(sx, sy, r, r, "gold")


def clouds(c, rng, n, ymax):
    for _ in range(n):
        x, y = rng.randrange(0, W), rng.randrange(6, ymax)
        w = rng.randrange(18, 40)
        c.ellipse(x, y, w // 2, 3, "cloth")
        c.ellipse(x + w // 4, y - 2, w // 4, 3, "cloth")


def far_dunes(c, rng, base_y, amp, color, step=40):
    """A rolling silhouette of dunes/hills filling from the curve down to the bottom."""
    pts = []
    x = -step
    while x <= W + step:
        pts.append((x, base_y - rng.randrange(0, amp + 1)))
        x += step
    poly = pts + [(W + step, H), (-step, H)]
    c.poly(poly, color)


def outlined(draw, color="ink"):
    """Run draw(layer) on a fresh transparent layer, outline it, return the layer."""
    layer = Canvas(W, H)
    draw(layer)
    layer.outline(color)
    return layer


# --------------------------------------------------------------------- dasht
def dasht():
    rng = random.Random(1001)
    c = Canvas(W, H)
    sky_gradient(c, 92, sun=(256, 34, 12))
    clouds(c, rng, 5, 40)
    # distant hills (solid base first so no sky gap can show through)
    c.rect(0, 92, W, 12, "stone")
    far_dunes(c, rng, 96, 10, "stone", 60)
    far_dunes(c, rng, 100, 8, "dune", 50)
    # fields in perspective: alternating bands with furrow lines
    c.rect(0, 100, W, H - 100, "leaf")
    y, band = 100, 0
    while y < H:
        h = 4 + (y - 100) // 8
        col = "leaf" if band % 2 == 0 else "oasis"
        c.rect(0, y, W, h, col)
        # furrows
        for x in range(0, W, 6 + (y - 100) // 10):
            c.put(x, y, "dune" if band % 2 == 0 else "leaf")
        y += h
        band += 1
    # golden grain patch
    c.poly([(0, 124), (110, 114), (150, 120), (150, 130), (0, 146)], "gold")
    for y in range(116, 146, 3):
        for x in range(0 + (y % 6), 148, 6):
            if c.get(x, y) == (0xE0, 0xA5, 0x26, 255):
                c.put(x, y, "dune")
    # farmstead (right): house, barn, silo, tree
    def farm(layer):
        # barn
        layer.rect(196, 84, 44, 34, "terracotta")
        layer.poly([(192, 86), (218, 66), (244, 86)], "blood")
        layer.rect(206, 98, 14, 20, "night")
        layer.hline(206, 219, 98, "sand")
        layer.line(206, 98, 219, 117, "sand")
        layer.line(219, 98, 206, 117, "sand")
        # farmhouse
        layer.rect(250, 94, 32, 24, "cloth")
        layer.poly([(246, 96), (266, 78), (286, 96)], "terracotta")
        layer.rect(256, 102, 7, 8, "sky")
        layer.rect(270, 104, 7, 14, "dune")
        # silo
        layer.rect(180, 78, 12, 40, "dune")
        layer.ellipse(186, 78, 6, 5, "stone")
        layer.hline(180, 191, 90, "terracotta")
        layer.hline(180, 191, 102, "terracotta")

    c.paste(outlined(farm))
    # tree
    def tree(layer, x, y):
        layer.rect(x - 1, y, 3, 12, "terracotta")
        layer.ellipse(x, y - 2, 9, 8, "leaf")
        layer.ellipse(x - 4, y + 1, 5, 4, "leaf")
        layer.ellipse(x + 3, y - 5, 4, 3, "oasis")

    c.paste(outlined(lambda l: tree(l, 160, 104)))
    # haystacks
    def stacks(layer):
        for x, y in ((40, 112), (62, 108), (88, 114)):
            layer.ellipse(x, y, 8, 6, "gold", only=lambda a, b, y=y: b <= y + 4)
            layer.hline(x - 7, x + 7, y + 4, "dune")
            layer.ellipse(x - 2, y - 2, 3, 2, "sand")

    c.paste(outlined(stacks))
    # dirt road in the foreground with a cart
    c.poly([(120, H), (320, 150), (320, 168), (180, H)], "dune")
    c.poly([(140, H), (320, 160), (320, 164), (160, H)], "sand")
    # fence posts
    for x in range(10, 150, 14):
        c.rect(x, 138, 2, 8, "terracotta")
    c.hline(10, 150, 140, "terracotta")
    # birds
    for x, y in ((90, 30), (100, 24), (110, 32)):
        c.put(x, y, "night")
        c.put(x + 1, y + 1, "night")
        c.put(x + 2, y, "night")
    return c.image()


# --------------------------------------------------------------------- madan
def madan():
    rng = random.Random(2002)
    c = Canvas(W, H)
    sky_gradient(c, 100, top="sky", low="sand", sun=(60, 36, 10))
    clouds(c, rng, 4, 40)
    c.rect(0, 100, W, H - 100, "dune")
    # back range: jagged stone peaks
    peaks = [(-10, 100), (30, 52), (60, 74), (100, 36), (150, 78), (200, 44), (250, 70), (290, 30), (330, 80), (330, 100)]
    c.poly(peaks, "stone")
    # shaded face and a cloth-white cap on each peak
    for px, py in ((30, 52), (100, 36), (200, 44), (290, 30)):
        c.poly([(px, py), (px + 14, py + 30), (px + 4, py + 30), (px - 2, py + 20)], "night")
        c.poly([(px - 3, py + 8), (px, py), (px + 3, py + 8)], "cloth")
    # front hill with the mine
    front = [(-10, 150), (30, 112), (90, 96), (160, 92), (220, 100), (270, 120), (330, 140), (330, H), (-10, H)]
    c.poly(front, "dune")
    c.poly([(90, 96), (160, 92), (220, 100), (200, 110), (120, 110)], "terracotta")
    # rock texture
    for _ in range(90):
        x, y = rng.randrange(0, W), rng.randrange(104, H)
        c.put(x, y, "terracotta" if rng.random() < 0.5 else "sand")
    for _ in range(40):
        x, y = rng.randrange(0, W), rng.randrange(104, H)
        c.rect(x, y, 2, 1, "stone")

    def mine(layer):
        # timber frame mine entrance
        layer.poly([(134, 140), (140, 108), (176, 108), (182, 140)], "night")
        layer.rect(130, 104, 56, 5, "terracotta")
        layer.rect(130, 104, 56, 1, "dune")
        layer.rect(132, 108, 5, 34, "terracotta")
        layer.rect(179, 108, 5, 34, "terracotta")
        layer.rect(142, 112, 32, 4, "night")
        # support sign
        layer.rect(152, 96, 16, 8, "dune")
        # tracks
        layer.rect(120, 142, 80, 2, "stone")
        # ore cart
        layer.poly([(214, 128), (240, 128), (236, 142), (218, 142)], "stone")
        layer.rect(212, 126, 30, 3, "night")
        layer.ellipse(224, 134, 3, 2, "gold")
        layer.ellipse(232, 133, 3, 2, "night")
        layer.ellipse(220, 144, 3, 3, "night")
        layer.ellipse(234, 144, 3, 3, "night")
        # ore pile
        layer.poly([(70, 142), (80, 128), (96, 124), (112, 142)], "night")
        layer.poly([(80, 128), (96, 124), (104, 134), (88, 142)], "stone")
        layer.put(92, 130, "cloth")
        layer.put(100, 136, "cloth")

    c.paste(outlined(mine))
    # lantern glow in the mine mouth
    c.ellipse(158, 130, 6, 5, "terracotta")
    c.ellipse(158, 130, 3, 3, "gold")
    # little hut and pickaxes
    def hut(layer):
        layer.rect(262, 120, 32, 26, "stone")
        layer.poly([(258, 122), (278, 104), (298, 122)], "night")
        layer.rect(274, 130, 8, 16, "terracotta")
        layer.rect(266, 126, 6, 5, "sky")
        layer.vline(300, 110, 146, "terracotta")
        layer.hline(296, 304, 112, "stone")
        layer.put(296, 113, "stone")

    c.paste(outlined(hut))
    # foreground rubble
    for _ in range(14):
        x, y = rng.randrange(0, W), rng.randrange(150, H - 4)
        c.ellipse(x, y, rng.randrange(3, 7), 3, rng.choice(["stone", "night", "terracotta"]))
    return c.image()


# -------------------------------------------------------------------- bandar
def bandar():
    rng = random.Random(3003)
    c = Canvas(W, H)
    horizon = 84
    sky_gradient(c, horizon, top="sky", low="cloth", sun=(250, 52, 11))
    clouds(c, rng, 4, 36)
    # sea with wave rows
    c.rect(0, horizon, W, H - horizon, "sky")
    c.dither(0, horizon, W, 30, "cloth", "sky", 12)
    for y in range(horizon + 8, H, 7):
        c.rect(0, y, W, 3, "oasis" if (y // 7) % 2 else "sky")
        for x in range(rng.randrange(0, 10), W, 14):
            c.hline(x, x + 3, y - 2, "cloth")
    c.rect(0, horizon, W, 1, "stone")
    # harbour town at left/horizon
    def town(layer):
        for i, x in enumerate(range(6, 120, 22)):
            h = 22 + (i * 7) % 14
            layer.rect(x, horizon - h, 20, h + 2, "cloth" if i % 2 else "sand")
            layer.poly([(x - 1, horizon - h), (x + 10, horizon - h - 8), (x + 21, horizon - h)], "terracotta")
            layer.rect(x + 4, horizon - h + 6, 4, 5, "night")
            layer.rect(x + 12, horizon - h + 12, 4, 6, "sky")

    c.paste(outlined(town))
    # lighthouse
    def lighthouse(layer):
        layer.poly([(150, horizon + 2), (154, 30), (166, 30), (170, horizon + 2)], "cloth")
        for y in (44, 62):
            layer.rect(152 if y == 44 else 151, y, 18, 8, "blood")
        layer.rect(150, 24, 22, 6, "night")
        layer.rect(154, 14, 14, 10, "gold")
        layer.poly([(152, 14), (161, 4), (170, 14)], "terracotta")

    c.paste(outlined(lighthouse))
    # pier: planks over posts, running into the sea
    def pier(layer):
        for x in range(176, 316, 18):
            layer.rect(x, 124, 4, 28, "terracotta")
        layer.rect(168, 118, 152, 8, "dune")
        for x in range(170, 320, 8):
            layer.vline(x, 118, 125, "terracotta")
        layer.hline(168, 319, 118, "sand")
        # crates and barrels
        layer.rect(190, 104, 14, 14, "terracotta")
        layer.rect(190, 104, 14, 2, "dune")
        layer.line(190, 105, 203, 117, "dune")
        layer.rect(208, 108, 12, 10, "dune")
        layer.ellipse(236, 110, 6, 8, "terracotta")
        layer.hline(231, 241, 107, "night")
        layer.hline(231, 241, 113, "night")

    c.paste(outlined(pier))

    def ship(layer, x, y, scale=1.0, flag="blood"):
        s = scale
        # hull
        layer.poly([(x, y), (x + 54 * s, y), (x + 46 * s, y + 12 * s), (x + 8 * s, y + 12 * s)], "terracotta")
        layer.rect(x + 2 * s, y, 50 * s, 3, "dune")
        # masts and sails
        layer.vline(x + 18 * s, y - 38 * s, y, "night")
        layer.vline(x + 38 * s, y - 30 * s, y, "night")
        layer.poly([(x + 20 * s, y - 36 * s), (x + 33 * s, y - 6 * s), (x + 20 * s, y - 4 * s)], "cloth")
        layer.poly([(x + 16 * s, y - 32 * s), (x + 4 * s, y - 6 * s), (x + 16 * s, y - 4 * s)], "sand")
        layer.poly([(x + 40 * s, y - 28 * s), (x + 50 * s, y - 6 * s), (x + 40 * s, y - 4 * s)], "cloth")
        layer.poly([(x + 18 * s, y - 38 * s), (x + 26 * s, y - 36 * s), (x + 18 * s, y - 33 * s)], flag)

    big = outlined(lambda l: ship(l, 60, 118, 1.2))
    c.paste(big)
    small = outlined(lambda l: ship(l, 120, 98, 0.7, "gold"))
    c.paste(small)
    # gulls
    for x, y in ((40, 24), (50, 18), (64, 26), (210, 20)):
        c.put(x, y, "night")
        c.put(x + 1, y - 1, "night")
        c.put(x + 2, y, "night")
        c.put(x + 3, y - 1, "night")
        c.put(x + 4, y, "night")
    return c.image()


# --------------------------------------------------------------------- shahr
def shahr():
    rng = random.Random(4004)
    c = Canvas(W, H)
    sky_gradient(c, 100, top="sky", low="sand", sun=(40, 30, 10))
    clouds(c, rng, 3, 30)

    def city(layer):
        # city wall with crenellations
        layer.rect(0, 92, W, 40, "sand")
        for x in range(0, W, 12):
            layer.rect(x, 86, 7, 7, "sand")
        for x in range(0, W, 24):
            layer.rect(x, 100, 4, 8, "dune")
        # towers
        for x, h in ((20, 52), (260, 60)):
            layer.rect(x, 92 - h + 40, 28, h, "dune")
            layer.rect(x - 3, 92 - h + 36, 34, 6, "sand")
            for xx in range(x - 3, x + 31, 8):
                layer.rect(xx, 92 - h + 30, 5, 6, "sand")
            layer.rect(x + 11, 92 - h + 50, 6, 10, "night")
        # minarets
        for x in (92, 232):
            layer.rect(x, 30, 8, 70, "cloth")
            layer.rect(x - 2, 52, 12, 4, "dune")
            layer.ellipse(x + 4, 30, 6, 6, "oasis")
            layer.poly([(x - 1, 30), (x + 4, 12), (x + 9, 30)], "oasis")
            layer.rect(x + 3, 6, 2, 8, "gold")
        # central domes
        layer.rect(126, 66, 68, 32, "cloth")
        layer.ellipse(160, 66, 34, 28, "oasis", only=lambda x, y: y <= 66)
        layer.ellipse(160, 66, 20, 16, "sky", only=lambda x, y: y <= 66)
        layer.vline(160, 24, 40, "gold")
        layer.ellipse(160, 24, 3, 3, "gold")
        layer.rect(150, 74, 20, 24, "night")
        layer.ellipse(160, 74, 10, 8, "night", only=lambda x, y: y <= 74)
        # side domes
        for x in (60, 260 - 4):
            layer.ellipse(x, 84, 14, 12, "terracotta", only=lambda xx, yy: yy <= 84)
            layer.vline(x, 66, 72, "gold")

    c.paste(outlined(city))
    # gate arch shine and wall base
    c.rect(0, 120, W, 12, "dune")
    c.hline(0, W - 1, 120, "stone")
    # market street and awnings
    c.rect(0, 132, W, H - 132, "dune")
    c.dither(0, 132, W, 8, "dune", "sand", 6)
    c.dither(0, 160, W, 20, "dune", "terracotta", 3)
    awn_colors = ["terracotta", "cloth", "oasis", "gold", "blood"]

    def stalls(layer):
        x, i = 6, 0
        while x < W - 40:
            w = 44 + rng.randrange(0, 10)
            col = awn_colors[i % len(awn_colors)]
            layer.poly([(x, 116), (x + w, 116), (x + w + 4, 130), (x - 4, 130)], col)
            for sx in range(x - 2, x + w, 8):
                layer.poly([(sx, 116), (sx + 4, 116), (sx + 6, 130), (sx + 2, 130)], "cloth" if col != "cloth" else "terracotta")
            layer.rect(x, 130, 3, 26, "night")
            layer.rect(x + w - 3, 130, 3, 26, "night")
            layer.rect(x + 3, 144, w - 6, 12, "terracotta")
            # goods on the counter
            for gx in range(x + 6, x + w - 8, 9):
                layer.ellipse(gx + 3, 142, 3, 3, rng.choice(["gold", "leaf", "blood", "sky"]))
            x += w + 14
            i += 1

    c.paste(outlined(stalls))
    # people silhouettes in the street
    def people(layer):
        for x in range(20, 300, 41):
            y = 160 + rng.randrange(0, 12)
            layer.ellipse(x, y - 10, 3, 3, "dune")
            layer.rect(x - 3, y - 7, 7, 12, rng.choice(["oasis", "terracotta", "night", "gold"]))
            layer.rect(x - 3, y + 5, 3, 4, "night")
            layer.rect(x + 1, y + 5, 3, 4, "night")

    c.paste(outlined(people))
    # banners on poles
    for x in (112, 208):
        c.vline(x, 56, 90, "night")
        c.poly([(x + 1, 58), (x + 12, 62), (x + 1, 68)], "blood")
    return c.image()


CITIES = {"dasht": dasht, "madan": madan, "bandar": bandar, "shahr": shahr}

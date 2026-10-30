"""Goods icons (32x32) and UI icons (16x16), drawn from layered shapes."""
from grid import Canvas, render


def _finish(layer):
    layer.outline("ink")
    return layer


# --------------------------------------------------------------------- grain
def grain():
    c = Canvas(32, 32)
    base = Canvas(32, 32)
    # leaves at the base
    base.poly([(16, 29), (4, 21), (3, 27), (9, 29)], "leaf")
    base.poly([(16, 29), (28, 21), (29, 27), (23, 29)], "leaf")
    base.line(16, 29, 16, 22, "leaf", r=1.0)
    base.outline("ink")
    c.paste(base)
    # each ear is its own outlined layer so the ears stay separate at 1x
    tips = [(5, 11), (27, 11), (10, 6), (22, 6), (16, 3)]
    for tx, ty in tips:
        sx, sy = 16, 26
        layer = Canvas(32, 32)
        t0 = 0.55
        mx, my = sx + (tx - sx) * t0, sy + (ty - sy) * t0
        layer.line(sx, sy, mx, my, "leaf", r=0.5)
        layer.line(mx, my, tx, ty, "dune", r=1.5)
        for t in (0.68, 0.8, 0.92):
            layer.put(sx + (tx - sx) * t - 1, sy + (ty - sy) * t, "sand")
        layer.put(tx, ty - 1, "gold")
        layer.outline("ink")
        c.paste(layer)
    # binding
    bind = Canvas(32, 32)
    bind.rect(12, 22, 9, 4, "terracotta")
    bind.hline(12, 20, 22, "blood")
    bind.outline("ink")
    c.paste(bind)
    return c.image()


# ---------------------------------------------------------------------- salt
def _crystal(c, x, y, w, h):
    """A pointed prism, outlined on its own layer so neighbours stay separate."""
    layer = Canvas(32, 32)
    layer.poly([(x, y + 4), (x + w / 2.0, y), (x + w, y + 4), (x + w, y + h), (x, y + h)], "cloth")
    layer.poly([(x + w / 2.0, y), (x + w, y + 4), (x + w, y + h), (x + w / 2.0, y + h)], "sky")
    layer.put(x + 1, y + 6, "cloth")
    layer.outline("ink")
    c.paste(layer)


def salt():
    c = Canvas(32, 32)
    pile = Canvas(32, 32)
    pile.poly([(2, 29), (6, 22), (11, 18), (21, 18), (26, 22), (30, 29)], "cloth")
    pile.poly([(21, 18), (26, 22), (30, 29), (17, 29), (20, 23)], "sky")
    pile.hline(2, 30, 28, "sky")
    pile.hline(2, 30, 29, "sky")
    pile.outline("ink")
    c.paste(pile)
    _crystal(c, 12, 5, 8, 17)
    _crystal(c, 5, 13, 6, 12)
    _crystal(c, 21, 11, 6, 13)
    c.hline(8, 11, 26, "sky")
    c.put(26, 26, "cloth")
    c.put(4, 27, "cloth")
    return c.image()


# ---------------------------------------------------------------------- iron
def _ingot(c, x, y, w, h):
    """Trapezoid ingot: top face stone, side night, with a highlight."""
    c.poly([(x + 2, y), (x + w - 2, y), (x + w, y + h), (x, y + h)], "stone")
    c.poly([(x, y + h - 3), (x + w, y + h - 3), (x + w, y + h), (x, y + h)], "night")
    c.hline(x + 3, x + w - 4, y, "cloth")


def iron():
    c = Canvas(32, 32)
    _ingot(c, 2, 20, 13, 8)
    _ingot(c, 17, 20, 13, 8)
    _ingot(c, 9, 12, 14, 9)
    _finish(c)
    # glints
    c.put(5, 22, "cloth")
    c.put(20, 22, "cloth")
    c.put(12, 12, "cloth")
    c.hline(4, 12, 26, "ink")
    c.hline(19, 27, 26, "ink")
    return c.image()


# --------------------------------------------------------------------- spice
def spice():
    c = Canvas(32, 32)
    # sack body
    c.poly([(5, 28), (4, 20), (7, 14), (25, 14), (28, 20), (27, 28)], "dune")
    # sack rim (folded cuff)
    c.rect(6, 11, 20, 5, "sand")
    c.hline(6, 25, 15, "dune")
    # spice heap above the rim
    c.ellipse(16, 10, 9, 6, "terracotta")
    c.poly([(8, 12), (11, 6), (21, 6), (24, 12)], "terracotta")
    c.ellipse(16, 7, 5, 3, "blood")
    c.ellipse(15, 8, 4, 2, "terracotta")
    _finish(c)
    # gold flecks in spice
    for x, y in ((12, 8), (16, 6), (20, 9), (14, 11), (18, 10)):
        c.put(x, y, "gold")
    # sack shading and label band
    c.vline(24, 17, 26, "terracotta")
    c.vline(25, 17, 26, "terracotta")
    c.rect(9, 20, 12, 4, "cloth")
    c.hline(9, 20, 22, "gold")
    c.hline(8, 23, 17, "terracotta")
    return c.image()


# ---------------------------------------------------------------------- silk
def silk():
    c = Canvas(32, 32)
    # unrolled tail hanging from the front of the roll
    c.poly([(8, 20), (21, 20), (21, 27), (18, 29), (15, 27), (12, 29), (8, 27)], "sky")
    c.poly([(15, 20), (21, 20), (21, 27), (18, 29), (15, 27)], "oasis")
    # roll body
    c.rect(4, 8, 21, 13, "sky")
    c.rect(4, 16, 21, 5, "oasis")
    c.hline(4, 24, 8, "cloth")
    c.hline(4, 24, 9, "cloth")
    # right end cap shows the winding
    c.ellipse(25, 14.5, 4, 6.5, "sky")
    c.ellipse(25, 14.5, 2.8, 5, "cloth")
    c.ellipse(25, 14.5, 1.4, 2.6, "oasis")
    _finish(c)
    # stripes across the roll and fold lines on the tail
    c.vline(9, 10, 20, "cloth")
    c.vline(15, 10, 20, "cloth")
    c.put(25, 14, "sky")
    c.vline(12, 22, 26, "sky")
    c.vline(18, 22, 26, "sky")
    return c.image()


# ---------------------------------------------------------------------- coin
COIN = [
    "................",
    ".....KKKKKK.....",
    "...KKGGGGGGKK...",
    "..KGGCCGGGGGGK..",
    "..KGCGGGGGGDGK..",
    ".KGCGGDDDDGGGDK.",
    ".KGGGDGGGGDGGDK.",
    ".KGGGDGGGGDGGDK.",
    ".KGGGDGGGGDGGDK.",
    ".KGGGDGGGGDGGDK.",
    ".KGGGGDDDDGGGDK.",
    "..KGGGGGGGGGDK..",
    "..KDGGGGGGGDDK..",
    "...KKDDDDDDKK...",
    ".....KKKKKK.....",
    "................",
]


def coin():
    return render(COIN, (16, 16))


# --------------------------------------------------------------------- guard
_HELMET = [
    "............",
    "....BBB.....",
    "...KBBBK....",
    "..KKKKKKK...",
    ".KRRCCRRRK..",
    "KRRCCRRRRRK.",
    "KRCRRRRRRRK.",
    "KRRRRRRRRRK.",
    "KKKKKKKKKKK.",
    "KRRNNKNNRRK.",
    "KRRNNRNNRRK.",
    ".KRNNRNNRK..",
    "..KRRRRRK...",
    "...KKKKK....",
    "............",
    "............",
]
_SPEAR = [
    ".KK.",
    "KRRK",
    "KCRK",
    "KGGK",
    "KSDK",
    "KSDK",
    "KSDK",
    "KSDK",
    "KSDK",
    "KSDK",
    "KSDK",
    "KSDK",
    "KSDK",
    "KSDK",
    "KSDK",
    "KKKK",
]
GUARD = [h + sp for h, sp in zip(_HELMET, _SPEAR)]


def guard():
    return render(GUARD, (16, 16))


GOODS = {"grain": grain, "salt": salt, "iron": iron, "spice": spice, "silk": silk}
UI_ICONS = {"coin": coin, "guard": guard}

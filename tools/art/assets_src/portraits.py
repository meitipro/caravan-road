"""Four 96x96 merchant portraits, built from layered shapes.

Every portrait: cloth background with a little scene hint, a figure layer with a
1px ink outline, and a 1px ink frame. Symmetric features mirror about x = 48
(pixel x <-> 95 - x).
"""
from grid import Canvas
from palette import rgba

W = H = 96
rgba_stone = rgba("stone")


def mx(x):
    """Mirror a pixel column about the vertical centre line."""
    return W - 1 - x


def mirrored_put(c, x, y, color):
    c.put(x, y, color)
    c.put(mx(x), y, color)


def mirrored_rect(c, x, y, w, h, color):
    c.rect(x, y, w, h, color)
    c.rect(mx(x + w - 1), y, w, h, color)


def background(kind):
    bg = Canvas(W, H, "cloth")
    if kind == "golnar":  # wheat field horizon
        bg.dither(0, 66, W, 30, "cloth", "sand", 8)
        bg.rect(0, 78, W, 18, "leaf")
        for x in range(0, W, 6):
            bg.vline(x + 1, 74, 78, "leaf")
            bg.put(x + 1, 73, "gold")
        bg.rect(0, 84, W, 2, "oasis")
        bg.rect(0, 90, W, 6, "oasis")
        bg.ellipse(80, 14, 7, 7, "gold")
    elif kind == "rostam":  # forge glow
        bg.dither(0, 0, W, W, "cloth", "sand", 4)
        bg.dither(0, 56, W, 40, "sand", "dune", 8)
        bg.dither(0, 76, W, 20, "dune", "terracotta", 8)
        for x, y in ((10, 20), (16, 30), (84, 16), (78, 28), (86, 40), (8, 46)):
            bg.rect(x, y, 2, 2, "gold")
        for x, y in ((12, 12), (82, 24), (88, 34)):
            bg.put(x, y, "terracotta")
    elif kind == "nahid":  # sea and sky
        bg.dither(0, 0, W, 40, "cloth", "sky", 4)
        bg.rect(0, 56, W, 40, "sky")
        for y in range(58, 96, 6):
            for x in range(0, W, 12):
                bg.hline(x + (y % 12) // 2, x + (y % 12) // 2 + 4, y, "cloth")
        bg.rect(0, 74, W, 22, "oasis")
        for y in range(76, 96, 6):
            for x in range(0, W, 12):
                bg.hline(x + 4, x + 8, y, "sky")
        bg.vline(86, 20, 56, "dune")
        bg.poly([(87, 22), (87, 50), (74, 50)], "cloth")
    else:  # sohrab: lattice arch in a city wall
        bg.dither(0, 0, W, W, "cloth", "sand", 5)
        bg.ellipse(48, 52, 40, 50, "sand")
        bg.ellipse(48, 52, 34, 44, "cloth")
        for x in range(8, 90, 8):
            bg.vline(x, 60, 96, "sand")
        for y in range(64, 96, 8):
            bg.hline(0, W - 1, y, "sand")
    return bg


def figure_base(c, skin, shade, body, neck_shade=True):
    """Shoulders, neck and head ellipse. Returns nothing; draws in place."""
    c.ellipse(48, 100, 42, 36, body)
    c.rect(41, 54, 14, 12, skin)
    if neck_shade:
        c.rect(41, 60, 14, 5, shade)
    c.ellipse(48, 40, 16, 19, skin)
    # ears
    c.ellipse(31, 42, 3, 4, skin)
    c.ellipse(65, 42, 3, 4, skin)


def eyes(c, y, color="ink", w=2, h=3, dx=7):
    mirrored_rect(c, 48 - dx - w // 2 - 1, y, w, h, color)


def finish(kind, fig):
    fig.outline("ink")
    bg = background(kind)
    bg.paste(fig)
    # frame
    bg.rect(0, 0, W, 1, "ink")
    bg.rect(0, H - 1, W, 1, "ink")
    bg.rect(0, 0, 1, H, "ink")
    bg.rect(W - 1, 0, 1, H, "ink")
    return bg.image()


# -------------------------------------------------------------------- golnar
def golnar():
    f = Canvas(W, H)
    skin, shade = "sand", "dune"
    figure_base(f, skin, shade, "dune")
    # tunic with embroidered neckline and apron
    f.poly([(30, 72), (48, 65), (66, 72), (70, 96), (26, 96)], "terracotta")
    f.rect(40, 65, 16, 3, "gold")
    f.rect(34, 80, 28, 2, "gold")
    # sleeves highlight
    f.ellipse(18, 92, 12, 12, "dune")
    f.ellipse(78, 92, 12, 12, "dune")
    # headscarf: behind the face, then drape over the shoulders
    f.ellipse(48, 36, 22, 24, "leaf")
    f.poly([(26, 44), (18, 66), (24, 78), (42, 68), (40, 58)], "leaf")
    f.poly([(70, 44), (78, 66), (72, 78), (54, 68), (56, 58)], "leaf")
    # scarf shadow (right) and folds
    f.ellipse(48, 36, 22, 24, "oasis", only=lambda x, y: x > 63 and y < 56)
    f.poly([(70, 52), (78, 66), (72, 78), (66, 66)], "oasis")
    for i in range(4):
        f.line(24 - i, 54 + i * 5, 30 - i, 66 + i * 4, "oasis")
    # face opening
    f.ellipse(48, 43, 14.5, 17, skin)
    f.ellipse(48, 28, 18, 6, "leaf")  # scarf band over the forehead
    f.rect(30, 31, 36, 1, "oasis")
    # chin shadow
    f.ellipse(48, 55, 9, 2, shade, only=lambda x, y: y >= 55)
    # eyebrows, eyes, nose, smile, cheeks
    mirrored_rect(f, 38, 37, 6, 1, "night")
    mirrored_rect(f, 41, 40, 2, 3, "ink")
    mirrored_put(f, 41, 40, "cloth")
    mirrored_rect(f, 40, 44, 2, 1, shade)
    f.rect(47, 45, 2, 3, shade)
    f.put(46, 48, shade)
    f.put(49, 48, shade)
    for x, y in ((43, 50), (44, 51), (45, 52), (46, 52), (47, 52), (48, 52), (49, 52), (50, 52), (51, 51), (52, 50)):
        f.put(x, y, "blood")
    for x, y in ((43, 50), (52, 50)):
        f.put(x, y, "ink")
    mirrored_rect(f, 36, 46, 3, 2, "terracotta")
    # wheat sprig in the scarf
    f.line(72, 66, 66, 50, "gold")
    for t, (x, y) in enumerate(((66, 50), (68, 54), (70, 58))):
        f.rect(x, y, 2, 3, "gold")
    return finish("golnar", f)


# -------------------------------------------------------------------- rostam
def rostam():
    f = Canvas(W, H)
    skin, shade = "dune", "terracotta"
    # leather apron over a terracotta shirt
    figure_base(f, skin, shade, "terracotta")
    f.poly([(26, 96), (30, 72), (66, 72), (70, 96)], "night")
    f.rect(34, 66, 4, 30, "night")
    f.rect(58, 66, 4, 30, "night")
    f.rect(30, 76, 36, 2, "stone")
    f.rect(40, 84, 16, 8, "stone")  # apron pocket
    f.rect(40, 84, 16, 1, "ink")
    # grey side-hair, bald top with sweatband
    f.ellipse(30, 40, 5, 9, "stone")
    f.ellipse(66, 40, 5, 9, "stone")
    f.ellipse(48, 40, 16, 19, skin)
    f.ellipse(31, 42, 3, 4, skin)
    f.ellipse(65, 42, 3, 4, skin)
    f.ellipse(48, 28, 12, 7, "sand", only=lambda x, y: y < 26)  # shiny dome
    f.rect(33, 26, 30, 4, "terracotta")
    f.hline(33, 62, 26, "blood")
    # heavy brows and small eyes
    mirrored_rect(f, 36, 34, 8, 3, "night")
    mirrored_rect(f, 40, 38, 3, 2, "ink")
    # big nose
    f.ellipse(48, 44, 4.5, 4.5, shade)
    f.ellipse(47, 43, 2, 2, skin)
    # soot smudges
    for x, y in ((36, 31), (60, 30), (37, 42), (59, 42), (44, 31)):
        f.rect(x, y, 2, 2, "stone")
    # thick beard
    beard = [(30, 44), (66, 44), (69, 58), (62, 70), (48, 77), (34, 70), (27, 58)]
    f.poly(beard, "stone")
    f.poly([(48, 60), (66, 52), (69, 58), (62, 70), (48, 77)], "stone")
    # fur-like texture: dark strands low down, light strands high up
    for y in range(46, 78):
        for x in range(26, 70):
            if f.get(x, y) == rgba_stone:
                if y >= 56 and (x * 3 + y * 5) % 13 == 0:
                    f.rect(x, y, 1, 3, "night")
                elif (x + y * 2) % 17 == 0:
                    f.put(x, y, "cloth")
    # moustache over the mouth
    f.ellipse(48, 52, 14, 5, "stone")
    f.rect(41, 55, 14, 1, "night")
    f.rect(46, 53, 4, 2, "ink")  # lip gap
    f.put(37, 49, "cloth")
    f.put(59, 49, "cloth")
    # cheeks above the beard
    f.rect(34, 44, 5, 2, shade)
    f.rect(57, 44, 5, 2, shade)
    return finish("rostam", f)


# --------------------------------------------------------------------- nahid
def nahid():
    f = Canvas(W, H)
    skin, shade = "dune", "terracotta"
    figure_base(f, skin, shade, "night")
    # lapels, gold buttons, epaulettes
    f.poly([(40, 68), (48, 80), (56, 68), (52, 96), (44, 96)], "stone")
    f.poly([(38, 68), (30, 96), (44, 96), (48, 80)], "ink")
    f.poly([(58, 68), (66, 96), (52, 96), (48, 80)], "ink")
    for y in (82, 88, 94):
        mirrored_rect(f, 40, y, 2, 2, "gold")
    f.ellipse(18, 84, 11, 5, "gold")
    f.ellipse(78, 84, 11, 5, "gold")
    f.hline(10, 26, 84, "dune")
    f.hline(70, 86, 84, "dune")
    # hair at the sides, under the cap
    f.rect(30, 30, 5, 16, "night")
    f.rect(61, 30, 5, 16, "night")
    # face (re-drawn on top of hair)
    f.ellipse(48, 42, 14.5, 17, skin)
    f.ellipse(48, 55, 9, 2, shade, only=lambda x, y: y >= 56)
    # sky-blue scarf at the neck, knotted, with hanging end
    f.ellipse(48, 66, 17, 6, "sky")
    f.rect(31, 66, 34, 2, "oasis")
    f.poly([(54, 68), (64, 70), (70, 92), (60, 90)], "sky")
    f.poly([(54, 68), (60, 69), (62, 90), (60, 90)], "oasis")
    f.hline(36, 58, 64, "cloth")
    f.ellipse(44, 69, 5, 4, "sky")
    f.hline(40, 46, 69, "cloth")
    # captain's cap
    f.poly([(24, 32), (28, 14), (68, 14), (72, 32)], "night")
    f.ellipse(48, 14, 22, 4, "night")
    f.rect(24, 26, 48, 6, "stone")  # band
    f.hline(24, 71, 26, "cloth")
    f.hline(24, 71, 31, "ink")
    f.ellipse(48, 33, 25, 3, "ink")  # visor
    f.hline(30, 66, 33, "night")
    f.ellipse(48, 20, 6, 5, "gold")  # anchor badge
    f.vline(48, 17, 24, "ink")
    f.hline(45, 50, 18, "ink")
    f.hline(45, 50, 23, "ink")
    f.put(45, 22, "ink")
    f.put(50, 22, "ink")
    # brows, eyes, smirk
    mirrored_rect(f, 39, 38, 6, 1, "night")
    mirrored_rect(f, 41, 41, 2, 3, "ink")
    mirrored_put(f, 41, 41, "cloth")
    f.rect(47, 46, 2, 3, shade)
    for x, y in ((43, 51), (44, 52), (45, 52), (46, 52), (47, 52), (48, 52), (49, 52), (50, 51), (51, 50)):
        f.put(x, y, "blood")
    f.put(52, 49, "ink")
    mirrored_rect(f, 37, 47, 3, 2, shade)
    return finish("nahid", f)


# -------------------------------------------------------------------- sohrab
def sohrab():
    f = Canvas(W, H)
    skin, shade = "sand", "dune"
    figure_base(f, skin, shade, "oasis")
    # robe with gold trim, inner night tunic
    f.poly([(40, 66), (48, 90), (56, 66), (60, 96), (36, 96)], "night")
    f.poly([(34, 66), (40, 66), (48, 90), (44, 96), (28, 96)], "oasis")
    f.poly([(62, 66), (56, 66), (48, 90), (52, 96), (68, 96)], "oasis")
    f.poly([(36, 66), (40, 66), (48, 90), (46, 90)], "gold")
    f.poly([(60, 66), (56, 66), (48, 90), (50, 90)], "gold")
    # gold chain with a coin
    for t in range(-8, 9):
        f.put(48 + t, 72 + (t * t) // 14, "gold")
    f.ellipse(48, 78, 3, 3, "gold")
    f.put(48, 78, "dune")
    # face (sharp, narrow)
    f.ellipse(48, 42, 14, 17.5, skin)
    f.ellipse(48, 55, 9, 2, shade, only=lambda x, y: y >= 56)
    # terracotta turban: layered wraps and a tail
    f.ellipse(48, 24, 23, 15, "terracotta")
    f.poly([(26, 28), (20, 52), (30, 60), (34, 36)], "terracotta")
    for i, y in enumerate((14, 19, 24, 29)):
        f.hline(30 - i, 66 + i, y, "blood")
    f.line(30, 30, 44, 12, "blood")
    f.line(40, 34, 60, 14, "blood")
    f.line(52, 34, 68, 20, "blood")
    f.ellipse(48, 33, 17, 3, "terracotta")  # brow band
    f.hline(32, 64, 35, "blood")
    f.ellipse(48, 20, 4, 4, "gold")  # brooch
    f.put(47, 19, "cloth")
    f.put(48, 22, "dune")
    # narrow, slanted eyes
    for dx in (0, 1, 2, 3, 4, 5):
        f.put(38 + dx, 41 - (1 if dx < 2 else 0), "ink")
        f.put(mx(38 + dx), 41 - (1 if dx < 2 else 0), "ink")
    mirrored_rect(f, 39, 42, 5, 1, "dune")
    mirrored_rect(f, 37, 37, 7, 1, "night")
    f.put(36, 36, "night")
    f.put(59, 36, "night")
    # nose, thin moustache and pointed goatee, smirk
    f.rect(47, 44, 2, 4, shade)
    f.hline(38, 56, 49, "night")
    for x, y in ((37, 50), (38, 51), (57, 50), (58, 51)):
        f.put(x, y, "night")
    f.rect(44, 52, 8, 1, "blood")
    f.put(52, 51, "blood")
    f.poly([(44, 56), (52, 56), (48, 64)], "night")
    return finish("sohrab", f)


PORTRAITS = {"golnar": golnar, "rostam": rostam, "nahid": nahid, "sohrab": sohrab}

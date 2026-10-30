"""The 256x64 "Caravan Road" logo: a camel silhouette in front of the sun,
the name in a 5x7 pixel font, and a dashed road underneath. Transparent background."""
from font5x7 import draw_text, text_width
from grid import Canvas

W, H = 256, 64


def _camel(c, ox, oy, color="ink"):
    """A standing dromedary silhouette, about 62x50 px, facing right."""
    legs = [(ox + 17, oy + 30, ox + 15, oy + 49), (ox + 23, oy + 30, ox + 24, oy + 49),
            (ox + 36, oy + 30, ox + 35, oy + 49), (ox + 42, oy + 30, ox + 44, oy + 49)]
    for x0, y0, x1, y1 in legs:
        c.line(x0, y0, x1, y1, color, r=1.2)
        c.rect(x1 - 2, y1 - 1, 5, 2, color)  # hooves
    c.ellipse(ox + 30, oy + 26, 19, 8, color)  # body
    c.ellipse(ox + 22, oy + 15, 6, 7, color)  # hump
    c.line(ox + 44, oy + 22, ox + 52, oy + 8, color, r=3.0)  # neck
    c.ellipse(ox + 55, oy + 6, 6.5, 4, color)  # head
    c.rect(ox + 58, oy + 5, 5, 4, color)  # muzzle
    c.line(ox + 12, oy + 24, ox + 9, oy + 38, color, r=0.8)  # tail


def logo():
    c = Canvas(W, H)
    ox, oy = 6, 5
    mid = ox + 31
    c.ellipse(mid, 30, 26, 26, "terracotta", only=lambda x, y: y <= 56)
    c.ellipse(mid, 30, 23, 23, "gold", only=lambda x, y: y <= 56)
    c.rect(4, 55, 70, 2, "dune")
    _camel(c, ox, oy)
    # text layer: terracotta drop shadow, then the letters, then a shared ink outline
    text = Canvas(W, H)
    scale, spacing = 3, 2
    w1 = text_width("CARAVAN", scale, spacing)
    w2 = text_width("ROAD", scale, spacing)
    tx = 90 + (156 - w1) // 2
    tx2 = 90 + (156 - w2) // 2
    draw_text(text, tx + 2, 6 + 2, "CARAVAN", "terracotta", scale, spacing)
    draw_text(text, tx2 + 2, 32 + 2, "ROAD", "terracotta", scale, spacing)
    draw_text(text, tx, 6, "CARAVAN", "gold", scale, spacing)
    draw_text(text, tx2, 32, "ROAD", "cloth", scale, spacing)
    text.outline("ink")
    c.paste(text)
    # dashed road under everything
    for x in range(6, 250, 10):
        c.rect(x, 59, 6, 2, "dune")
        c.rect(x, 61, 6, 1, "terracotta")
    return c.image()

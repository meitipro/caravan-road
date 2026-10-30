"""Caravan sheet (96x32 = two 48x32 frames): a camel pulling a covered cart.

The caravan faces right. Frame 2 differs from frame 1 by the leg pose and a
1px body bob.
"""
from grid import Canvas

FRAME_W, FRAME_H = 48, 32


def draw_camel(c, ox=0, oy=0, phase=0, body="dune", detail=True):
    """Draw a dromedary at offset (ox, oy). `body` recolours every part (silhouettes)."""
    bob = -1 if phase else 0
    dark = body if not detail else "terracotta"
    # legs first (behind the body)
    leg = {
        0: [((36, 22), (36, 29)), ((40, 22), (41, 29)), ((28, 22), (27, 29)), ((32, 22), (32, 29))],
        1: [((36, 22), (34, 29)), ((40, 22), (43, 29)), ((28, 22), (30, 29)), ((32, 22), (35, 29))],
    }[phase]
    for (x0, y0), (x1, y1) in leg:
        c.line(ox + x0, oy + y0, ox + x1, oy + y1, body, r=1.0)
        if detail:
            c.rect(ox + x1 - 1, oy + y1, 3, 2, "night")
    # body, hump, neck, head
    c.ellipse(ox + 33, oy + 18 + bob, 10, 5.5, body)
    c.ellipse(ox + 30, oy + 12 + bob, 3.5, 3.5, body)
    c.line(ox + 40, oy + 15 + bob, ox + 44, oy + 8 + bob, body, r=2.0)
    c.ellipse(ox + 45, oy + 7 + bob, 3.5, 2.5, body)
    c.rect(ox + 47, oy + 7 + bob, 1, 2, body)
    c.put(ox + 28, oy + 22 + bob, body)
    c.line(ox + 23, oy + 17 + bob, ox + 24, oy + 21 + bob, body)  # tail
    if detail:
        c.rect(ox + 28, oy + 13 + bob, 11, 2, "terracotta")  # saddle blanket
        c.hline(ox + 28, ox + 38, oy + 13 + bob, "gold")
        c.ellipse(ox + 30, oy + 10 + bob, 2.5, 1.5, "gold")  # pack on the hump
        c.put(ox + 46, oy + 6 + bob, "ink")  # eye
        c.hline(ox + 33, ox + 40, oy + 21 + bob, "terracotta")  # belly shade


def draw_cart(c, ox=0, oy=0, phase=0):
    bob = -1 if phase else 0
    # canopy (cover) with stripes
    c.ellipse(ox + 14, oy + 18 + bob, 12, 10, "cloth", only=lambda x, y: y <= oy + 18 + bob)
    for sx in (7, 11, 15, 19):
        c.vline(ox + sx, oy + 9 + bob, oy + 17 + bob, "terracotta")
    # bed
    c.rect(ox + 2, oy + 18 + bob, 24, 5, "dune")
    c.hline(ox + 2, ox + 25, oy + 18 + bob, "terracotta")
    # drawbar
    c.hline(ox + 25, ox + 27, oy + 21 + bob, "ink")
    # wheels (spokes rotate between frames)
    for wx in (8, 20):
        c.ellipse(ox + wx, oy + 26, 5, 5, "night")
        c.ellipse(ox + wx, oy + 26, 3.5, 3.5, "stone")
        c.ellipse(ox + wx, oy + 26, 1.2, 1.2, "night")
        if phase == 0:
            c.vline(ox + wx - 1, oy + 22, oy + 29, "night")
            c.hline(ox + wx - 4, ox + wx + 3, oy + 25, "night")
        else:
            c.line(ox + wx - 3, oy + 23, ox + wx + 2, oy + 28, "night")
            c.line(ox + wx + 2, oy + 23, ox + wx - 3, oy + 28, "night")


def frame(phase):
    layer = Canvas(FRAME_W, FRAME_H)
    draw_cart(layer, 0, 0, phase)
    draw_camel(layer, 0, 0, phase)
    layer.outline("ink")
    return layer


def caravan():
    sheet = Canvas(FRAME_W * 2, FRAME_H)
    sheet.paste(frame(0), 0, 0)
    sheet.paste(frame(1), FRAME_W, 0)
    return sheet.image()


def camel_silhouette(color="ink"):
    """The camel alone as a flat one-colour silhouette (used by the logo)."""
    layer = Canvas(FRAME_W, FRAME_H)
    draw_camel(layer, 0, 0, 0, body=color, detail=False)
    return layer

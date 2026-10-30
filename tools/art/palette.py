"""The 12-colour Caravan Road palette (spec-v1 section 2.15) plus transparent.

Every pixel written by tools/art must be one of these RGBA values.
"""

PALETTE_HEX = {
    "sand": "#E8D5A3",
    "dune": "#C99A52",
    "terracotta": "#A8503A",
    "night": "#1B1F2B",
    "ink": "#0F1118",
    "oasis": "#2F8F83",
    "sky": "#6FB1D6",
    "gold": "#E0A526",
    "leaf": "#5A8F3C",
    "blood": "#9C2F2F",
    "cloth": "#F2EAD3",
    "stone": "#7A7468",
}


def _rgba(hex_str):
    h = hex_str.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


PALETTE = {name: _rgba(h) for name, h in PALETTE_HEX.items()}
TRANSPARENT = (0, 0, 0, 0)

# One character per colour for grid.py sprites; "." is transparent.
CHARS = {
    ".": None,
    "S": "sand",
    "D": "dune",
    "T": "terracotta",
    "N": "night",
    "K": "ink",
    "O": "oasis",
    "Y": "sky",
    "G": "gold",
    "L": "leaf",
    "B": "blood",
    "C": "cloth",
    "R": "stone",
}

# Every RGBA value an output pixel may take.
ALLOWED_RGBA = frozenset(PALETTE.values()) | {TRANSPARENT}


def rgba(color):
    """Resolve a palette name, grid character, RGBA tuple or None to an RGBA tuple."""
    if color is None:
        return TRANSPARENT
    if isinstance(color, tuple):
        if color not in ALLOWED_RGBA:
            raise KeyError(f"colour not in palette: {color!r}")
        return color
    if color in PALETTE:
        return PALETTE[color]
    if color in CHARS:
        name = CHARS[color]
        return TRANSPARENT if name is None else PALETTE[name]
    raise KeyError(f"unknown palette colour: {color!r}")

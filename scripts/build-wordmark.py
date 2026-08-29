"""Turn the crbntyp wordmark into an SVG with the clip baked into geometry.

The mark used to be live text: Britanica at 48px with clip-path: inset(0 0 N%).
That percentage is of the *line box*, which has no fixed relationship to the
letterforms — at 48px the glyphs sit 6.1..45.8px inside a 48px box with a
21.6px x-height, so 36% removes 29% of the lowercase and 44% removes 47%. Any
change to font-size or line-height moves the cut, and if the webfont fails to
load, Arial's metrics put it somewhere else entirely.

As outlines the cut is part of the shape: it renders identically everywhere,
needs no font download (Britanica was loaded for this one word — 146KB of
woff/woff2), and can't drift.

    python3 scripts/build-wordmark.py [cut]

`cut` is how much of the lowercase letter height is removed from the bottom,
as a fraction: 0.29 cuts the bottom 29% away and keeps the top 71%. It is
measured against the x-height rather than the em box, which is the whole point
— that is a number you can reason about by looking at the mark.
"""

import sys
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.misc.transform import Transform

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / "src/fonts/britanica-extra-bold.woff2"
OUT = ROOT / "src/img/wordmark.svg"
TEXT = "crbntyp"

cut = float(sys.argv[1]) if len(sys.argv) > 1 else 0.29

font = TTFont(FONT)
upem = font["head"].unitsPerEm
cmap = font.getBestCmap()
glyphs = font.getGlyphSet()
hmtx = font["hmtx"]

# x-height: prefer the real metric, fall back to measuring the 'x' glyph.
xheight = getattr(font["OS/2"], "sxHeight", 0) or 0
if not xheight:
    from fontTools.pens.boundsPen import BoundsPen
    bp = BoundsPen(glyphs)
    glyphs[cmap[ord("x")]].draw(bp)
    xheight = bp.bounds[3]

# Kerning from the GPOS/kern table is not applied: this is one fixed word, and
# Britanica's default advances set it correctly. Worth revisiting only if the
# word ever changes.
pen_paths = []
x = 0
for ch in TEXT:
    name = cmap[ord(ch)]
    spen = SVGPathPen(glyphs)
    # Flip Y (font coordinates run up, SVG runs down) and shift to the pen
    # position. Baseline lands at y=0 in the output space.
    tpen = TransformPen(spen, Transform(1, 0, 0, -1, x, 0))
    glyphs[name].draw(tpen)
    d = spen.getCommands()
    if d:
        pen_paths.append(d)
    x += hmtx[name][0]

advance = x
cut_y = -(xheight * cut)           # above baseline, in flipped (SVG) space
top = -font["OS/2"].sTypoAscender  # top of the ascenders
height = cut_y - top

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{0} {top} {advance} {height}" role="img" aria-label="crbntyp">
  <title>crbntyp</title>
  <path fill="currentColor" d="{' '.join(pen_paths)}"/>
</svg>
'''

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(svg)

print(f"upem={upem} x-height={xheight} advance={advance}")
print(f"cutting the bottom {cut:.0%} of the lowercase — cut {cut_y:.0f}, top {top}, height {height:.0f}")
print(f"aspect ratio {advance/height:.3f}  →  {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes)")

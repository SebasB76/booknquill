# BookNQuill app icon: original 16x16 pixel art of a book and a quill.
import sys
W = H = 16
def grid(): return [[None]*W for _ in range(H)]
def rect(g, x0, y0, x1, y1, c):
    for y in range(y0, y1+1):
        for x in range(x0, x1+1): g[y][x] = c
def px(g, x, y, c):
    if 0 <= x < W and 0 <= y < H: g[y][x] = c
def quill(g, white, light, shade, ink, start=(14,1), length=11):
    sx, sy = start
    left = [0, 1, 2, 3, 3, 3, 2, 1]      # vane width on the left of the spine, per step
    for k in range(length):
        x, y = sx - k, sy + k
        if k < len(left):
            for i in range(1, left[k] + 1):
                notch = i == left[k] and k in (3, 5)
                px(g, x - i, y, light if notch else white)
            if 0 < k < 7: px(g, x + 1, y, shade)
            px(g, x, y, white if k == 0 else shade)   # grey spine reads as a feather, not a blade
        else:
            px(g, x, y, light)                         # bare stem
    x, y = sx - length, sy + length
    px(g, x, y, ink); px(g, x - 1, y + 1, ink)
def closed_book(g, cover, dark, light, page, page_sh, outline):
    rect(g, 1, 5, 11, 13, outline)
    rect(g, 2, 5, 11, 12, cover)
    rect(g, 2, 5, 3, 12, dark)                            # spine
    rect(g, 4, 5, 11, 5, light)                           # top highlight
    rect(g, 3, 13, 12, 13, page); rect(g, 12, 6, 12, 13, page)   # page edges
    rect(g, 4, 14, 13, 14, outline); rect(g, 13, 7, 13, 14, outline)
    for x in range(4, 12, 2): px(g, x, 13, page_sh)
    rect(g, 6, 8, 9, 8, light); rect(g, 6, 10, 8, 10, light)    # title lines
def open_book(g, cover, dark, page, page_sh, line, outline):
    rect(g, 0, 7, 15, 14, outline)
    rect(g, 1, 13, 14, 13, cover); rect(g, 0, 14, 15, 14, dark)
    rect(g, 1, 7, 7, 12, page); rect(g, 8, 7, 14, 12, page)
    rect(g, 7, 7, 8, 13, page_sh)                         # gutter
    for y in (8, 10): rect(g, 2, y, 5, y, line)
    rect(g, 9, 8, 13, 8, line)
    rect(g, 1, 6, 6, 6, outline); rect(g, 9, 6, 14, 6, outline)
    px(g, 7, 6, None); px(g, 8, 6, None)

icon = grid()
closed_book(icon, "#8a4a2a", "#5c2d18", "#b06a3e", "#ece6d6", "#b8ae98", "#2a1810")
quill(icon, "#f5f5f5", "#cfcfcf", "#8a8a8a", "#141414", start=(15, 0), length=10)

# 16x16 art on a 20x20 rounded tile, scaled with crisp edges.
pixels = "".join(f'<rect x="{x + 2}" y="{y + 2}" width="1" height="1" fill="{c}"/>'
                 for y, row in enumerate(icon) for x, c in enumerate(row) if c)
svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="1024" height="1024" shape-rendering="crispEdges">'
       '<rect width="20" height="20" rx="4.5" fill="#161616"/>' + pixels + '</svg>')
open(sys.argv[1] if len(sys.argv) > 1 else "icon.svg", "w").write(svg)

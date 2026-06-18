#!/usr/bin/env python3
"""Generate a 1024x1024 source icon for crawlie (a magnifier mark on a dark
rounded square). Run `pnpm tauri icon icons/source.png` afterwards to produce
the platform icon set. Pure-stdlib PNG writer — no Pillow needed."""
import math
import struct
import zlib

S = 1024
# colors (R,G,B,A)
BG = (23, 23, 23, 255)        # #171717
FG = (255, 255, 255, 255)     # white glyph
TRANSPARENT = (0, 0, 0, 0)

corner = 224
cx, cy = 430, 430             # magnifier centre
outer_r, inner_r = 232, 168   # ring radii
# handle segment
hx0, hy0, hx1, hy1 = 600, 600, 824, 824
handle_w = 78


def in_rounded(x, y):
    if corner <= x <= S - corner or corner <= y <= S - corner:
        return 0 <= x < S and 0 <= y < S
    for ccx, ccy in ((corner, corner), (S - corner, corner), (corner, S - corner), (S - corner, S - corner)):
        if (x < corner or x > S - corner) and (y < corner or y > S - corner):
            if math.hypot(x - ccx, y - ccy) <= corner:
                return True
    return False


def on_ring(x, y):
    d = math.hypot(x - cx, y - cy)
    return inner_r <= d <= outer_r


def on_handle(x, y):
    dx, dy = hx1 - hx0, hy1 - hy0
    L2 = dx * dx + dy * dy
    t = ((x - hx0) * dx + (y - hy0) * dy) / L2
    t = max(0.0, min(1.0, t))
    px, py = hx0 + t * dx, hy0 + t * dy
    return math.hypot(x - px, y - py) <= handle_w / 2 and math.hypot(x - cx, y - cy) > inner_r


def pixel(x, y):
    if not in_rounded(x, y):
        return TRANSPARENT
    if on_ring(x, y) or on_handle(x, y):
        return FG
    return BG


rows = bytearray()
for y in range(S):
    rows.append(0)  # filter type 0
    for x in range(S):
        rows.extend(pixel(x, y))

raw = zlib.compress(bytes(rows), 9)


def chunk(tag, data):
    out = struct.pack(">I", len(data)) + tag + data
    return out + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBBBBB", S, S, 8, 6, 0, 0, 0))
png += chunk(b"IDAT", raw)
png += chunk(b"IEND", b"")

with open(__file__.rsplit("/", 1)[0] + "/source.png", "wb") as f:
    f.write(png)
print("wrote source.png")

import json, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SS = 2
W, H = 2048 * SS, 1024 * SS
OUT = (2048, 1024)

def split_antimeridian(ring):
    """Yield lon/lat sub-paths with no edge spanning the +-180 seam."""
    cur = [ring[0]]
    for (lo1, la1), (lo2, la2) in zip(ring, ring[1:]):
        if abs(lo2 - lo1) > 180:                     # crosses the seam
            # interpolate latitude at the seam
            d = (lo2 - lo1) - math.copysign(360, lo2 - lo1)
            tcross = (math.copysign(180, lo1) - lo1) / d if d else 0.0
            la = la1 + (la2 - la1) * tcross
            cur.append((math.copysign(180, lo1), la))
            yield cur
            cur = [(math.copysign(180, lo2), la), (lo2, la2)]
        else:
            cur.append((lo2, la2))
    if len(cur) > 1:
        yield cur

def to_px(path):
    return [(((lo + 180.0) / 360.0) * W, ((90.0 - la) / 180.0) * H) for lo, la in path]

# ---------- collect edges (closed rings, seam-split) -------------------
land = json.load(open("land.json"))
polys = land["coordinates"] if land["type"] == "MultiPolygon" else [land["coordinates"]]

edges = []          # (x1,y1,x2,y2) in pixel space, for even-odd fill
coast_paths = []    # pixel paths for the coastline stroke
for poly in polys:
    for ring in poly:
        if len(ring) < 4:
            continue
        if ring[0] != ring[-1]:
            ring = list(ring) + [ring[0]]
        # fill edges: use the raw ring, wrapping lon into a continuous frame
        pts = to_px(ring)
        for a, b in zip(pts, pts[1:]):
            if abs(a[0] - b[0]) > W / 2:            # seam edge -> split into two
                xs = W if a[0] > b[0] else 0.0
                bx = b[0] + (W if a[0] > b[0] else -W)   # unwrapped b, same frame as a
                den = bx - a[0]
                t = 0.5 if den == 0 else (xs - a[0]) / den
                ym = a[1] + (b[1] - a[1]) * t
                edges.append((a[0], a[1], xs, ym))
                edges.append((W - xs, ym, b[0], b[1]))
            else:
                edges.append((a[0], a[1], b[0], b[1]))
        for sub in split_antimeridian(ring):
            coast_paths.append(to_px(sub))

E = np.asarray(edges, dtype=np.float64)
# Cast rays along LATITUDE (vertical, north->south), not longitude.
# A seam-split ring is open only along the x = 0 / x = W columns, so vertical
# parity is correct everywhere else; horizontal rays were wrong because the
# missing seam closure flipped parity for whole rows (the banding artefact).
ex1, ey1, ex2, ey2 = E[:, 0], E[:, 1], E[:, 2], E[:, 3]
keep = ex1 != ex2                      # vertical edges never cross a vertical ray
ex1, ey1, ex2, ey2 = ex1[keep], ey1[keep], ex2[keep], ey2[keep]
exlo, exhi = np.minimum(ex1, ex2), np.maximum(ex1, ex2)

mask = np.zeros((H, W), dtype=bool)
ys_all = np.arange(H) + 0.5
for col in range(W):
    xc = col + 0.5
    sel = (exlo <= xc) & (exhi > xc)
    if not sel.any():
        continue
    t = (xc - ex1[sel]) / (ex2[sel] - ex1[sel])
    yc = np.sort(ey1[sel] + (ey2[sel] - ey1[sel]) * t)
    mask[:, col] = (np.searchsorted(yc, ys_all, side="right") % 2) == 1

print("land fraction", mask.mean().round(4))

# ---------- colours ----------------------------------------------------
OCEAN_EQ   = np.array([ 26, 104, 224], np.float32)
OCEAN_POLE = np.array([  6,  26,  82], np.float32)
LAND_LO    = np.array([  7,  15,  34], np.float32)
LAND_HI    = np.array([ 18,  38,  78], np.float32)

lat = 90.0 - (np.arange(H) + 0.5) / H * 180.0
k = (np.cos(np.radians(lat)) ** 0.8)[:, None, None]
ocean = OCEAN_POLE + (OCEAN_EQ - OCEAN_POLE) * k
landc = LAND_LO + (LAND_HI - LAND_LO) * k

rgb = np.where(mask[..., None], landc, ocean).astype(np.float32)

# ---------- coastline glow (from the mask, so it always matches) -------
m = Image.fromarray((mask * 255).astype(np.uint8))
edge = np.asarray(m.filter(ImageFilter.MaxFilter(5))).astype(np.int16) - \
       np.asarray(m.filter(ImageFilter.MinFilter(5))).astype(np.int16)
edge = np.clip(edge, 0, 255).astype(np.uint8)
glow = np.asarray(Image.fromarray(edge).filter(ImageFilter.GaussianBlur(3 * SS))).astype(np.float32) / 255.0
core = edge.astype(np.float32) / 255.0
COAST = np.array([120, 208, 255], np.float32)
rgb = rgb + (COAST - rgb) * np.clip(core * 0.55 + glow * 0.30, 0, 1)[..., None]

img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))

# ---------- faint country borders --------------------------------------
d = ImageDraw.Draw(img, "RGBA")
borders = json.load(open("borders.json"))
for line in borders["coordinates"]:
    for sub in split_antimeridian(line):
        p = to_px(sub)
        if len(p) > 1:
            d.line(p, fill=(130, 190, 255, 90), width=max(1, SS))

img = img.resize(OUT, Image.LANCZOS)
img.save("earth-color.png", optimize=True)
img.convert("RGB").save("earth-color.webp", quality=88, method=6)
print("saved", img.size)

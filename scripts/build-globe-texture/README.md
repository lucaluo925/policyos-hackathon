# build-globe-texture

Generates `public/globe/earth-color.webp`, the equirectangular earth texture the
homepage globe (`src/components/globe/Globe3D.tsx`) samples.

The image is **ours**: it is rasterised here from public-domain Natural Earth
vector data, not copied from any site. Nothing at runtime depends on these
scripts — they exist so the asset can be regenerated or recoloured.

## Run

```bash
npm i --no-save world-atlas@2.0.2 topojson-client@3.1.0
node extract-geometry.mjs      # -> land.json, borders.json
python3 rasterize.py           # -> earth-color.png / earth-color.webp
cp earth-color.webp ../../public/globe/
```

Needs Python with `numpy` and `Pillow`.

## How it works

`extract-geometry.mjs` merges the 1:50m country polygons into a single land
MultiPolygon (so internal borders do not appear as coastline) and separately
extracts the country border mesh.

`rasterize.py` fills the land mask by **vertical** ray casting, one column at a
time, with even-odd parity.

The non-obvious part is the antimeridian. Polygon edges that jump from +179 to
-179 are split at the seam, which leaves each affected ring *open*. With
horizontal rays that open seam flips the parity of whole rows and the map comes
out with full-width bands across it. With vertical rays the only columns that
can be affected are x = 0 and x = W, so the fill is correct everywhere else.
This was an actual bug, not a hypothetical: see CODE_REVIEW.md.

Colour choices: ocean is bright blue and brightest at the equator, land is
near-black navy, coastlines get a soft cyan edge derived from the mask itself
(dilate minus erode, then blur) so the stroke can never drift away from the
fill. The shader reads land-vs-ocean straight off this image's luminance, so
keep land dark if you recolour it.

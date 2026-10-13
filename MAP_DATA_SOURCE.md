# Self-hosted map geometry

`/explore` uses `public/map/natural-earth-50m-basemap.geojson`, derived from
[Natural Earth Admin 0 countries at 1:50 million](https://github.com/nvkelso/natural-earth-vector/blob/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_50m_admin_0_countries.geojson).
The existing 1:110 million asset remains in the repository. The pinned source
SHA-256 values and reproducible transformation for both scales are in
`scripts/build-natural-earth-map.py`; run it with `--scale 50m` or `--scale
110m`. The 50m output retains only an ISO code when exactly one World Bank
directory coordinate falls inside a polygon; the deterministic offline join
can also be rerun with `scripts/map_country_join.py`. Unmatched and ambiguous
polygons remain visual context. The 50m geometry has
242 country/territory features, compared with 177 at 110m, and makes more
small places visible. Natural Earth describes its map data as
[public domain](https://www.naturalearthdata.com/about/terms-of-use/).

The geometry is visual context, not a determination of sovereignty, policy
jurisdiction or PolicyOS source coverage. Some small places are still absent
from the 50m polygons; the separately sourced World Bank directory supplies
217 economies and 211 point locations. Polygons with an unambiguous directory
match can be clicked to select a country, while markers and the directory
picker handle places without a polygon match. The map does not infer a policy
score from the polygon under a point.

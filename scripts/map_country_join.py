"""Attach a directory ISO only when its supplied point unambiguously lies in a polygon.

Natural Earth geometry and World Bank country/economy coordinates have different
scopes. An unmatched shape remains visual context rather than guessing its
jurisdiction from the nearest point or a name.
"""

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / "src/lib/data/country-directory.json"


def point_in_ring(point, ring):
    x, y = point
    inside = False
    previous = ring[-1]
    for current in ring:
        x1, y1 = current
        x2, y2 = previous
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
        previous = current
    return inside


def point_in_geometry(point, geometry):
    polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    return any(
        point_in_ring(point, polygon[0])
        and not any(point_in_ring(point, hole) for hole in polygon[1:])
        for polygon in polygons
    )


def add_unambiguous_iso(features):
    countries = json.loads(DIRECTORY.read_text())["countries"]
    points = [
        (country["iso"], (country["lon"], country["lat"]))
        for country in countries
        if country["lat"] is not None and country["lon"] is not None
    ]
    for feature in features:
        matches = [iso for iso, point in points if point_in_geometry(point, feature["geometry"])]
        feature["properties"] = {"iso": matches[0]} if len(matches) == 1 else {}
    return features


if __name__ == "__main__":
    path = ROOT / "public/map/natural-earth-50m-basemap.geojson"
    data = json.loads(path.read_text())
    add_unambiguous_iso(data["features"])
    path.write_text(json.dumps(data, separators=(",", ":")) + "\n")
    print(f"{sum(bool(feature['properties']) for feature in data['features'])} mapped polygons / {len(data['features'])} total")

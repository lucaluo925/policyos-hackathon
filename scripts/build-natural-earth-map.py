"""Make PolicyOS's self-hosted map geometry from pinned Natural Earth data."""

import argparse
import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen

from map_country_join import add_unambiguous_iso


SOURCE_COMMIT = "ca96624a56bd078437bca8184e78163e5039ad19"
SCALES = {
    "110m": {
        "sha256": "6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f",
        "features": 177,
    },
    "50m": {
        "sha256": "3e458fc036ad0a66411f2c1e6cac49c5d7bfb81cb1123bc513b22511a2b7fdeb",
        "features": 242,
    },
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--scale", choices=SCALES, default="50m")
    parser.add_argument("--source", type=Path, help="Use a downloaded source file instead of fetching it")
    args = parser.parse_args()
    source_url = (
        "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
        f"{SOURCE_COMMIT}/geojson/ne_{args.scale}_admin_0_countries.geojson"
    )
    output_path = Path(__file__).resolve().parents[1] / f"public/map/natural-earth-{args.scale}-basemap.geojson"
    if args.source:
        raw = args.source.read_bytes()
    else:
        with urlopen(Request(source_url, headers={"User-Agent": "PolicyOS-map-build"}), timeout=30) as response:
            raw = response.read()
    if hashlib.sha256(raw).hexdigest() != SCALES[args.scale]["sha256"]:
        raise SystemExit("Natural Earth source hash changed; inspect before rebuilding")
    source = json.loads(raw)
    if source.get("type") != "FeatureCollection" or len(source.get("features", [])) != SCALES[args.scale]["features"]:
        raise SystemExit("Unexpected Natural Earth feature collection")
    features = []
    for item in source["features"]:
        geometry = item.get("geometry")
        if not geometry or geometry.get("type") not in {"Polygon", "MultiPolygon"}:
            raise SystemExit("Unexpected map geometry")
        features.append({"type": "Feature", "properties": {}, "geometry": geometry})
    if args.scale == "50m":
        add_unambiguous_iso(features)
    output = {"type": "FeatureCollection", "features": features}
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, separators=(",", ":")) + "\n")
    data = output_path.read_bytes()
    print(json.dumps({"path": str(output_path), "features": len(features), "bytes": len(data),
                      "sha256": hashlib.sha256(data).hexdigest()}))


if __name__ == "__main__":
    main()

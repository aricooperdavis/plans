#!/usr/bin/env python3
"""
Scan a directory for *_cog.tif files, run `gdalinfo -json` on each,
and collect the wgs84Extent into a single plans.json file.

Usage:
    python3 build_plans_json.py [directory] [-o output.json]

If no directory is given, the current directory is used.
"""

import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BGS_API_URL = "https://ogcapi.bgs.ac.uk/collections/mine_plans/items"


def lookup_plan_info(plan_name: str, timeout: float = 15.0):
    """Look up plan info (title and feature_id) for a given
    plan name (filename stem) from the BGS OGC API. Returns a
    (title, feature_id) tuple, with None for any field not
    found / on error."""
    params = {
        "f": "json",
        "skipGeometry": "true",
        "sortby": "plan_title",
        "offset": "0",
        "limit": "1",
        "filter-lang": "cql-text",
        "filter": f"scan_url_comma_list LIKE '%id={plan_name}%'",
    }
    url = f"{BGS_API_URL}?{urllib.parse.urlencode(params)}"

    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError) as e:
        print(f"  ! API lookup failed for {plan_name}: {e}", file=sys.stderr)
        return None, None
    except json.JSONDecodeError as e:
        print(
            f"  ! Could not parse API lookup response for {plan_name}: {e}",
            file=sys.stderr,
        )
        return None, None

    features = data.get("features") or []
    if not features:
        print(f"  ! No plan info found for {plan_name}", file=sys.stderr)
        return None, None

    props = features[0]["properties"]
    return str(props.get("plan_title")), str(props.get("feature_id"))


def compact_json(obj, indent=2, level=0):
    """Pretty-print JSON with the given indent, but keep arrays whose
    elements are all scalars (numbers/strings/bools/None) on a single
    line -- e.g. coordinate pairs like [-5.234, 50.307] stay inline
    instead of exploding onto 4 lines each."""
    pad = " " * (indent * level)
    pad_in = " " * (indent * (level + 1))

    if isinstance(obj, dict):
        if not obj:
            return "{}"
        items = []
        for key, value in obj.items():
            items.append(
                f"{pad_in}{json.dumps(key)}: {compact_json(value, indent, level + 1)}"
            )
        return "{\n" + ",\n".join(items) + "\n" + pad + "}"

    if isinstance(obj, list):
        if not obj:
            return "[]"
        if all(isinstance(x, (int, float, str, bool)) or x is None for x in obj):
            return "[" + ", ".join(json.dumps(x) for x in obj) + "]"
        items = [f"{pad_in}{compact_json(x, indent, level + 1)}" for x in obj]
        return "[\n" + ",\n".join(items) + "\n" + pad + "]"

    return json.dumps(obj)


def get_wgs84_extent(tif_path: Path):
    """Run gdalinfo -json on a file and return the wgs84Extent coordinates
    as a flat list of [lon, lat] pairs (the outer ring)."""
    result = subprocess.run(
        ["gdalinfo", "-json", str(tif_path)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(
            f"  ! gdalinfo failed for {tif_path.name}: {result.stderr.strip()}",
            file=sys.stderr,
        )
        return None

    try:
        info = json.loads(result.stdout)
    except json.JSONDecodeError as e:
        print(
            f"  ! Could not parse gdalinfo output for {tif_path.name}: {e}",
            file=sys.stderr,
        )
        return None

    extent = info.get("wgs84Extent")
    if not extent:
        print(f"  ! No wgs84Extent found for {tif_path.name}", file=sys.stderr)
        return None

    coords = extent.get("coordinates")
    if not coords:
        print(
            f"  ! No coordinates found in wgs84Extent for {tif_path.name}",
            file=sys.stderr,
        )
        return None

    # Polygon coordinates are nested: [ [ [x, y], [x, y], ... ] ]
    # Take the outer ring.
    ring = coords[0]
    return [[pt[0], pt[1]] for pt in ring]


def main():
    parser = argparse.ArgumentParser(
        description="Build plans.json from *_cog.tif files using gdalinfo."
    )
    parser.add_argument(
        "directory",
        nargs="?",
        default=".",
        help="Directory to scan (default: current directory)",
    )
    parser.add_argument(
        "-o",
        "--output",
        default="plans.json",
        help="Output JSON file (default: plans.json)",
    )
    parser.add_argument(
        "--pattern",
        default="*_cog.tif",
        help="Glob pattern to match files (default: *_cog.tif)",
    )
    parser.add_argument(
        "--skip-lookup",
        action="store_true",
        help="Skip the BGS API lookup (title/feature_id will be null)",
    )
    args = parser.parse_args()

    directory = Path(args.directory)
    if not directory.is_dir():
        print(f"Error: {directory} is not a directory", file=sys.stderr)
        sys.exit(1)

    tif_files = sorted(directory.glob(args.pattern))
    if not tif_files:
        print(
            f"No files matching '{args.pattern}' found in {directory}", file=sys.stderr
        )
        sys.exit(1)

    plans = []
    for tif_path in tif_files:
        name = tif_path.name
        # Strip the _cog.tif suffix to get the plan name
        if name.lower().endswith("_cog.tif"):
            plan_name = name[: -len("_cog.tif")]
        else:
            plan_name = tif_path.stem

        print(f"Processing {name} ...")
        extent = get_wgs84_extent(tif_path)
        if extent is None:
            continue

        if args.skip_lookup:
            title, feature_id = None, None
        else:
            title, feature_id = lookup_plan_info(plan_name)

        plans.append(
            {
                "scan_url_id": plan_name,
                "plan_title": title,
                "feature_id": feature_id,
                "wgs84Extent": extent,
            }
        )

    output_path = Path(args.output)
    with open(output_path, "w") as f:
        f.write(compact_json({"plans": plans}))
        f.write("\n")

    print(f"\nWrote {len(plans)} plan(s) to {output_path}")


if __name__ == "__main__":
    main()

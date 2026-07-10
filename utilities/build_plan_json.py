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
from pathlib import Path


def get_wgs84_extent(tif_path: Path):
    """Run gdalinfo -json on a file and return the wgs84Extent coordinates
    as a flat list of [lon, lat] pairs (the outer ring)."""
    result = subprocess.run(
        ["gdalinfo", "-json", str(tif_path)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"  ! gdalinfo failed for {tif_path.name}: {result.stderr.strip()}", file=sys.stderr)
        return None

    try:
        info = json.loads(result.stdout)
    except json.JSONDecodeError as e:
        print(f"  ! Could not parse gdalinfo output for {tif_path.name}: {e}", file=sys.stderr)
        return None

    extent = info.get("wgs84Extent")
    if not extent:
        print(f"  ! No wgs84Extent found for {tif_path.name}", file=sys.stderr)
        return None

    coords = extent.get("coordinates")
    if not coords:
        print(f"  ! No coordinates found in wgs84Extent for {tif_path.name}", file=sys.stderr)
        return None

    # Polygon coordinates are nested: [ [ [x, y], [x, y], ... ] ]
    # Take the outer ring.
    ring = coords[0]
    return [[pt[0], pt[1]] for pt in ring]


def main():
    parser = argparse.ArgumentParser(description="Build plans.json from *_cog.tif files using gdalinfo.")
    parser.add_argument("directory", nargs="?", default=".", help="Directory to scan (default: current directory)")
    parser.add_argument("-o", "--output", default="plans.json", help="Output JSON file (default: plans.json)")
    parser.add_argument("--pattern", default="*_cog.tif", help="Glob pattern to match files (default: *_cog.tif)")
    args = parser.parse_args()

    directory = Path(args.directory)
    if not directory.is_dir():
        print(f"Error: {directory} is not a directory", file=sys.stderr)
        sys.exit(1)

    tif_files = sorted(directory.glob(args.pattern))
    if not tif_files:
        print(f"No files matching '{args.pattern}' found in {directory}", file=sys.stderr)
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

        plans.append({"name": plan_name, "wgs84Extent": extent})

    output_path = Path(args.output)
    with open(output_path, "w") as f:
        json.dump({"plans": plans}, f, indent=2)

    print(f"\nWrote {len(plans)} plan(s) to {output_path}")


if __name__ == "__main__":
    main()

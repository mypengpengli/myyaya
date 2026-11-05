"""Replay local navigation depth captures; no network or third-party packages.

python scripts/analyze-depth-evidence.py capture.ndjson --frame 3 --csv points.csv
Coordinates use the ARCore GPU texture, before Android display crop/rotation.
"""
import argparse
import base64
import csv
import json
import math
import statistics
import struct
from pathlib import Path


def points(row, image):
    values = struct.unpack("<" + "H" * (image["width"] * image["height"]),
                           base64.b64decode(image["u16leBase64"], validate=True))
    fx, fy, cx, cy = row["intrinsics"]
    tw, th = row["textureDimensions"]
    dx, dy = image["sourceWidth"] / tw, image["sourceHeight"] / th
    qx, qy, qz, qw = row["cameraQuaternion"]
    tx, ty, tz = row["cameraTranslation"]
    origin, normal = row["planeOrigin"], row["planeNormal"]
    for i, mm in enumerate(values):
        if not 200 <= mm <= 4000:
            continue
        u, v = (i % image["width"]) * image["step"], (i // image["width"]) * image["step"]
        d = mm / 1000
        x, y, z = d * (u - cx * dx) / (fx * dx), d * (cy * dy - v) / (fy * dy), -d
        ax, ay, az = qy * z - qz * y, qz * x - qx * z, qx * y - qy * x
        bx, by, bz = qy * az - qz * ay, qz * ax - qx * az, qx * ay - qy * ax
        p = (x + 2 * qw * ax + 2 * bx + tx, y + 2 * qw * ay + 2 * by + ty,
             z + 2 * qw * az + 2 * bz + tz)
        h = sum((a - b) * n for a, b, n in zip(p, origin, normal))
        yield (u / image["sourceWidth"], v / image["sourceHeight"], *p, h)


def summarize(values):
    heights = sorted(p[-1] for p in values)
    return {"points": len(heights), "planePoints": sum(abs(h) <= .025 for h in heights),
            "heightMedianMeters": statistics.median(heights) if heights else None,
            "heightP05Meters": heights[int((len(heights) - 1) * .05)] if heights else None,
            "heightP95Meters": heights[int((len(heights) - 1) * .95)] if heights else None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture", type=Path)
    parser.add_argument("--frame", type=int)
    parser.add_argument("--csv", type=Path)
    args = parser.parse_args()
    rows = [json.loads(line) for line in args.capture.read_text(encoding="utf-8").splitlines() if line.strip()]
    selected = enumerate(rows) if args.frame is None else [(args.frame, rows[args.frame])]
    csv_rows = []
    for i, row in selected:
        result = {"frame": i, "frameNs": row["frameNs"], "fusion": row.get("fusion"), "sources": {}}
        for source in ("raw", "dense"):
            image = row.get(source)
            if image is None:
                continue
            cloud = list(points(row, image))
            tiles = {}
            for y in range(3):
                for x in range(3):
                    tiles[f"{x},{y}"] = summarize([p for p in cloud if int(p[0] * 3) == x and int(p[1] * 3) == y])
            result["sources"][source] = dict(summarize(cloud), tiles=tiles)
            if args.csv:
                csv_rows.extend((i, source, *p) for p in cloud)
        print(json.dumps(result, ensure_ascii=False))
    if args.csv:
        with args.csv.open("w", newline="", encoding="utf-8") as output:
            writer = csv.writer(output)
            writer.writerow(["frame", "source", "textureU", "textureV", "mapX", "mapY", "mapZ", "planeResidualMeters"])
            writer.writerows(csv_rows)


if __name__ == "__main__":
    main()

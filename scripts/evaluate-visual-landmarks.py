"""Evaluate saved SIFT landmarks against their own photos and other saved views.

Requires numpy and opencv-python-headless. Input is a version 2 .landmarks file
copied from navigation-probe/visual-evidence on the phone. No phone or motors
are involved. Self-image checks and cross-view checks are reported separately.
"""
import argparse
import base64
import json
from pathlib import Path

import cv2
import numpy as np


def rotation(quaternion):
    x, y, z, w = quaternion
    return np.array([
        [1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
        [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
        [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)],
    ], dtype=np.float64)


def evaluate(reference, query):
    query_features, query_descriptors = query["features"]
    result = {"reference": reference["index"], "query": query["index"],
              "selfImage": reference is query, "status": "DESCRIPTORS"}
    if query_descriptors is None or len(query_descriptors) < 2:
        return result
    matcher = cv2.FlannBasedMatcher(dict(algorithm=1, trees=4), dict(checks=32))
    candidates = matcher.knnMatch(reference["descriptors"], query_descriptors, k=2)
    good = [a for pair in candidates if len(pair) == 2
            for a, b in [pair] if a.distance < 300 and a.distance < .75*b.distance]
    pairs = []
    used = set()
    for match in sorted(good, key=lambda m: m.distance):
        if match.trainIdx not in used:
            used.add(match.trainIdx)
            pairs.append(match)
    result["matches"] = len(pairs)
    if len(pairs) < 16:
        return result
    xyz = np.array([reference["points"][m.queryIdx] for m in pairs], np.float64)
    pixels = np.array([query_features[m.trainIdx].pt for m in pairs], np.float64)
    fx, fy, cx, cy = query["intrinsics"]
    camera = np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1]], np.float64)
    ok, rvec, tvec, inliers = cv2.solvePnPRansac(
        xyz, pixels, camera, None, iterationsCount=150,
        reprojectionError=3, confidence=.995, flags=cv2.SOLVEPNP_EPNP)
    if not ok or inliers is None:
        return result | {"status": "PNP"}
    ids = inliers.ravel()
    result["inliers"] = len(ids)
    if len(ids) < 12 or len(ids) < len(pairs)*.55:
        return result | {"status": "INLIERS"}
    bins = {(int(pixels[n, 0]/query["width"]*3),
             int(pixels[n, 1]/query["height"]*3)) for n in ids}
    predicted, _ = cv2.projectPoints(xyz, rvec, tvec, camera, None)
    error = np.linalg.norm(predicted.reshape(-1, 2)[ids]-pixels[ids], axis=1).mean()
    camera_from_map, _ = cv2.Rodrigues(rvec)
    position = (-camera_from_map.T @ tvec).ravel()
    orientation = camera_from_map.T @ np.diag([1, -1, -1])
    expected = rotation(query["q"])
    angle = np.degrees(np.arccos(np.clip((np.trace(expected.T @ orientation)-1)/2, -1, 1)))
    positive = ((xyz[ids] @ camera_from_map.T + tvec.ravel())[:, 2] > .10).mean()
    result |= {"imageBins": len(bins), "reprojectionPixels": float(error),
               "positionErrorMeters": float(np.linalg.norm(position-query["t"])),
               "orientationErrorDegrees": float(angle)}
    if len(bins) < 4:
        return result | {"status": "IMAGE_COVERAGE"}
    if positive < .95:
        return result | {"status": "CHEIRALITY"}
    if error > 2 or np.abs(position).max() > 25:
        return result | {"status": "REPROJECTION"}
    return result | {"status": "GEOMETRY_PASSED"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("landmarks", type=Path)
    args = parser.parse_args()
    data = json.loads(args.landmarks.read_text(encoding="utf-8"))
    if data.get("version") != 2:
        parser.error("Expected SIFT landmark version 2")
    frames = []
    detector = cv2.SIFT_create(900)
    for index, row in enumerate(data["frames"]):
        image = cv2.imdecode(np.frombuffer(base64.b64decode(row["captureJpeg"]), np.uint8), cv2.IMREAD_GRAYSCALE)
        if image is None or image.shape != (row["height"], row["width"]):
            parser.error(f"Invalid photo dimensions in frame {index}")
        descriptors = np.frombuffer(base64.b64decode(row["descriptors"]), dtype="<f4").reshape(-1, 128).copy()
        if len(descriptors) != len(row["points"]):
            parser.error(f"Descriptor/landmark count mismatch in frame {index}")
        frames.append(row | {"index": index, "descriptors": descriptors,
                             "features": detector.detectAndCompute(image, None)})
    for reference in frames:
        for query in frames:
            print(json.dumps(evaluate(reference, query)), flush=True)


if __name__ == "__main__":
    main()

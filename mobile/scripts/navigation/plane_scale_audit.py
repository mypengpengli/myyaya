"""Offline known-rectangle check for the minimum, nearly horizontal camera pose.

Corners must follow far-left, far-right, near-right, near-left around a flat rectangle.
The result is a geometric estimate, not permission to drive or a persistent phone calibration.
Requires numpy and opencv-python-headless; no network or motor calls.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def estimate(corners, camera_matrix, width, length, max_rms_pixels=2.0):
    pixels = np.asarray(corners, dtype=np.float64)
    matrix = np.asarray(camera_matrix, dtype=np.float64)
    if (pixels.shape != (4, 2) or matrix.shape != (3, 3)
            or not np.isfinite(pixels).all() or not np.isfinite(matrix).all()
            or matrix[0, 0] <= 0 or matrix[1, 1] <= 0 or not np.allclose(matrix[2], [0, 0, 1])
            or not 0.03 <= width <= 2 or not 0.03 <= length <= 2):
        raise ValueError('Invalid rectangle dimensions, corners or camera intrinsics')
    contour = pixels.astype(np.float32).reshape(-1, 1, 2)
    if not cv2.isContourConvex(contour) or cv2.contourArea(contour) < 100:
        raise ValueError('Four distinct ordered rectangle corners are required')
    obj = np.array([[0, 0, 0], [width, 0, 0], [width, length, 0], [0, length, 0]], np.float64)
    _, rotations, translations, _ = cv2.solvePnPGeneric(obj, pixels, matrix, None, flags=cv2.SOLVEPNP_IPPE)
    candidates = []
    for rotation, translation in zip(rotations, translations):
        rotation, translation = cv2.solvePnPRefineLM(obj, pixels, matrix, None, rotation, translation)
        basis, _ = cv2.Rodrigues(rotation)
        normal = basis[:, 2]
        height = float(normal @ translation.ravel())
        projected, _ = cv2.projectPoints(obj, rotation, translation, matrix, None)
        errors = np.linalg.norm(projected.reshape(-1, 2) - pixels, axis=1)
        rms = float(np.sqrt(np.mean(errors ** 2)))
        front = bool(np.all((obj @ basis.T + translation.ravel())[:, 2] > 0))
        # Near-horizontal camera is an explicit operator assumption, not an ARCore tracking claim.
        usable = bool(front and normal[1] > np.cos(np.deg2rad(20)) and 0.03 <= height <= 0.5
                      and rms <= max_rms_pixels and float(errors.max()) <= max_rms_pixels * 2)
        candidates.append(dict(heightMeters=height, rmsPixels=rms, maxErrorPixels=float(errors.max()),
                               normalCamera=normal.tolist(), cameraPositionInRectangleMeters=(-basis.T @ translation.ravel()).tolist(),
                               positiveDepth=front, geometricFitValid=usable))
    valid = sorted([c for c in candidates if c['geometricFitValid']], key=lambda c: c['rmsPixels'])
    return dict(geometricFitValid=bool(valid), selected=valid[0] if valid else None, candidates=candidates,
                paperDimensionsMeters=[width, length], maxRmsPixels=max_rms_pixels,
                autonomousMotionAuthorized=False, assumption='flat known rectangle; near-horizontal camera; correct CPU intrinsics')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, help='JSON: imagePoints, imageFocalLength, imagePrincipalPoint')
    parser.add_argument('--width', type=float, default=0.21)
    parser.add_argument('--length', type=float, default=0.297)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    source = json.loads(Path(args.input).read_text(encoding='utf-8'))
    fx, fy = source['imageFocalLength']; cx, cy = source['imagePrincipalPoint']
    result = estimate(source['imagePoints'], [[fx, 0, cx], [0, fy, cy], [0, 0, 1]], args.width, args.length)
    Path(args.output).write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, indent=2))

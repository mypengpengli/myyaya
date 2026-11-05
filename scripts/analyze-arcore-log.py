#!/usr/bin/env python3
"""Summarize ARCore native faults from an adb logcat capture; never upload logs.

Capture only the relevant app process, for example:
  adb logcat --pid=<PID> -d -v threadtime > .tools/arcore-local.log
  python scripts/analyze-arcore-log.py .tools/arcore-local.log

Counts are log-line counts, not independent failed frames. One native failure
can generate several stack/status lines. A matching report on another device
does not establish the cause on this device.
"""
import argparse
import json
import re
from pathlib import Path


def summarize(text):
    lines = text.splitlines()
    offsets = [float(value) for value in re.findall(
        r"Camera to IMU clock offset \(([-\d.]+)ms\)", text)]
    summaries = [line for line in lines if "IndependentArDepth" in line]
    medians = [int(value) for line in summaries for value in re.findall(r"medianMm=(\d+)", line)]
    return {
        "logLines": len(lines),
        "rectifierFailureLines": sum("Only kUnrectifiedOriginal is supported for ComputeDisparity" in line for line in lines),
        "cameraImuDesyncLines": sum("[FEATURE_DSP_CAM_IMU_DESYNC]" in line for line in lines),
        "cameraImuOffsetMs": {
            "count": len(offsets),
            "min": min(offsets) if offsets else None,
            "max": max(offsets) if offsets else None,
        },
        "vioResetLines": sum("[VIO_RESET]" in line for line in lines),
        "androidRuntimeFatalLines": sum("FATAL EXCEPTION" in line for line in lines),
        "independentSample": {
            "reports": len(summaries),
            "trackingReports": sum("tracking=TRACKING" in line for line in summaries),
            "depthUnavailableReports": sum("NotYetAvailableException" in line for line in summaries),
            "positiveMedianReports": sum(value > 0 for value in medians),
            "medianMmMin": min(medians) if medians else None,
            "medianMmMax": max(medians) if medians else None,
        },
        "interpretation": "Native fault evidence; not a metric-accuracy test or a confirmed device-profile diagnosis.",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("log", type=Path)
    args = parser.parse_args()
    print(json.dumps(summarize(args.log.read_text(encoding="utf-8-sig", errors="replace")), indent=2))

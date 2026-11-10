"""Summarize local v1/v2 depth captures, including missing/unready inputs; emits no motion."""
import argparse
import base64
import collections
import json
import struct
from pathlib import Path


def summarize(rows):
    if not 1 <= len(rows) <= 360 or any(r.get('schemaVersion') not in (1, 2) for r in rows):
        raise ValueError('Expected 1..360 schemaVersion 1 or 2 records')
    result = {'frames': len(rows), 'navigationReadyFrames': 0, 'pairedNearFrames': 0,
              'raw': collections.Counter(), 'smooth': collections.Counter(),
              'fusionReasons': collections.Counter(), 'autonomousMotionAuthorized': False}
    for row in rows:
        near = []
        for source, key, timestamp in [('raw', 'raw', 'rawNs'), ('smooth', 'dense', 'denseNs')]:
            counts = result[source]
            image = row.get(key)
            if image is None:
                counts['missingFrames'] += 1
                near.append(False)
                continue
            raw = base64.b64decode(image['u16leBase64'], validate=True)
            pixels = image['width'] * image['height']
            if len(raw) != pixels * 2:
                raise ValueError('Depth image byte count does not match dimensions')
            values = struct.unpack('<' + 'H' * pixels, raw)
            local = sum(200 <= value <= 4000 for value in values)
            counts['availableFrames'] += 1
            counts['emptyFrames'] += not any(values)
            counts['nearFrames'] += local > 0
            counts['nearPixelsTotal'] += local
            counts['freshFrames'] += row.get(timestamp, 0) > 0 and 0 <= row['frameNs'] - row[timestamp] <= 250_000_000
            near.append(local > 0)
        result['pairedNearFrames'] += all(near)
        fusion = row.get('fusion', {})
        result['fusionReasons'][fusion.get('status', 'UNKNOWN')] += 1
        result['navigationReadyFrames'] += fusion.get('navigationEvidenceEnabled') is True
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = summarize([json.loads(line) for line in args.input.read_text(encoding='utf-8').splitlines() if line.strip()])
    text = json.dumps(result, indent=2)
    if args.output:
        args.output.write_text(text + '\n', encoding='utf-8')
    print(text)

import base64
import struct
import unittest

from summarize_depth_capture import summarize


def image(values):
    return {'width': len(values), 'height': 1,
            'u16leBase64': base64.b64encode(struct.pack('<' + 'H' * len(values), *values)).decode()}


class CaptureSummaryTest(unittest.TestCase):
    def test_missing_raw_does_not_hide_useful_smooth_or_authorize_motion(self):
        row = {'schemaVersion': 2, 'frameNs': 1_000_000_000, 'rawNs': 0, 'denseNs': 950_000_000,
               'raw': None, 'dense': image([0, 300, 600, 12000]),
               'fusion': {'status': 'RAW_UNAVAILABLE', 'navigationEvidenceEnabled': False}}
        result = summarize([row])
        self.assertEqual(result['raw']['missingFrames'], 1)
        self.assertEqual(result['smooth']['nearPixelsTotal'], 2)
        self.assertEqual(result['smooth']['freshFrames'], 1)
        self.assertEqual(result['pairedNearFrames'], 0)
        self.assertEqual(result['navigationReadyFrames'], 0)
        self.assertFalse(result['autonomousMotionAuthorized'])

    def test_empty_images_are_distinct_from_missing_and_stale(self):
        row = {'schemaVersion': 2, 'frameNs': 1_000_000_000, 'rawNs': 100_000_000, 'denseNs': 1_100_000_000,
               'raw': image([0, 0]), 'dense': image([0, 0]), 'fusion': {}}
        result = summarize([row])
        for source in ['raw', 'smooth']:
            self.assertEqual(result[source]['emptyFrames'], 1)
            self.assertEqual(result[source]['freshFrames'], 0)
            self.assertEqual(result[source]['availableFrames'], 1)

    def test_v1_records_remain_readable(self):
        row = {'schemaVersion': 1, 'frameNs': 1_000_000_000, 'rawNs': 950_000_000, 'denseNs': 0,
               'raw': image([300]), 'dense': None, 'fusion': {'status': 'RAW_ONLY_UNAVAILABLE'}}
        self.assertEqual(summarize([row])['raw']['nearFrames'], 1)

    def test_bad_size_or_unbounded_records_are_rejected(self):
        with self.assertRaises(ValueError):
            summarize([])
        row = {'schemaVersion': 2, 'frameNs': 1, 'raw': image([300])}
        row['raw']['width'] = 2
        with self.assertRaises(ValueError):
            summarize([row])


if __name__ == '__main__':
    unittest.main()

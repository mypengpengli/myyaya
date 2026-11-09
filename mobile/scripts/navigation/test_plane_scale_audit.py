import unittest
import cv2
import numpy as np
from plane_scale_audit import estimate


class PlaneScaleAuditTest(unittest.TestCase):
    matrix = np.array([[448., 0, 303.], [0, 450., 235.], [0, 0, 1.]])

    def image(self):
        obj = np.array([[0., 0, 0], [.21, 0, 0], [.21, .297, 0], [0, .297, 0]])
        rotation, _ = cv2.Rodrigues(np.array([[1., 0, 0], [0, 0, 1.], [0, -1., 0]]))
        pixels, _ = cv2.projectPoints(obj, rotation, np.array([-.105, .1, .6]), self.matrix, None)
        return pixels.reshape(-1, 2)

    def test_known_ten_centimeter_height_is_recovered_in_meters(self):
        result = estimate(self.image(), self.matrix, .21, .297)
        self.assertTrue(result['geometricFitValid'])
        self.assertAlmostEqual(.1, result['selected']['heightMeters'], places=5)
        self.assertFalse(result['autonomousMotionAuthorized'])

    def test_bad_corner_and_swapped_dimensions_do_not_publish_height(self):
        pixels = self.image(); pixels[0] += [30, -25]
        self.assertIsNone(estimate(pixels, self.matrix, .21, .297)['selected'])
        self.assertIsNone(estimate(self.image(), self.matrix, .297, .21)['selected'])

    def test_crossed_corners_and_invalid_intrinsics_are_rejected(self):
        with self.assertRaises(ValueError):
            estimate(self.image()[[0, 2, 1, 3]], self.matrix, .21, .297)
        matrix = self.matrix.copy(); matrix[1, 1] = 0
        with self.assertRaises(ValueError):
            estimate(self.image(), matrix, .21, .297)


if __name__ == '__main__':
    unittest.main()

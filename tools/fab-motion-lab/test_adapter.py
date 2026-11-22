"""Executable smoke tests for the FAB world-NPZ adapter (synthetic fixture)."""
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from fab_npz_to_json import convert


class AdapterTests(unittest.TestCase):
    def test_shape_time_contacts_and_stride(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "sample.npz"
            pts = np.zeros((8, 24, 3), dtype=float)
            pts[:, :, 2] = 1.0
            pts[3] = np.nan  # invalid model prediction; should be held
            valid = np.ones(8, dtype=bool)
            valid[3] = False
            contacts = json.dumps({"lfoot": [1] * 8, "rfoot": [0] * 8})
            np.savez_compressed(path, joints=pts, fps=30.0, valid=valid,
                                frames=np.arange(8), contacts=contacts)
            out = convert(path)
            self.assertEqual(out["format"], "fab-smpl24-joints-v1")
            self.assertEqual(len(out["frames"]), 8)
            self.assertEqual(len(out["frames"][0]["j"]), 24)
            self.assertEqual(out["frames"][3]["j"], out["frames"][2]["j"])
            self.assertFalse(out["frames"][3]["valid"])
            self.assertEqual(out["frames"][4]["c"]["rfoot"], 0)
            reduced = convert(path, stride=2, max_frames=3)
            self.assertEqual(len(reduced["frames"]), 3)
            self.assertEqual(reduced["fps"], 15.0)
            self.assertAlmostEqual(reduced["frames"][2]["time"], 4 / 30)

    def test_invalid_input(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "broken.npz"
            np.savez(path, joints=np.zeros((2, 20, 3)))
            with self.assertRaisesRegex(ValueError, "Expected joints"):
                convert(path)
            with self.assertRaisesRegex(ValueError, "stride"):
                convert(path, stride=0)


if __name__ == "__main__":
    unittest.main()

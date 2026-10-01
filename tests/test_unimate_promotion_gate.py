from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools/unimate/evaluate-neural-foundry.py"
SPEC = importlib.util.spec_from_file_location("unimate_promotion_gate", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def strike(action: str, provider: str, travel: float = 0.50, drift: float = 1e-6, impact: int = 21):
    return {
        "action": action,
        "fps": 60,
        "startFrame": 1,
        "endFrame": 42,
        "impactFrame": impact,
        "boneCount": 65,
        "motionPriorProvider": provider,
        "strikeHandTravel": travel,
        "supportFootLockMaxDrift": drift,
        "torsoTwistDegrees": 30.0,
        "unimateInbetweenAccepted": True,
        "unimateMaximumAnchorRotationError": 0.0,
        "unimateMaximumAnchorLocationError": 0.0,
    }


class UniMatePromotionGateTests(unittest.TestCase):
    def evaluate(self, baseline, candidate, quality, kind="strike"):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            baseline_path = root / "baseline.json"
            candidate_path = root / "candidate.json"
            quality_dir = root / "quality"
            quality_dir.mkdir()
            baseline_path.write_text(json.dumps(baseline))
            candidate_path.write_text(json.dumps(candidate))
            actions = MODULE.action_map(baseline)
            for action in actions:
                (quality_dir / f"{action}.json").write_text(json.dumps(quality[action]))
            return MODULE.evaluate_group(
                baseline_path,
                candidate_path,
                quality_dir,
                kind,
            )

    def test_accepts_smoother_semantically_equivalent_strike(self):
        base = strike("BF_Cross_R", "UAL_AUTHORED_STRIKE_V2")
        cand = strike("BF_Cross_R", "UNIMATE_UAL_BVH_REPLACEMENT_V1", travel=0.49)
        quality = {
            "BF_Cross_R": {
                "accepted": True,
                "ratios": {
                    "rotationStepRms": 0.99,
                    "rotationAccelerationRms": 0.94,
                    "maxRotationStepRad": 0.96,
                },
            }
        }
        report = self.evaluate(base, cand, quality)
        self.assertTrue(report["accepted"])
        self.assertTrue(all(item["accepted"] for item in report["moves"]))

    def test_rejects_contact_timing_or_smoothness_regression(self):
        base = strike("BF_Cross_R", "UAL_AUTHORED_STRIKE_V2")
        cand = strike(
            "BF_Cross_R",
            "UNIMATE_UAL_BVH_REPLACEMENT_V1",
            travel=0.30,
            impact=24,
        )
        quality = {
            "BF_Cross_R": {
                "accepted": False,
                "ratios": {
                    "rotationStepRms": 1.09,
                    "rotationAccelerationRms": 1.18,
                    "maxRotationStepRad": 1.12,
                },
            }
        }
        report = self.evaluate(base, cand, quality)
        self.assertFalse(report["accepted"])
        failed = {
            check["name"]
            for move in report["moves"]
            for check in move["checks"]
            if not check["passed"]
        }
        self.assertIn("impactFrame_unchanged", failed)
        self.assertIn("strike_reach_retained", failed)
        self.assertIn("glb_rotation_quality_gate", failed)

    def test_rejects_unreviewed_extra_action_in_shipping_pack(self):
        base_move = strike("BF_Jab_L", "UAL_AUTHORED_STRIKE_V2", impact=17)
        candidate_move = strike("BF_Jab_L", "UNIMATE_UAL_BVH_REPLACEMENT_V1", impact=17)
        counter = strike("BF_Counter_R", "UNIMATE_UAL_BVH_REPLACEMENT_V1", impact=18)
        baseline = {"moves": [base_move]}
        candidate = {"moves": [candidate_move, counter]}
        quality = {
            "BF_Jab_L": {
                "accepted": True,
                "ratios": {
                    "rotationStepRms": 0.98,
                    "rotationAccelerationRms": 0.95,
                    "maxRotationStepRad": 0.97,
                },
            }
        }
        report = self.evaluate(baseline, candidate, quality)
        self.assertFalse(report["accepted"])
        self.assertEqual(report["unexpectedActions"], ["BF_Counter_R"])


if __name__ == "__main__":
    unittest.main()

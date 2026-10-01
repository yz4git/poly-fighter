#!/usr/bin/env python3
"""Evaluate UniMate neural Foundry packs against currently shipping motion metrics."""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any


def action_map(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    moves = data.get("moves")
    if isinstance(moves, list):
        return {str(move["action"]): move for move in moves if isinstance(move, dict) and move.get("action")}
    if data.get("action"):
        return {str(data["action"]): data}
    return {}


def number(data: dict[str, Any], key: str, default: float | None = None) -> float | None:
    value = data.get(key, default)
    return float(value) if isinstance(value, (int, float)) and math.isfinite(float(value)) else default


def add(checks: list[dict[str, Any]], name: str, passed: bool, actual: Any, limit: Any) -> None:
    checks.append({"name": name, "passed": bool(passed), "actual": actual, "limit": limit})


def common_checks(base: dict[str, Any], cand: dict[str, Any], quality: dict[str, Any]) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    add(checks, "action_identity", cand.get("action") == base.get("action"), cand.get("action"), base.get("action"))
    for key in ("fps", "startFrame", "endFrame", "impactFrame"):
        add(checks, f"{key}_unchanged", cand.get(key) == base.get(key), cand.get(key), base.get(key))
    add(checks, "canonical_bone_count", int(cand.get("boneCount", 0)) >= 40, cand.get("boneCount"), ">=40")
    add(
        checks,
        "provider_is_unimate_neural",
        cand.get("motionPriorProvider") == "UNIMATE_UAL_BVH_REPLACEMENT_V1",
        cand.get("motionPriorProvider"),
        "UNIMATE_UAL_BVH_REPLACEMENT_V1",
    )
    if "unimateInbetweenAccepted" in cand:
        add(checks, "deterministic_cleanup_accepted", bool(cand["unimateInbetweenAccepted"]), cand["unimateInbetweenAccepted"], True)
    if "unimateMaximumAnchorRotationError" in cand:
        value = number(cand, "unimateMaximumAnchorRotationError", float("inf"))
        add(checks, "anchor_rotation_exact", value is not None and value <= 1e-4, value, "<=0.0001 rad")
    if "unimateMaximumAnchorLocationError" in cand:
        value = number(cand, "unimateMaximumAnchorLocationError", float("inf"))
        add(checks, "anchor_location_exact", value is not None and value <= 1e-4, value, "<=0.0001")
    add(checks, "glb_rotation_quality_gate", bool(quality.get("accepted")), quality.get("ratios"), "accepted=true")
    return checks


def strike_checks(base: dict[str, Any], cand: dict[str, Any]) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    base_travel = number(base, "strikeHandTravel", number(base, "rightHandTravel", 0.0)) or 0.0
    cand_travel = number(cand, "strikeHandTravel", number(cand, "rightHandTravel", 0.0)) or 0.0
    add(checks, "strike_reach_retained", cand_travel >= base_travel * 0.85, cand_travel, f">={base_travel * 0.85:.6f}")

    base_drift = number(base, "supportFootLockMaxDrift", number(base, "leftFootLockMaxDrift", 0.0)) or 0.0
    cand_drift = number(cand, "supportFootLockMaxDrift", number(cand, "leftFootLockMaxDrift", float("inf")))
    drift_limit = max(5e-5, base_drift * 4.0)
    add(checks, "support_foot_drift_bounded", cand_drift is not None and cand_drift <= drift_limit, cand_drift, f"<={drift_limit:.8f}")

    if "torsoTwistDegrees" in base and "torsoTwistDegrees" in cand:
        b = abs(number(base, "torsoTwistDegrees", 0.0) or 0.0)
        c = abs(number(cand, "torsoTwistDegrees", 0.0) or 0.0)
        low = max(0.5, b * 0.50)
        high = max(low + 1.0, b * 1.80)
        add(checks, "torso_twist_readable", low <= c <= high, c, f"{low:.3f}..{high:.3f} deg")
    return checks


def kick_checks(base: dict[str, Any], cand: dict[str, Any]) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    for key, ratio in (
        ("strikeFootTravel", 0.80),
        ("strikeFootForwardReach", 0.75),
        ("strikeFootVerticalRise", 0.78),
    ):
        b = abs(number(base, key, 0.0) or 0.0)
        c = abs(number(cand, key, 0.0) or 0.0)
        add(checks, f"{key}_retained", c >= b * ratio, c, f">={b * ratio:.6f}")

    drift = number(cand, "supportFootLockMaxDrift", float("inf"))
    base_drift = number(base, "supportFootLockMaxDrift", 0.0) or 0.0
    drift_limit = max(0.012, base_drift * 2.0)
    add(checks, "support_foot_drift_bounded", drift is not None and drift <= drift_limit, drift, f"<={drift_limit:.6f}")

    knee = number(cand, "strikeKneeExtensionDegrees", -1.0)
    add(checks, "strike_knee_anatomical", knee is not None and 100.0 <= knee <= 175.0, knee, "100..175 deg")

    guard_distance = number(cand, "guardHandMaxChestDistance", float("inf"))
    add(checks, "guard_hands_compact", guard_distance is not None and guard_distance <= 0.45, guard_distance, "<=0.45")

    guard_height = number(cand, "guardHandMinChestHeight", -float("inf"))
    add(checks, "guard_hands_high_enough", guard_height is not None and guard_height >= 0.12, guard_height, ">=0.12")

    strike_plane = number(cand, "strikeKneePlaneMinDot", -1.0)
    support_plane = number(cand, "supportKneePlaneMinDot", -1.0)
    add(checks, "strike_knee_plane_stable", strike_plane is not None and strike_plane >= 0.25, strike_plane, ">=0.25")
    add(checks, "support_knee_plane_stable", support_plane is not None and support_plane >= 0.05, support_plane, ">=0.05")

    pivot = abs(number(cand, "supportFootPivotMaxDegrees", 0.0) or 0.0)
    add(checks, "support_pivot_bounded", pivot <= 55.0, pivot, "<=55 deg")
    return checks


def evaluate_group(
    baseline_path: Path,
    candidate_path: Path,
    quality_dir: Path,
    kind: str,
) -> dict[str, Any]:
    baseline = json.loads(baseline_path.read_text())
    candidate = json.loads(candidate_path.read_text())
    bases = action_map(baseline)
    cands = action_map(candidate)

    reports = []
    group_ok = True
    for action, base in bases.items():
        cand = cands.get(action)
        quality_path = quality_dir / f"{action}.json"
        if cand is None or not quality_path.exists():
            reports.append({
                "action": action,
                "accepted": False,
                "checks": [{"name": "candidate_complete", "passed": False, "actual": bool(cand), "limit": "candidate metrics and quality report required"}],
            })
            group_ok = False
            continue
        quality = json.loads(quality_path.read_text())
        checks = common_checks(base, cand, quality)
        checks += kick_checks(base, cand) if kind == "kick" else strike_checks(base, cand)
        accepted = all(check["passed"] for check in checks)
        group_ok = group_ok and accepted
        reports.append({"action": action, "accepted": accepted, "checks": checks, "rotationQuality": quality.get("ratios")})

    # A normal promotion pack must have exactly the shipping action vocabulary.
    # An experimental BF_Counter_R build therefore cannot silently become the
    # production shared-strike pack without a dedicated baseline/review policy.
    missing_actions = sorted(set(bases) - set(cands))
    unexpected_actions = sorted(set(cands) - set(bases))
    if missing_actions or unexpected_actions:
        group_ok = False

    return {
        "baseline": str(baseline_path),
        "candidate": str(candidate_path),
        "kind": kind,
        "accepted": group_ok,
        "missingActions": missing_actions,
        "unexpectedActions": unexpected_actions,
        "moves": reports,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate-root", required=True)
    parser.add_argument("--shipping-root", required=True)
    parser.add_argument("--quality-dir", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    candidate_root = Path(args.candidate_root)
    shipping_root = Path(args.shipping_root)
    quality_dir = Path(args.quality_dir)
    groups = {
        "shared": ("shared/blender-strikes-core.metrics.json", "blender-strikes-core.metrics.json", "strike"),
        "cross": ("cross/blender-cross-core.metrics.json", "blender-cross-core.metrics.json", "strike"),
        "power": ("power/blender-fight-core.metrics.json", "blender-fight-core.metrics.json", "strike"),
        "kicks": ("kicks/blender-kicks-core.metrics.json", "blender-kicks-core.metrics.json", "kick"),
    }

    result: dict[str, Any] = {
        "version": "POLY_FIGHTER_UNIMATE_NEURAL_PROMOTION_GATE_V1",
        "groups": {},
    }
    for group, (candidate_rel, shipping_name, kind) in groups.items():
        candidate_path = candidate_root / candidate_rel
        baseline_path = shipping_root / shipping_name
        if not candidate_path.exists():
            result["groups"][group] = {
                "accepted": False,
                "mode": "candidate-not-built",
                "candidate": str(candidate_path),
            }
            continue
        result["groups"][group] = evaluate_group(
            baseline_path,
            candidate_path,
            quality_dir,
            kind,
        )

    result["acceptedGroups"] = [
        name for name, group in result["groups"].items() if group.get("accepted")
    ]
    result["rejectedGroups"] = [
        name for name, group in result["groups"].items() if not group.get("accepted")
    ]
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

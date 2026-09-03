#!/usr/bin/env python3
"""POLY FIGHTER Blender Motion Foundry v2 - authored straight/cross.

BF_Cross_R now consumes the shared v2 strike rig. Its timing and pose intent
remain move-specific while COG/torso/IK/foot-lock/bake mechanics live in one
reusable implementation shared by Jab, Body Blow and Backfist.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import List

import bpy

import motion_foundry_v2_rig as rig


CROSS_SPEC = rig.StrikeSpec(
    action_name="BF_Cross_R",
    version="BLENDER_MOTION_FOUNDRY_V2_CROSS",
    source_action_hint="Punch_Cross",
    end_frame=42,
    load_frame=6,
    precontact_frame=16,
    impact_frame=21,
    overtravel_frame=24,
    recovery_frame=33,
    strike_side="r",
    support_side="l",
    source_knots=(
        (0.00, 0.00),
        (0.13, 0.06),
        (0.27, 0.17),
        (0.40, 0.36),
        (0.50, 0.66),
        (0.57, 0.78),
        (0.76, 0.91),
        (1.00, 1.00),
    ),
    hand_scales=(0.00, -0.05, 0.78, 1.04, 1.08, None, None),
    hand_offsets=((0.0, 0.0, 0.0),) * 7,
    ik_influences=(0.00, 0.10, 0.76, 1.00, 0.78, 0.12, 0.00),
    pelvis_forward=(0.000, -0.018, 0.012, 0.032, 0.038, 0.008, 0.000),
    pelvis_drop=(0.000, -0.012, -0.006, 0.002, 0.000, -0.003, 0.000),
    pelvis_yaw=(0.0, -4.0, 3.0, 8.0, 10.0, 2.0, 0.0),
    lower_yaw=(0.0, -5.0, 5.0, 12.0, 14.0, 3.0, 0.0),
    upper_yaw=(0.0, -7.0, 7.0, 16.0, 18.0, 4.0, 0.0),
)


def _argv_after_double_dash() -> List[str]:
    import sys

    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1 :]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--output-dir", required=True)
    return parser.parse_args(_argv_after_double_dash())


def main() -> None:
    args = parse_args()
    source = os.path.abspath(args.source)
    output_dir = Path(args.output_dir).resolve()

    rig.v1.reset_scene()
    armature = rig.v1.import_source(source)
    scene = bpy.context.scene

    action, metrics = rig.build_strike_action(scene, armature, CROSS_SPEC)
    rig.export_single_action(
        scene,
        armature,
        output_dir,
        action,
        metrics,
        glb_name="blender-cross-core.glb",
        blend_name="blender-cross-core-v2.blend",
        metrics_name="blender-cross-core.metrics.json",
    )
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()

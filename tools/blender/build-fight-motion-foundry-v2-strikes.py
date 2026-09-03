#!/usr/bin/env python3
"""Build the shared-rig Jab / Body Blow / Backfist animation library."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import List

import bpy

import motion_foundry_v2_rig as rig


ZERO_OFFSETS = ((0.0, 0.0, 0.0),) * 7

# Punch_Jab's imported left-hand source track carries only a small lead-hand
# displacement. The shared rig deliberately leaves move intent in these specs,
# so Jab/Body Blow amplify that valid direction vector instead of baking a
# world-axis assumption into the common IK/COG implementation.
JAB_SPEC = rig.StrikeSpec(
    action_name="BF_Jab_L",
    version="BLENDER_MOTION_FOUNDRY_V2_JAB",
    source_action_hint="Punch_Jab",
    end_frame=33,
    load_frame=4,
    precontact_frame=12,
    impact_frame=17,
    overtravel_frame=19,
    recovery_frame=26,
    strike_side="l",
    support_side="r",
    source_knots=(
        (0.00, 0.00),
        (0.12, 0.07),
        (0.28, 0.23),
        (0.42, 0.48),
        (0.52, 0.72),
        (0.60, 0.82),
        (0.79, 0.93),
        (1.00, 1.00),
    ),
    hand_scales=(0.00, -0.05, 3.15, 4.00, 4.15, None, None),
    hand_offsets=ZERO_OFFSETS,
    ik_influences=(0.00, 0.06, 0.78, 1.00, 0.70, 0.08, 0.00),
    pelvis_forward=(0.000, -0.005, 0.006, 0.014, 0.016, 0.004, 0.000),
    pelvis_drop=(0.000, -0.004, -0.002, 0.000, 0.000, -0.002, 0.000),
    pelvis_yaw=(0.0, -1.5, 1.0, 3.5, 4.0, 1.0, 0.0),
    lower_yaw=(0.0, -2.0, 2.0, 5.5, 6.0, 1.5, 0.0),
    upper_yaw=(0.0, -2.5, 3.0, 7.5, 8.5, 2.0, 0.0),
    hand_pole_scale=2.0,
)

BODY_BLOW_SPEC = rig.StrikeSpec(
    action_name="BF_BodyBlow_L",
    version="BLENDER_MOTION_FOUNDRY_V2_BODY_BLOW",
    source_action_hint="Punch_Jab",
    end_frame=44,
    load_frame=7,
    precontact_frame=17,
    impact_frame=23,
    overtravel_frame=27,
    recovery_frame=36,
    strike_side="l",
    support_side="r",
    source_knots=(
        (0.00, 0.00),
        (0.16, 0.08),
        (0.31, 0.19),
        (0.43, 0.40),
        (0.53, 0.67),
        (0.62, 0.80),
        (0.81, 0.92),
        (1.00, 1.00),
    ),
    hand_scales=(0.00, -0.12, 2.45, 3.25, 3.45, None, None),
    hand_offsets=(
        (0.0, 0.0, 0.0),
        (0.0, 0.0, -0.025),
        (0.0, 0.0, -0.115),
        (0.0, 0.0, -0.180),
        (0.0, 0.0, -0.190),
        (0.0, 0.0, -0.050),
        (0.0, 0.0, 0.0),
    ),
    ik_influences=(0.00, 0.10, 0.82, 1.00, 0.86, 0.14, 0.00),
    pelvis_forward=(0.000, -0.012, 0.006, 0.026, 0.031, 0.008, 0.000),
    pelvis_drop=(0.000, -0.026, -0.048, -0.058, -0.052, -0.018, 0.000),
    pelvis_yaw=(0.0, -3.0, 2.0, 7.0, 9.0, 2.0, 0.0),
    lower_yaw=(0.0, -4.0, 4.0, 10.0, 12.0, 3.0, 0.0),
    upper_yaw=(0.0, -5.0, 5.0, 13.0, 15.0, 4.0, 0.0),
    pelvis_pitch=(0.0, 1.0, 2.5, 3.5, 3.0, 1.0, 0.0),
    lower_pitch=(0.0, 2.0, 4.5, 6.5, 6.0, 2.0, 0.0),
    upper_pitch=(0.0, 2.5, 5.5, 8.0, 7.0, 2.5, 0.0),
)

BACKFIST_SPEC = rig.StrikeSpec(
    action_name="BF_Backfist_R",
    version="BLENDER_MOTION_FOUNDRY_V2_BACKFIST",
    source_action_hint="Punch_Cross",
    end_frame=41,
    load_frame=6,
    precontact_frame=15,
    impact_frame=21,
    overtravel_frame=25,
    recovery_frame=33,
    strike_side="r",
    support_side="l",
    source_knots=(
        (0.00, 0.00),
        (0.15, 0.07),
        (0.31, 0.18),
        (0.43, 0.38),
        (0.52, 0.64),
        (0.62, 0.79),
        (0.82, 0.92),
        (1.00, 1.00),
    ),
    hand_scales=(0.00, -0.045, 0.68, 0.98, 1.04, None, None),
    hand_offsets=(
        (0.0, 0.0, 0.0),
        (-0.050, 0.0, 0.015),
        (0.040, 0.0, 0.020),
        (0.095, 0.0, 0.015),
        (0.125, 0.0, 0.005),
        (0.025, 0.0, 0.000),
        (0.0, 0.0, 0.0),
    ),
    ik_influences=(0.00, 0.10, 0.74, 1.00, 0.80, 0.12, 0.00),
    pelvis_forward=(0.000, -0.014, 0.006, 0.024, 0.029, 0.006, 0.000),
    pelvis_drop=(0.000, -0.010, -0.006, 0.000, 0.000, -0.003, 0.000),
    pelvis_yaw=(0.0, -5.0, 4.0, 11.0, 14.0, 3.0, 0.0),
    lower_yaw=(0.0, -7.0, 7.0, 16.0, 20.0, 4.0, 0.0),
    upper_yaw=(0.0, -9.0, 10.0, 21.0, 26.0, 6.0, 0.0),
)

STRIKE_SPECS = (JAB_SPEC, BODY_BLOW_SPEC, BACKFIST_SPEC)


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

    actions = []
    move_metrics = []
    for spec in STRIKE_SPECS:
        action, metrics = rig.build_strike_action(scene, armature, spec)
        actions.append(action)
        move_metrics.append(metrics)

    metrics = {
        "version": "BLENDER_MOTION_FOUNDRY_V2_SHARED_STRIKES",
        "sharedRig": "MOTION_FOUNDRY_V2_SHARED_STRIKE_RIG",
        "fps": rig.FPS,
        "actions": [spec.action_name for spec in STRIKE_SPECS],
        "moves": move_metrics,
        "boneCount": len(armature.pose.bones),
        "meshCount": len([obj for obj in bpy.context.scene.objects if obj.type == "MESH"]),
    }

    rig.export_action_library(
        scene,
        armature,
        output_dir,
        actions,
        metrics,
        glb_name="blender-strikes-core.glb",
        blend_name="blender-strikes-core-v2.blend",
        metrics_name="blender-strikes-core.metrics.json",
    )
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Directional/counter extension for Blender Motion Foundry v2 reactions.

Keeps the proven v2 reaction rig/bake path and adds:
- light left/right hit reactions
- mid left/right hit reactions
- counter-hit left/right reactions
- compact ring-edge stagger

Gameplay movement and hit timing remain runtime-owned. This script only expands
the baked visual reaction library.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys

BASE_PATH = Path(__file__).with_name("build-fight-motion-foundry-v2-reactions.py")
SPEC = importlib.util.spec_from_file_location("poly_fighter_reactions_v2_base", BASE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Unable to load base reaction generator: {BASE_PATH}")
base = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = base
SPEC.loader.exec_module(base)

ReactionSpec = base.ReactionSpec


def side_spec(
    action_name: str,
    version: str,
    side: str,
    *,
    end_frame: int,
    impact_frame: int,
    settle_frame: int,
    source_peak: float,
    drop: float,
    pelvis_roll: float,
    lower_pitch: float,
    lower_roll: float,
    upper_pitch: float,
    upper_roll: float,
    head_pitch: float,
    head_roll: float,
    arm_open: float,
) -> ReactionSpec:
    sign = -1.0 if side == "LEFT" else 1.0
    return ReactionSpec(
        action_name=action_name,
        version=version,
        source_action_hint="Hit_Chest",
        end_frame=end_frame,
        impact_frame=impact_frame,
        settle_frame=settle_frame,
        source_knots=(
            (0.00, 0.00),
            (0.16, 0.02),
            (0.30, source_peak * 0.46),
            (0.50, source_peak),
            (0.70, source_peak * 0.72),
            (0.84, source_peak * 0.36),
            (0.94, source_peak * 0.12),
            (1.00, 0.00),
        ),
        pelvis_drop=((0.00, 0.00), (0.28, drop), (0.52, drop * 0.55), (0.78, drop * 0.18), (1.00, 0.00)),
        pelvis_roll=((0.00, 0.0), (0.28, sign * pelvis_roll), (0.52, sign * pelvis_roll * 1.12), (0.78, sign * pelvis_roll * 0.30), (1.00, 0.0)),
        lower_pitch=((0.00, 0.0), (0.28, lower_pitch * 0.72), (0.52, lower_pitch), (0.78, lower_pitch * 0.28), (1.00, 0.0)),
        lower_roll=((0.00, 0.0), (0.28, sign * lower_roll * 0.72), (0.52, sign * lower_roll), (0.78, sign * lower_roll * 0.28), (1.00, 0.0)),
        upper_pitch=((0.00, 0.0), (0.28, upper_pitch * 0.70), (0.52, upper_pitch), (0.78, upper_pitch * 0.26), (1.00, 0.0)),
        upper_roll=((0.00, 0.0), (0.28, sign * upper_roll * 0.72), (0.52, sign * upper_roll), (0.78, sign * upper_roll * 0.26), (1.00, 0.0)),
        head_pitch=((0.00, 0.0), (0.28, head_pitch * 0.68), (0.52, head_pitch), (0.78, head_pitch * 0.24), (1.00, 0.0)),
        # Head rolls against the torso to preserve a readable delayed snap.
        head_roll=((0.00, 0.0), (0.28, -sign * head_roll * 0.68), (0.52, -sign * head_roll), (0.78, -sign * head_roll * 0.24), (1.00, 0.0)),
        arm_open=((0.00, 0.0), (0.28, arm_open * 0.65), (0.52, arm_open), (0.78, arm_open * 0.24), (1.00, 0.0)),
    )


EXTRA_REACTIONS = (
    side_spec(
        "BF_HitLight_L", "BLENDER_MOTION_FOUNDRY_V2_HIT_LIGHT_L", "LEFT",
        end_frame=22, impact_frame=6, settle_frame=17,
        source_peak=0.30, drop=-0.012, pelvis_roll=3.5,
        lower_pitch=5.5, lower_roll=6.0, upper_pitch=8.0, upper_roll=11.0,
        head_pitch=-5.0, head_roll=9.0, arm_open=6.0,
    ),
    side_spec(
        "BF_HitLight_R", "BLENDER_MOTION_FOUNDRY_V2_HIT_LIGHT_R", "RIGHT",
        end_frame=22, impact_frame=6, settle_frame=17,
        source_peak=0.30, drop=-0.012, pelvis_roll=3.5,
        lower_pitch=5.5, lower_roll=6.0, upper_pitch=8.0, upper_roll=11.0,
        head_pitch=-5.0, head_roll=9.0, arm_open=6.0,
    ),
    side_spec(
        "BF_HitMid_L", "BLENDER_MOTION_FOUNDRY_V2_HIT_MID_L", "LEFT",
        end_frame=27, impact_frame=7, settle_frame=21,
        source_peak=0.48, drop=-0.020, pelvis_roll=5.5,
        lower_pitch=8.0, lower_roll=9.0, upper_pitch=13.0, upper_roll=18.0,
        head_pitch=-8.0, head_roll=14.0, arm_open=10.0,
    ),
    side_spec(
        "BF_HitMid_R", "BLENDER_MOTION_FOUNDRY_V2_HIT_MID_R", "RIGHT",
        end_frame=27, impact_frame=7, settle_frame=21,
        source_peak=0.48, drop=-0.020, pelvis_roll=5.5,
        lower_pitch=8.0, lower_roll=9.0, upper_pitch=13.0, upper_roll=18.0,
        head_pitch=-8.0, head_roll=14.0, arm_open=10.0,
    ),
    side_spec(
        "BF_CounterHit_L", "BLENDER_MOTION_FOUNDRY_V2_COUNTER_HIT_L", "LEFT",
        end_frame=32, impact_frame=7, settle_frame=25,
        source_peak=0.68, drop=-0.026, pelvis_roll=7.5,
        lower_pitch=12.0, lower_roll=12.0, upper_pitch=20.0, upper_roll=25.0,
        head_pitch=-13.0, head_roll=20.0, arm_open=17.0,
    ),
    side_spec(
        "BF_CounterHit_R", "BLENDER_MOTION_FOUNDRY_V2_COUNTER_HIT_R", "RIGHT",
        end_frame=32, impact_frame=7, settle_frame=25,
        source_peak=0.68, drop=-0.026, pelvis_roll=7.5,
        lower_pitch=12.0, lower_roll=12.0, upper_pitch=20.0, upper_roll=25.0,
        head_pitch=-13.0, head_roll=20.0, arm_open=17.0,
    ),
    ReactionSpec(
        action_name="BF_EdgeStagger",
        version="BLENDER_MOTION_FOUNDRY_V2_EDGE_STAGGER",
        source_action_hint="Hit_Chest",
        end_frame=25,
        impact_frame=7,
        settle_frame=20,
        source_knots=((0.00, 0.00), (0.18, 0.03), (0.32, 0.18), (0.50, 0.42), (0.70, 0.30), (0.84, 0.13), (0.94, 0.04), (1.00, 0.00)),
        pelvis_drop=((0.00, 0.00), (0.28, -0.024), (0.52, -0.016), (0.78, -0.005), (1.00, 0.00)),
        pelvis_roll=((0.00, 0.0), (0.28, 1.5), (0.52, 2.5), (0.78, 0.6), (1.00, 0.0)),
        lower_pitch=((0.00, 0.0), (0.28, 9.0), (0.52, 12.0), (0.78, 3.0), (1.00, 0.0)),
        lower_roll=((0.00, 0.0), (0.28, 2.0), (0.52, 3.0), (0.78, 0.8), (1.00, 0.0)),
        upper_pitch=((0.00, 0.0), (0.28, 14.0), (0.52, 18.0), (0.78, 4.5), (1.00, 0.0)),
        upper_roll=((0.00, 0.0), (0.28, 3.0), (0.52, 4.5), (0.78, 1.0), (1.00, 0.0)),
        head_pitch=((0.00, 0.0), (0.28, -8.0), (0.52, -11.0), (0.78, -2.5), (1.00, 0.0)),
        head_roll=((0.00, 0.0), (0.28, -2.5), (0.52, -3.5), (0.78, -0.8), (1.00, 0.0)),
        arm_open=((0.00, 0.0), (0.28, 6.0), (0.52, 8.0), (0.78, 2.0), (1.00, 0.0)),
    ),
)

META = {
    "BF_HitHeavy": {"reactionClass": "HEAVY", "reactionSide": "CENTER", "edgeSafe": False},
    "BF_GuardBreak": {"reactionClass": "GUARD_BREAK", "reactionSide": "CENTER", "edgeSafe": True},
    "BF_HitLight_L": {"reactionClass": "LIGHT", "reactionSide": "LEFT", "edgeSafe": False},
    "BF_HitLight_R": {"reactionClass": "LIGHT", "reactionSide": "RIGHT", "edgeSafe": False},
    "BF_HitMid_L": {"reactionClass": "MID", "reactionSide": "LEFT", "edgeSafe": False},
    "BF_HitMid_R": {"reactionClass": "MID", "reactionSide": "RIGHT", "edgeSafe": False},
    "BF_CounterHit_L": {"reactionClass": "COUNTER", "reactionSide": "LEFT", "edgeSafe": False},
    "BF_CounterHit_R": {"reactionClass": "COUNTER", "reactionSide": "RIGHT", "edgeSafe": False},
    "BF_EdgeStagger": {"reactionClass": "EDGE", "reactionSide": "CENTER", "edgeSafe": True},
}

base.REACTIONS = (*base.REACTIONS, *EXTRA_REACTIONS)
_original_metrics = base.action_metrics


def action_metrics(scene, armature, spec):
    result = _original_metrics(scene, armature, spec)
    result.update(META.get(spec.action_name, {}))
    result["directionalReactionPass"] = "V2_DIRECTIONAL_COUNTER_EDGE"
    return result


base.action_metrics = action_metrics

if __name__ == "__main__":
    base.main()

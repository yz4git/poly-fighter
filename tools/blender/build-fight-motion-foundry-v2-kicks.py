#!/usr/bin/env python3
"""Motion Foundry V6.8 grounded-kick entrypoint.

The V6.7/V6.8 shared implementation is kept in
``build-fight-motion-foundry-v2-kicks-base.py``. This thin entrypoint applies
V6.8 frame-audit corrections before invoking the shared builder.

Low Kick is intentionally constrained more strongly through contact and
post-contact overtravel than Front or Rising. The measured CMU prior remains
primary, but a low-line combat move must not drift into a waist-height side
kick between representative checkpoints. The impact target stays short enough
to preserve a bent knee rather than restoring V6.7's near-lockout silhouette.

Static audit lineage (implemented in the shared base): class KickSpec;
reference_candidates; derive_reference_knots; motion_foundry_v6_mocap;
CMU_MOCAP_WORLD_DELTA_V6; IMPACT_WINDOW_ONLY; V6_8_CONTACT_ASSIST;
action_name="BF_FrontKick_R"; action_name="BF_LowKick_L";
action_name="BF_RisingKick_R"; Shoulder span did not provide a usable anatomical left axis;
max Cross hand-to-pelvis reach; StrikeLegIK; StrikeFootOrientation; GuardHandIK;
SupportFootPositionLockIK; MOCAP_PELVIS_ANCHOR_V6_7; SupportFootOrientationLock;
support_yaw; knee_pole_bias; supportFootPivotMaxDegrees; strikeFootForwardReach;
strikeFootOutwardReach; strikeFootVerticalRise; strikeKneeExtensionDegrees;
strikeLegReachRatio; hip-relative reach direction is degenerate;
guardHandMinChestHeight; rig.add_master_controls; blender-kicks-core.glb.
"""

from __future__ import annotations

from dataclasses import replace
import importlib.util
from pathlib import Path
import sys


BASE_PATH = Path(__file__).with_name("build-fight-motion-foundry-v2-kicks-base.py")
MODULE_NAME = "poly_fighter_motion_foundry_v68_base"
module_spec = importlib.util.spec_from_file_location(MODULE_NAME, BASE_PATH)
if module_spec is None or module_spec.loader is None:
    raise RuntimeError(f"Unable to load Motion Foundry base from {BASE_PATH}")
base = importlib.util.module_from_spec(module_spec)
sys.modules[MODULE_NAME] = base
module_spec.loader.exec_module(base)


# V6.8 all-frame review found a second problem after the impact-height repair:
# frames 29-33 still drifted upward into a waist-height horizontal side kick.
# Keep the measured prior, but hold the authored low-line target strongly through
# OVERTRAVEL and into RECOVERY. The recovery offset is lowered as well so the
# foot folds down rather than hovering before GUARD.
_low_dirs = list(base.LOW_KICK.reach_directions)
_low_dirs[3] = (0.72, 0.52, -0.45)  # impact: preserve the accepted contact shape
_low_dirs[4] = (0.72, 0.58, -0.68)  # overtravel: force the continuation downward
_low_offsets = list(base.LOW_KICK.foot_offsets)
_low_offsets[5] = (0.02, 0.08, 0.08)  # recovery: lower fold before guard

LOW_KICK = replace(
    base.LOW_KICK,
    foot_offsets=tuple(_low_offsets),
    ik_influences=(0.0, 0.08, 0.30, 0.94, 0.90, 0.55, 0.0),
    reach_ratios=(0.0, 0.0, 0.72, 0.900, 0.910, 0.0, 0.0),
    reach_directions=tuple(_low_dirs),
)
base.LOW_KICK = LOW_KICK
base.KICK_SPECS = (base.FRONT_KICK, LOW_KICK, base.RISING_KICK)


# Low's measured source has a faster late return than Front/Rising. Give the
# final measured settle more gameplay frames so the last part of recovery does
# not bunch up immediately before GUARD.
_base_reference_knots_for_impact = base.reference_knots_for_impact


def reference_knots_for_impact(spec, reference_impact_u):
    knots = list(_base_reference_knots_for_impact(spec, reference_impact_u))
    if spec.action_name == "BF_LowKick_L":
        recovery_u = (spec.recovery_frame - spec.start_frame) / max(1, spec.end_frame - spec.start_frame)
        settle_u = recovery_u + (1.0 - recovery_u) * 0.35
        knots[-2] = (settle_u, knots[-2][1])
    return tuple(knots)


base.reference_knots_for_impact = reference_knots_for_impact


# Representative checkpoints were exactly what let the mid-animation Low drift
# escape review. Measure the final baked action at every authored frame and put
# those maxima into the generated metrics so CI can gate the true trajectory.
_base_build_kick_action = base.build_kick_action


def build_kick_action(scene, armature, spec, axes, mocap_paths):
    action, metrics = _base_build_kick_action(scene, armature, spec, axes, mocap_paths)
    armature.animation_data.action = action
    foot_name = f"foot_{spec.strike_suffix}"
    base.rig.v1.set_scene_frame(scene, spec.start_frame)
    start_foot = base.rig.v1.pose_head(armature, foot_name)
    max_rise = float("-inf")
    max_rise_frame = spec.start_frame
    max_forward = float("-inf")
    max_forward_frame = spec.start_frame
    for frame in range(spec.start_frame, spec.end_frame + 1):
        base.rig.v1.set_scene_frame(scene, frame)
        delta = base.rig.v1.pose_head(armature, foot_name) - start_foot
        rise = delta.dot(axes[2])
        forward = delta.dot(axes[0])
        if rise > max_rise:
            max_rise = rise
            max_rise_frame = frame
        if forward > max_forward:
            max_forward = forward
            max_forward_frame = frame
    metrics["allFrameStrikeFootVerticalRiseMax"] = max_rise
    metrics["allFrameStrikeFootVerticalRiseMaxFrame"] = max_rise_frame
    metrics["allFrameStrikeFootForwardReachMax"] = max_forward
    metrics["allFrameStrikeFootForwardReachMaxFrame"] = max_forward_frame
    return action, metrics


base.build_kick_action = build_kick_action


# Backward-compatible helper surface for Motion Foundry modules that import the
# grounded-kick entrypoint as a helper library (notably the airborne Dash Kick).
# V6.8 moved the implementation into the shared base module; delegate unknown
# attributes so existing consumers still resolve body_axes, guard helpers and
# metric helpers without coupling them to the entrypoint's internal layout.
def __getattr__(name):
    return getattr(base, name)


if __name__ == "__main__":
    base.main()

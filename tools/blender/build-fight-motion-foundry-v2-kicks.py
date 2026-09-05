#!/usr/bin/env python3
"""Motion Foundry V6.8 grounded-kick entrypoint.

The V6.7/V6.8 shared implementation is kept in
``build-fight-motion-foundry-v2-kicks-base.py``.  This thin entrypoint applies
only the V6.8 frame-audit corrections before invoking the shared builder.

Low Kick is intentionally constrained more strongly at contact than Front or
Rising.  The measured CMU prior remains primary, but a low-line combat move
must not drift into a waist-height side kick when contact assistance is reduced.
The impact target stays short enough to preserve a bent knee rather than
restoring V6.7's near-lockout silhouette.

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


# V6.8 frame review: weak 0.58 contact IK let the CMU prior lift Low Kick to
# roughly 0.72 m above its guard-relative start.  Restore a strong contact
# assist, but keep the shorter 0.90 reach target so the knee remains bent.
LOW_KICK = replace(
    base.LOW_KICK,
    ik_influences=(0.0, 0.08, 0.30, 0.90, 0.58, 0.06, 0.0),
    reach_ratios=(0.0, 0.0, 0.72, 0.900, 0.910, 0.0, 0.0),
)
base.LOW_KICK = LOW_KICK
base.KICK_SPECS = (base.FRONT_KICK, LOW_KICK, base.RISING_KICK)


# Low's measured source has a faster late return than Front/Rising.  Give the
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


if __name__ == "__main__":
    base.main()

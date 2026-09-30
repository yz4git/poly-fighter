# UniMate-inspired motion integration notes

POLY FIGHTER does **not** ship UniMate or run its model in the browser. We reuse several transferable ideas from the public UniMate codebase in a lightweight deterministic runtime form.

## Relevant UniMate ideas

### Replacement-style motion editing

UniMate can keep selected frames or joints fixed while regenerating the rest of a motion. The important design principle is that known motion is treated as authoritative instead of merely encouraged by a soft loss.

POLY FIGHTER applies the same principle during clip transitions:

- the incoming authored strike hand/foot is increasingly authoritative,
- the support foot is protected,
- unrelated joints may still inherit outgoing velocity through inertialization,
- the exact gameplay contact frame remains fully authored.

### Skeleton graph structure

UniMate models the skeleton as a graph and uses topology distance and edge relations in spatial attention.

POLY FIGHTER now builds the actual runtime bone adjacency graph and computes shortest-path distance from important end effectors. Replacement strength falls off by graph distance rather than using a flat whole-body blend.

This means, for example, a right-hand strike protects:

`hand_r -> lowerarm_r -> upperarm_r -> clavicle_r -> torso`

progressively, instead of abruptly switching only the hand or suppressing inertialization on the entire body.

### Motion expansion overlap

UniMate chains generated segments by pinning an overlap from the previous segment.

POLY FIGHTER cannot regenerate motion in the iPhone runtime, but authored attack-to-attack combo seams use a slightly wider inertial overlap (75 ms). During that overlap the incoming strike/support chains are topology-pinned to the destination clip, while the rest of the body carries outgoing velocity.

## Runtime profiles

`src/game/unimate-motion-replacement.ts` creates one profile per rendered frame:

- `ATTACK_GRAPH_PIN` — strike limb + support leg + light guard-hand/core protection.
- `LOCOMOTION_LOWER_BODY` — feet/lower-body settle into the incoming locomotion clip while upper body retains continuity.
- `GUARD_UPPER_BODY` — hands/arms acquire the authored guard faster than the rest of the body.
- `LANDING_LOWER_BODY` — both feet and pelvis settle into the authored landing clip.
- `NONE` — normal velocity-aware inertialization.

The profile supplies per-bone inertial weights:

- scale `1`: full outgoing velocity continuity,
- scale `0`: exact incoming authored pose,
- intermediate scale: graph-distance falloff.

This is intentionally combined with the existing Kimodo-inspired runtime work:

1. deterministic gameplay tick selects the authored clip phase,
2. UniMate-inspired replacement mask protects task-critical joints,
3. velocity-aware inertialization smooths unprotected joints,
4. authored-contact suppression reaches zero at the actual hit frame,
5. Kimodo-inspired root/body/foot conditioning performs final presentation cleanup.

## Why this is useful for fighting-game motion

A fighting game has competing requirements:

- attacks need sharp, exact impact silhouettes,
- combo transitions should not visibly pop,
- feet should not skate,
- guard hands must remain readable,
- gameplay timing and hitboxes cannot be changed by presentation smoothing.

Whole-body crossfades trade one requirement against another. Per-joint replacement masks let the runtime preserve the parts that define the move while smoothing the rest.


## Candidate smoothness ranking

UniMate's training objective combines a geodesic rotation term with a motion-velocity smoothness term. POLY FIGHTER now borrows this evaluation principle for Kimodo candidate selection.

Both kick and hand-strike selectors read `local_rot_mats` from the generated NPZ and measure, on the combat-relevant joint chains:

- RMS geodesic joint-rotation step,
- RMS change in that angular step (rotation acceleration / jitter),
- maximum one-frame geodesic rotation.

Candidates with strong end-effector reach but visibly abrupt joint rotation are therefore penalized before they reach Motion Foundry. This supplements rather than replaces the existing strike velocity, support-foot contact, root travel and gameplay contact-timing metrics.


## Offline replacement in-between cleanup

The Blender Motion Foundry now applies `tools/blender/unimate_inbetween_pass.py` after visual-keying bake for:

- shared strikes (Jab, Cross, Body Blow, Backfist and generated Counter),
- Power,
- Front Kick, Low Kick and Rising Kick.

This is not the UniMate neural checkpoint. It transfers the exact-replacement invariant from UniMate's motion in-betweening into the deterministic shipping pipeline.

The seven combat phase frames remain immutable:

`START -> LOAD -> PRECONTACT -> IMPACT -> OVERTRAVEL -> RECOVERY -> END`

Only frames between those anchors are regularised. Each unknown frame is pulled toward the shortest-arc SLERP midpoint of its immediate temporal neighbours (a small geodesic Laplacian step), rather than toward one global start-to-end arc or by filtering quaternion components independently. The effect is deliberately weakest around PRECONTACT -> IMPACT -> OVERTRAVEL and stronger in anticipation/recovery gaps.

Dense quaternion keys are also hemisphere-canonicalized: q and -q encode the same pose, but leaving opposite signs in adjacent LINEAR keys can create an apparent near-2π spin during interpolation. Sign canonicalization changes no authored pose.

After the pass, rotation-acceleration RMS and maximum one-frame rotation are measured again. If either gets worse, Motion Foundry automatically restores the original baked poses, so this cleanup cannot ship a numerically worse transition.

The pelvis and the entire support-leg chain are excluded from the pass so Motion Foundry's world-space planted-foot solve remains authoritative. Smoothing a pelvis local transform would move the whole planted leg even when thigh/calf/foot keys were unchanged. Other bones keep their baked translation and only receive quaternion cleanup.

Each built move now records:

- rotation-acceleration RMS before/after,
- maximum one-frame rotation before/after,
- maximum anchor rotation/location error,
- the exact preserved support-chain bone names.

Anchor error is expected to remain zero within Blender floating-point evaluation tolerance.

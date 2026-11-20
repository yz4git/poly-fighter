# CMU ASF → Poly Fighter UBC: anatomical pose retarget protocol

Status: **experimental preview method**. Source-pose transfer has been demonstrated; fighter combat promotion is separately gated.

## Failure mode in the previous attempt

The first importer applied a source rotation *relative to clip frame zero* to the UBC bind pose. The source mocap subject was in a relaxed/guarded stance, while UBC had a near-T-pose. Consequently frame-zero and later upper arms inherited UBC's outstretched pose, and a leg abduction patch could only hide crossed ankles. A rotation-only, rest-delta formula cannot recover a source's **absolute arm pose** if its reference is treated as a target T-pose.

Do not use that method to ship game locomotion, strikes or kicks.

## Replacement pipeline

Implemented in `src/game/cmu-anatomical-retarget.ts`, selectable via CMU **ANATOMY ON** in MODEL VIEW; legacy frame-zero transfer remains available as `LOCAL` for comparison.

1. **Inspect actual source and target rigs.** CMU ASF skeletons provide hip, shoulder, elbow, wrist, knee, ankle and toe joint positions. UBC's shoulder and leg bone axes differ significantly. Verify expected chains before fitting, and fail if either upper arm or thigh is missing. The 31 CMU animated joints currently yield 18 primary fitted UBC bone directions plus pelvis and fallback bones.
2. **Derive anatomical coordinate frames from geometry.** For both skeletons, anatomical X is the normalized vector from right hip to left hip. Anatomical Y is the torso/upper-back vector, orthogonalized against X. Z is X cross Y. Set a **fixed calibration quaternion** `C = targetRestBasis × inverse(sourceStartBasis)`. This accounts for source/target orientation without cancelling genuine turns later in the performance.
3. **Rebuild posed limb directions, not joint Euler angles.** At each animation time `t`, read the source child-to-parent world-position direction `d_s(t)` (e.g. humerus→radius). From the *target bind pose*, read its corresponding bone direction `d_t_rest` (upperarm→lowerarm). Compute `S(t) = fromUnitVectors(d_t_rest, C × d_s(t))`, then `Q_target_world(t) = S(t) × Q_target_world_rest`. This carries the original pose while retaining the target's real bone lengths.
4. **Reconstruct the UBC parent-local joint quaternion:** `Q_target_local(t) = inverse(Q_target_parent_world(t)) × Q_target_world(t)`. Visit the target hierarchy in parent-first order. ASF helper joints that do not exist in UBC are included implicitly because source directions are measured from fully evaluated world transforms.
5. **Transfer torso direction and turns.** A world-space change in the current anatomical hip/torso basis versus the source's initial basis drives the target pelvis orientation. Terminal bones that lack a valid segment can use world-space delta transfer; no wrist or finger pose is fabricated.
6. **Normalize only the preview root contact height.** With the horizontal motion removed (the game controller owns that), infer source toe contact from its ground-relative height. When a foot is plausibly planted, adjust only the target pelvis's **world vertical translation**, transformed back into the pelvis parent's local coordinates. Smooth the correction over frames. The avatar is not pulled to the ground during both-feet-airborne moments. This is *not* a full foot-IK or root-motion solution.
7. **Bake once at 30 fps**, use quaternion hemisphere continuity, then interpolate via Three.js. The game does not retarget per render frame and does not load CMU data during a match. Source and target GLB bind pose is restored on success or error.

## Validation gates

The mandatory synthetic tests protect existing legacy rigs. The optional `scripts/check-cmu-runtime.mjs` uses **real** downloaded CMU skeleton-only GLBs and both committed UBC meshes, not fake 3D poses. It checks:

- A whole-clip 30fps ankle/knee sign test, left/right preserved on both models.
- No underground toes, including the toes rather than merely the ankles.
- At 33 distributed samples per motion, compares source and target **3D unit limb vectors**, rotated only by fixed calibration C. Use no frozen/paused action during this second sweep. A hard regression gate requires peak angular error **under 5 degrees** and mean under **1 degree**.
- The only permitted translation track is `pelvis.position`, used for vertical ground correction. No horizontal world-travel trajectory is imported.
- A real WebGL image capture of 52 static poses: SERA and KAIRO × WALK, BOXING, FRONT KICK × front and side. The capture hides the bottom controller momentarily so both feet and floor can be inspected.

Evidence from the first anatomical arm/leg bake **before contact-height adjustment**, dated 2026-11-20:

| Source | Male peak / mean | Female peak / mean |
| --- | --- | --- |
| Walk | 0.73° / 0.11° | 0.73° / 0.11° |
| Boxing | 3.69° / 0.23° | 3.68° / 0.23° |
| Front kick | 1.95° / 0.08° | 1.91° / 0.08° |

The above validates **limb direction**, not surface twisting, punch timing, contact strength, hand guard semantics, knee hinge axes or usable fighting locomotion. Do not claim full-body anatomical perfection from this metric.

## Cross-character runtime bug and its verified fix

The anatomical GLB math passed independently on both UBC bodies but the November 21 browser review showed KAIRO entering a T-pose while SERA was correct. A live WebGL pose debugger compared the actual arm-bone quaternions with the selected clip. The skinning bone links were valid and playback tracks matched, but KAIRO's anatomical calibration array was empty, proving it was using the **legacy LOCAL clip**.

**Root cause:** `loadMotionSources()` returns a globally cached array. SERA pushed optional CMU packs into that array, unintentionally sharing them with KAIRO's fresh controller. KAIRO saw CMU clips already present at startup, built them in LOCAL legacy mode and skipped the normal on-demand WORLD/anatomical selection on button tap.

**Fix:** `ModelViewerMotionController.create` now uses `[...await loadMotionSources()]` so each character owns its source-pack list. Pressing a CMU button also restores WORLD/anatomical mode if that clip was already loaded. No external motion is added to the shared asset array.

**Browser regression proof:** the 52-image audit with **SERA and KAIRO** now asserts (1) a real four-element anatomical calibration on every selected CMU motion, (2) live bone quaternions within one degree of evaluated clip tracks, and (3) both WALK upper arms visibly hang down instead of staying near-horizontal. On the previous version, KAIRO would fail these checks. The corrected run passed: https://github.com/yz4git/poly-fighter/actions/runs/44764213822

This fix is separate from source-to-target skeletal calibration. Both are necessary for reliable conversion.

## Adoption policy

Never silently promote these demonstrations into live combat, and never replace the protected player model. Adoption must additionally pass:

- Human review of front/side pose sheets for clean guard → strike → retract transitions, believable torso counterbalance, foot contact and no elbow/knee inversion.
- Foot support lock / IK and root-motion retiming for gameplay; identify strike contact and cancel frames.
- A 60 fps iPhone Safari gameplay performance and controls check.
- CMU database license compliance and appropriate attribution; no resale of motion data or derivatives.

The optional legacy comparison is intentionally retained to prevent repeating the T-pose failure. The CMU dataset stays externally hosted and downloaded only after an explicit MODEL VIEW selection.

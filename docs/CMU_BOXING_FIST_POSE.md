# CMU boxing fist closure — rig-calibrated MODEL VIEW A/B

Status: **fist posing verified for optional preview**, not approved to replace live combat.

## Ground truth

On 2026-11-21 the two committed Quaternius UBC GLBs were loaded
through Three.js GLTFLoader, inspected for each hand's full skinned
finger hierarchy, and tested with the actual
`CMU_BOXING_RIGHT_STRAIGHT` and `CMU_BOXING_LEFT_RIGHT_COMBO`
source excerpts.

Both SERA and KAIRO have the same 5 articulated digits per hand:
`index`, `middle`, `ring`, `pinky`, `thumb`; each digit
provides `_01`, `_02`, `_03` plus `_04_leaf`.
Each hand's 15 movable finger joints are included in the GLB's
actual skinning skeleton. Finger bone axes and palm directions
were **measured**, not assumed.

## Conversion and pose method

In `src/game/cmu-boxing-fist.ts`, every new CMU strike preview
retains the original 23 full-body tracks. A new separately named
`_FIST` clip appends 30 local finger quaternion tracks, sampled
at the short source excerpt's existing 120Hz timestamps.

1. Determine finger length direction from real
   `middle_01 → middle_02` joint positions.
2. Determine hand width from `pinky_01 → index_01`.
3. Derive the palm-facing normal from the cross product of length
   and width directions, separately for left and right and both
   GLB models.
4. For index, middle, ring and pinky, bend joints `01/02/03`
   progressively around each original finger's measured
   flexion axis, expressed in that bone's LOCAL bind space.
   This is not a guessed Euler-X rotation.
5. Drive the thumb base toward the actual middle/ring palm
   center with a calibrated local quaternion and add two
   modest thumb flexions.
6. Keep guard/recovery at 91% fist closure and tighten to
   100% near each source-measured forward wrist-extension peak.
   Both hands remain guarded, even during a one-hand strike.
7. Preserve all source shoulder, arm, wrist, pelvis, torso and
   leg keyframe values **exactly**. No source asset, existing
   anatomical clip, fighting hitbox, or player model is changed.

Availability: `MODEL VIEW → UBC CC0 → CMU BOXING → RIGHT STRAIGHT`
or `LEFT → RIGHT COMBO → TRY FIST POSE`; the same button
returns to the original open-hand excerpt. The new selector
also has separate `_FIST` clip entries.

## Real-GLB quantitative verification

GitHub Actions: [CMU source probe run 44853977386](https://github.com/yz4git/poly-fighter/actions/runs/44853977386)
**passed** on both male and female UBC targets:

| Check | Result |
| --- | --- |
| Added articulated finger rotations | 30 tracks (15 per hand) |
| All original body/arm/leg animation keys | Byte-for-byte value equality |
| Actual fingertip-to-knuckle distance | Minimum ~38% reduction, average ~43% |
| Thumb opposition | Distal thumb moves closer to palm for both models |
| Track names and sampled values | Finite, non-duplicate |
| Both right-straight and two-hit excerpts | Passed on SERA and KAIRO |

The source motion has no finger capture; fist curl is a **procedural
artistic adaptation** calibrated to the target mesh, not a claim
that exact finger movement was captured by CMU.

## Real WebGL verification

[CMU motion visual decision run 44853977382](https://github.com/yz4git/poly-fighter/actions/runs/44853977382)
**passed**, capturing 116 PNG screenshots with zero audit errors:
the original 88 baseline shots plus 28 extra `_FIST`
guard/peak/recovery shots, SERA and KAIRO, front and side.

In the real browser the fists now look visibly closed in guard
and at the extension peaks. The audit also checks that finger
knuckle-to-tip distance shrinks by at least 16% in each
screenshot test and that the arm/hand bone world positions
remain within 0.015 target units of the original clip at the
same sampled time.

## Deliberate holdback

- These fighters remain stylized low-poly characters;
  different camera or zoom angles are not pixel-identical.
- Torso lean, foot-hover and balance deficiencies visible
  in original CMU boxing are **not** addressed by this
  finger-only correction.
- Strike extension peaks are measured from wrist forward
  displacement, **not** actual hitbox contact or active frames.
- Full-root stance IK, recovery foot plant, impact/cancel frame
  authoring, and real iPhone Safari 60fps checks remain open.
- The entire CMU source is still externally downloaded only
  when requested explicitly in MODEL VIEW.

**Decision:** keep the non-destructive boxing fist A/B preview
in MODEL VIEW, do not promote the two CMU excerpts into
shipping gameplay until the above separate quality gates pass.

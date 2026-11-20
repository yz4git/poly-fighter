# CMU stance foot-lock pilot — visual-preview only

## Scope and adoption

This is a **non-destructive A/B experiment** in POLY FIGHTER MODEL VIEW,
not a change to the actual fight controller or hitboxes. The anatomical
retarget clip remains available as `CMU_WALK` and `CMU_KICK`; after the user
explicitly loads each, a second clip `CMU_WALK_STANCE` or
`CMU_KICK_STANCE` becomes selectable from the motion dropdown or
the iPhone-friendly **TRY STANCE IK / STANCE IK ON** toggle.

CMU source data remains externally downloaded on demand and is never
bundled into the live match.

## Mechanism

- Detect toe-ground intervals in the actual animated CMU source skeleton
  from each toe's world speed and distance from its motion-specific
  minimum ground height.
- Contact state uses velocity/height hysteresis:
  entry < 0.13 m/s and 0.085 m; continuation < 0.22 m/s and 0.105 m.
  Contact runs shorter than four sampled frames are rejected.
- Preserve the source-to-UBC anatomical pose as the baseline and bake
  **another** 30fps clip that corrects only each leg's thigh, calf and foot
  quaternion tracks. The original upper-body motion, pelvis, hit timing
  and source pose remain untouched.
- Analytic 2-bone IK keeps the current knee bending pole and the original
  world foot orientation. The desired ankle is shifted by toe-anchor error,
  so the toe itself, not merely the ankle joint, is held near the contact
  anchor. Small entrance/exit weights blend the correction.
- The source's horizontal root travel is not available in this in-place
  preview. A lock target beyond 0.23 target model units is released and
  re-anchored rather than twisting the knee to reach an impossible foot
  position. The requested IK toe displacement is capped at 0.16 units.
- A cross-leg safety gate checks signed *lateral* separation after
  each candidate solve. Correction is reverted if knees would be closer
  than 0.055 units or ankles closer than 0.045 units.
- Canonical-target-space baking prevents render-host scale and yaw from
  changing contact thresholds. Original source and target bind poses
  and parent attachment are restored after bake or failure.

The locks are deliberately limited to WALK and FRONT KICK; the continuous
40-second BOXING source has much less reliable stationary-foot sections.

## Actual-source quantitative verification

GitHub Actions run:
https://github.com/yz4git/poly-fighter/actions/runs/44769219508

The real source GLBs and both committed UBC character models were sampled
at 30fps. The final ankle, knee and toe-to-floor safety tests passed.

| Clip | Avatar | Mean toe slip reduction | Max thigh IK correction | Min knee separation |
| --- | --- | ---: | ---: | ---: |
| Walk | Male | 70.7% | 15.8° | 0.058 |
| Walk | Female | 72.0% | 16.3° | 0.060 |
| Front kick | Male | 86.5% | 17.3° | 0.266 |
| Front kick | Female | 86.2% | 17.7° | 0.256 |

For the walk, the safety constraint rejected 3 male and 2 female
correction frames. Every minimum toe height in this run remained positive
(approximately 0.007–0.008 in the source model's measurement space).
The mean toe slip metric covers only frames classified as plausible
ground-contact by source mocap speed and height. It is **not** a
guarantee of perfect contact or of no sliding outside those frames.

Visual audit: https://github.com/yz4git/poly-fighter/actions/runs/44769219622

The actual WebGL MODEL VIEW was captured on SERA/KAIRO with 52 baseline
reference frames and eight matching stance-IK comparison frames.
The browser test passed with no capture errors; the visible sampled poses
did not show catastrophic crossed knees.

## Limitations / next work

- The raw source action and replay are baked *offline/on demand* in the
  browser on the first explicit CMU load, not on each render frame.
- This is partial toe anchoring for an **in-place** preview. Frequent release
  and re-anchoring is necessary when the root translation removed by preview
  makes a true world-space anchor unreachable; a full gait/root-motion-aware
  controller would be needed before shipping walking into the fight.
- Explicit heel contact, foot-roll/toe pivot, stationary-foot IK through a
  turning root, upper/lower leg twist, strike impact and cancel frames remain
  unvalidated for real game moves.
- Full motion continuity and real iPhone Safari 60fps performance have **not**
  been signed off. Do not promote any of these experimental clips to actual
  combat or replace the current authored fighter animation set.

Keep the original anatomical clip and the stance-locked variant available
for A/B review. Only a dedicated combat-integration PR should be allowed to
change the gameplay motion library or collision timing.

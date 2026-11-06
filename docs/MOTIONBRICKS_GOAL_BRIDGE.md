# MotionBricks-inspired goal bridge v4 (iPhone-safe)

Reference: https://github.com/NVlabs/motionbricks

## What ships

This is a small **deterministic adaptation of the architecture**, **not** the
NVIDIA MotionBricks neural model. MotionBricks uses recent character poses and
target poses to generate a transition. POLY FIGHTER now uses the most recent
four *displayed* local bone poses to estimate a stable outgoing trajectory and
treats the exact sampled incoming authored clip as the target pose.

- An authored **two-target window** samples the destination clip's current pose and a
  short (1/30 second) future pose. It reads cached Three.js track interpolants
  without seeking the mixer, downloading weights, altering the move clock or
  advancing hitstop. Opposing future directions are rejected.
- A **support-foot-aware contact policy** uses the authored striking limb to anchor
  only the opposite planted foot during grounded attack windup. It releases the
  anchor before the exact contact window, does not counteract committed gap
  closer travel, and defers all WALK contact planting to the existing gait IK.
  Hitstop passes zero motion time so post-conditioning cannot animate a freeze.
- An **adaptive transition budget** measures the pelvis, torso and limb-pose
  difference at the exact incoming sampled frame. Close poses blend faster;
  larger changes blend slightly longer. Hit/block/landing interruption timings
  stay unchanged, and combat frames never change.
- A four-pose rolling window (excluding hitstop duplicates) estimates joint
  momentum without relying on a single noisy retargeting frame.
- Linear and angular momentum that leads **away** from the upcoming authored
  pose is suppressed. Momentum toward the target is kept within bounded
  overshoot budgets.
- Gameplay still controls 60Hz input, attack startup, ACTIVE contact, recovery,
  knockdown, positions, hitboxes and collision.
- Existing UniMate graph masks and contact suppression protect striking hands,
  kicking feet, support feet and the exact contact frame. No replacement IK or
  changes to the Blender-authored kick path are introduced.
- The browser does not load ONNX, TensorRT, Python, or third-party sample BVH.
  No GPU inference, networking, user-facing settings or model downloads.
- Runtime telemetry:
  `fighter.visual.root.userData.motionbricksGoalBridgeVersion`,
  `motionbricksGoalRejectedChannels`, `motionbricksContextFrames`,
  `motionbricksGoalWindowChannels`, `motionbricksGoalLookaheadSeconds`,
  `motionbricksAdaptiveHandoffVersion`, `motionbricksAdaptiveSeverity`,
  `motionbricksAdaptiveEvaluatedBones`, `motionbricksContactPolicyVersion`,
  `motionbricksContactMode`, `motionbricksSupportFoot`,
  `motionbricksFootPelvisCorrection`.

## Scope / limitations

This improves **transitions** by conditioning the outgoing motion on a real
near-future goal from the destination clip. It does **not** run or bundle NVIDIA
MotionBricks, produce novel motions, alter combat hitboxes, or assert that the
NVIDIA model is deployed. It does not synthesize unseen attacks or replace the motion library. A true
MotionBricks model must be run off-device using its supported NVIDIA GPU
pipeline, then retargeted and validated against game-owned move events before
considering optional pre-baked clips.

## Validation

`npm run test:rules` for the goal bridge, target-window sampler and existing combat regression suite;
`npm run build` and the dedicated MotionBricks handoff WebGL workflow plus the TPS WebGL/kick workflows for visual
checks when available. Compare jab→cross→guard, kick→guard, strafing, hit/block
interrupts, and frozen hitstop. Test both male/female rigs and iPhone real
device 60fps before claiming verified visual quality.

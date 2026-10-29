# MotionBricks-inspired goal bridge (iPhone-safe)

Reference: https://github.com/NVlabs/motionbricks

## What ships

This is a small **deterministic adaptation of the architecture**, **not** the
NVIDIA MotionBricks neural model. MotionBricks uses recent character poses and
target poses to generate a transition. POLY FIGHTER now uses the most recent
four *displayed* local bone poses to estimate a stable outgoing trajectory and
treats the exact sampled incoming authored clip as the target pose.

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
  `motionbricksGoalRejectedChannels`, `motionbricksContextFrames`.

## Scope / limitations

This improves **transitions** and constrains incorrect outgoing momentum; it
does not synthesize unseen attacks or replace the motion library. A true
MotionBricks model must be run off-device using its supported NVIDIA GPU
pipeline, then retargeted and validated against game-owned move events before
considering optional pre-baked clips.

## Validation

`npm run test:rules` for the goal bridge and existing combat regression suite;
`npm run build` and the project's TPS WebGL/kick workflows for final visual
checks when available. Compare jab→cross→guard, kick→guard, strafing, hit/block
interrupts, and frozen hitstop. Test both male/female rigs and iPhone real
device 60fps before claiming verified visual quality.

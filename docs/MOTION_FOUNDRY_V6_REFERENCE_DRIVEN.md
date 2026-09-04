# Motion Foundry V6 — Reference-Driven Generative Motion Pipeline

V6 changes the role of procedural control. V5 started from `Idle_Loop` and used IK plus hand-authored pelvis/foot curves to invent a kick. V6 starts from a full-body authored combat reference and keeps that time-series motion as the primary signal.

## Current bootstrap

- Reference provider: Quaternius Universal Animation Library 2 (same universal humanoid skeleton).
- Front kick prior: `Melee_Hook`, fallback `OverhandThrow` / `Sword_Regular_A`.
- Low kick prior: `Melee_Hook`, fallback `Sword_Regular_A` / `OverhandThrow`.
- Rising kick prior: `NinjaJump_Start`, fallback `Melee_Hook` / `OverhandThrow`.
- Automatic reference event alignment finds a kinetic peak from hand reach, torso rotation, pelvis travel and vertical pelvis velocity, then maps that event to the gameplay impact frame.
- Strike-leg IK is reduced to an impact window instead of generating the full motion.
- Guard IK is deliberately weakened so authored arm counterbalance and torso momentum survive.
- Support-foot lock/pivot and exact hit-line constraints remain deterministic for gameplay.

## Generative-provider contract

The Blender generator accepts `--reference-source <GLB>`. A future Kimodo, GEM, DMP or other motion model only needs to export a compatible humanoid GLB/BVH-converted GLB. The same V6 alignment, contact constraints, validation, retargeting and game bake can then operate without changing the iPhone runtime.

Generated clips remain ordinary 60 Hz glTF `AnimationClip`s. No neural network runs on iPhone.

## Quality principle

Human motion is primary; constraints are secondary. IK may correct the final centimeters around contact, but may not invent anticipation, weight transfer, counter-rotation, recovery or arm counterbalance.

The visual quality gate is silhouette-aware as well as height/reach-aware. In particular, the rising kick keeps a high impact line while steering the strike ankle outside the torso projection. The generated metrics expose `strikeFootOutwardReach`, and the contract requires a positive outward separation for `BF_RisingKick_R` so a numerically high kick cannot regress into a body-occluded silhouette.

## Measured martial-arts prior

The shipping V6 bootstrap uses measured motions from the Carnegie Mellon Graphics Lab Motion Capture Database, subject 135: trial 04 `Front Kick`, trial 07 `Mawashigeri`, and trial 11 `Yokogeri`. The CMU site permits copying, modification, redistribution and commercial use; the Bruce Hahne BVH conversion adds no further restrictions. The build pins the public `una-dinosauria/cmu-mocap` mirror by commit.

The source BVH is build-time input only. Motion Foundry crops the strongest kick event, transfers full-body world-space rotation deltas into the universal game rig, mirrors anatomically when the measured strike side differs from the gameplay side, then bakes ordinary 60 Hz glTF clips.

# Blender Motion Foundry v2 — Grounded Kicks

This pass extends the shared Blender v2 authoring approach to grounded kicks without adding motion-bricks.cpp or another runtime dependency.

Authored actions:

- `BF_FrontKick_R`
- `BF_LowKick_L`
- `BF_RisingKick_R`

`PF_DashKick_R` deliberately remains procedural because its airborne contact phase does not have a planted support foot and needs a separate airborne solver.

The grounded kick pipeline reuses the v2 COG/pelvis and staged torso masters, then adds a strike-leg two-bone IK target, knee pole, strike-foot orientation control, and full world-space position/orientation locking on the support foot. Final poses are visually baked in Blender and exported together as `blender-kicks-core.glb`.

The Model Viewer audit compares each PF/BF pair at 55% normalized time, close to the authored impact phase of all three grounded kicks.

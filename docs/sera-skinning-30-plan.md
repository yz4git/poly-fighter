# SERA 30-Step Skinning Improvement Plan

Goal: improve the Blender-authored SERA runtime deformation in the real POLY FIGHTER game while preserving gameplay, KAIRO, fixed-step simulation, IK/footplant, and the existing Blender/WebGL audit pipeline.

## Acceptance criteria

- SERA continues to use `public/models/sera-blender-runtime.glb` in the live game.
- Hair, facial details, collar and ponytail must not inherit arm or leg weights.
- Shoulder/chest transitions must not stretch unrelated torso surfaces during Guard/Punch.
- Forearm guards, shin guards and boots must follow their intended limb segments.
- Skirt panels remain coherent during Guard/Punch/Kick without long cross-body triangles.
- Every vertex receives finite normalized weights with at most four influences.
- Idle / Guard / Punch / Kick remain materially different in the real Chrome/WebGL audit.
- Existing V8 validation, gameplay tests, PWA tests, build and lint remain green.

## 30 checkpoints

01. Record plan and acceptance criteria.
02. Add Blender-specific semantic palette decoding.
03. Add Blender-specific anatomical region classifier.
04. Add normalized influence utilities and safety guards.
05. Wire SERA runtime to the dedicated Blender skinner.
06. Lock hair and face-detail semantics to the head.
07. Lock the full ponytail chain to the head to remove arm-weight leakage.
08. Add collar-specific neck/chest weighting.
09. Add shoulder transition weighting against chest.
10. Refine upper-arm/elbow blending.
11. Refine forearm guard weighting.
12. Lock hands to hand bones with a small wrist transition.
13. Stabilize pelvis/waist weighting.
14. Bias the front skirt to hips with controlled thigh influence.
15. Split side-skirt influence by side and height.
16. Refine thigh-to-knee transitions.
17. Refine shin guard weighting.
18. Lock boots to feet with a small ankle transition.
19. Add a conservative unknown-semantic fallback.
20. Validate finite normalized weights and influence fanout.
21. Record region/semantic counts on the runtime visual.
22. Record dominant-bone diagnostics for audit/debugging.
23. Expose Blender skinning version/diagnostic metadata.
24. Add semantic decoder regression tests.
25. Add region classifier regression tests.
26. Add weight solver regression tests.
27. Make the WebGL audit wait for Blender asset readiness.
28. Make the audit assert the Blender runtime pipeline/skin version.
29. Add the new skinning tests/module to CI path coverage.
30. Run final build/tests/lint + real WebGL Idle/Guard/Punch/Kick audit and merge only after green.

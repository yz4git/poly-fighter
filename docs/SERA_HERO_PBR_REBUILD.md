# SERA PBR model overhaul

The new SERA HERO PBR visual is a separate rigged, textured GLB and not
another polygon overlay on the old character. The old model is retained as
fallback so existing controls, 60Hz gameplay simulation and hitboxes work.

## Implemented
- SERA-specific model option and independent GLB loading.
- UBC/UAL skeleton drives only the new visual through a retargeting bridge.
- Textured PBR materials preserved with no forced flat shading.
- Pinned Ara 3D Gen / MakeHuman first-character generator in GitHub Actions.
- GLB contract validates joints, triangle count, embedded textures and size.
- Blender workflow renders actual front, three-quarter, side and back views.
- Only the dedicated feature branch is updated by the asset generator.

## Current quality status
Generated SERA is a BASE CANDIDATE, not a commercial-quality final character.
The SERA head, hair, fitted clothes, expression and silhouette require a
separate art-directed sculpt and weight-painting review. The new GLB should
not be merged before actual renders and iPhone Safari testing are reviewed.

## Release gates
1. Artist evaluation: face close-up, hairline, clothing, skin and silhouette.
2. Animation: Idle, Guard, Jab, Power, Kick, Crouch, Knockdown from four angles.
3. Runtime: heroModelState ready, correct skeleton, no duplicated bodies or 404.
4. Phone: two fighters, arena, effects at measured 60fps target; track memory.
5. License review: Ara MIT, MakeHuman CC0; verify any added assets separately.

The Ara recipe deliberately disables Ara motion clips. Existing PolyFighter
motion assets preserve their original licensing and timing.

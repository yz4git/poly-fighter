# SERA V3 — Independent Fighter Asset (draft)

## Intent

A new anatomy-consistent SERA asset, not V2 rigid primitive decorations.
The user's original four-view public/reference/female-turnaround.jpeg is the
visual target: sharp eyes, black swept high ponytail, dark cobalt/graphite
martial-tech uniform, tailored asymmetric cloth, slender integrated bracers.

This is a new model selection SERA V3 / REBUILT, never an overwrite of
existing SERA HERO PBR (V2) or the default Quaternius UBC model. Existing
combat simulation and hitboxes stay unchanged.

## Authored asset recipe

1. Start from pinned MIT-licensed Ara character generator and its MakeHuman
   CC0 source, with the established game/Mixamo-style rig and 20 facial morphs.
2. Perform deliberate facial mesh adjustments in Blender while preserving
   all shape-key bases so expressions remain usable.
3. Reassign the existing skinned garment polygons by anatomical region into
   the SERA-specific cobalt/carbon battle outfit, so fabric fits the body.
4. Generate and embed actual repeating cloth PBR image maps. Bare skin and eyes
   keep their dedicated source UVs.
5. Duplicate small subsets of the real arm/shoulder/shin surface to form
   conformal protection with the same original bone weights.
6. Add tailored asymmetric front/side cloth panels with transferred skinning.
7. Sculpt tapering front hair locks and high ponytail as skinned meshes.
8. Export UVs, PBR materials, skinning and original facial morphs as mobile GLB.
   Capture six actual Blender views for art review.

## QA gates

- V2 and V3 remain selectable, with UBC fallback if the V3 GLB fails.
- Structural checks require SERA V3-specific mesh materials, humanoid bones,
  multiple PBR images, facial morphs and no old V2 primitive armor shapes.
- Chromium WebGL must load V3 and play a fighting attack without error.
- Face and in-game fighting screenshots must be evaluated by eye.
- Verify iPhone Safari FPS with two fighters and effects, targeting 60fps.
  No claimed AAA or production-grade completion based only on CI.

## License and source

- Generator: https://github.com/olatunde85/3d-gen (MIT; pinned revision).
- Human templates: MakeHuman (CC0 according to Ara's upstream notices).
- Original SERA reference image is already in PolyFighter; the authored new
  geometry and procedural textile maps are built by the project's own script.

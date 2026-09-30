# Kimodo Motion Pipeline for POLY FIGHTER

POLY FIGHTER uses NVIDIA Kimodo as an **offline motion authoring provider**, not as an iPhone runtime dependency.

The shipping game still plays ordinary 60 Hz glTF animation clips. Kimodo generation, candidate ranking, Blender retargeting, contact shaping and quality validation happen before the GLB is committed.

## Pipeline

1. Generate four SOMA candidates for each grounded kick with `bash tools/kimodo/generate-poly-fighter-kicks.sh`.
2. Kimodo's normal post-process remains enabled. Do not pass `--no-postprocess`; its foot-skate / constraint cleanup is useful before retargeting.
3. Convert each generated Kimodo NPZ to SOMA BVH with `kimodo_convert`.
4. Rank candidates using native Kimodo channels:
   - `posed_joints`
   - `foot_contacts`
   - `smooth_root_pos`
5. Feed the selected BVHs into Motion Foundry V6:
   - `--kimodo-front`
   - `--kimodo-low`
   - `--kimodo-rising`
6. Motion Foundry transfers the full-body prior to the Poly Fighter universal rig, aligns the kinetic peak to gameplay contact, preserves knee bend direction, locks/pivots the support foot, applies the narrow contact IK window, and runs the existing kick metrics.
7. Export the accepted actions to `blender-kicks-core.glb`. The browser never loads Kimodo or PyTorch.

## Generate

Run this inside a Kimodo environment:

```bash
bash tools/kimodo/generate-poly-fighter-kicks.sh
```

The default model is `Kimodo-SOMA-RP-v1.1`. Override it with:

```bash
KIMODO_MODEL=Kimodo-SOMA-SEED-v1.1 bash tools/kimodo/generate-poly-fighter-kicks.sh
```

The runner creates four deterministic seeds per move, converts every candidate to BVH, then writes `selection.json`.

## Ingest selected candidates

Use the BVH paths reported in `selection.json`:

```bash
xvfb-run -a blender --background \
  --python-use-system-env \
  --python-exit-code 1 \
  --python tools/blender/build-fight-motion-foundry-v2-kicks.py \
  -- \
  --source .tmp-quaternius/ual1-full.glb \
  --kimodo-front artifacts/kimodo-poly-fighter/frontKick/frontKick_seed_XXXX.bvh \
  --kimodo-low artifacts/kimodo-poly-fighter/lowKick/lowKick_seed_XXXX.bvh \
  --kimodo-rising artifacts/kimodo-poly-fighter/risingKick/risingKick_seed_XXXX.bvh \
  --output-dir artifacts/motion-foundry-kimodo-kicks
```

A Kimodo BVH is detected from the SOMA skeleton vocabulary (`LeftShin`, `RightShin`, `Spine2`, `Chest`). The existing CMU BVH path remains supported and unchanged.

## Selection philosophy

The pre-Blender selector does **not** decide final animation quality. It only removes weak candidates early.

It rewards:

- a clear kinetic peak on the intended striking leg,
- stronger strike-leg motion than the other leg,
- support-foot contact around the kinetic peak,
- limited root travel.

It penalizes:

- the strike foot remaining planted at the kinetic peak,
- large locomotor drift.

Motion Foundry remains the final gate because it can measure the actual retargeted leg reach, knee plane, support-foot drift, pivot, pelvis travel and silhouette on the production rig.

## Runtime relationship

The offline Kimodo provider and `kimodo-motion-conditioning.ts` solve different problems:

- **offline Kimodo generation** supplies more natural full-body source motion,
- **runtime Kimodo-inspired conditioning** suppresses small root jitter and foot skating after retarget/playback.

Neither changes deterministic gameplay timing, hitboxes or fighter positions.

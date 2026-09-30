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


## Hand-strike pipeline

Kimodo authoring is also available for Jab, Cross, Body Blow, Backfist, Power and Counter.

Generate and rank 24 deterministic candidates (four seeds per move):

```bash
bash tools/kimodo/generate-poly-fighter-strikes.sh
```

The hand-strike selector rewards a dominant intended-hand kinetic peak, useful reach gain, a quiet guard hand, support-foot contact and bounded root travel.

After reviewing `artifacts/kimodo-poly-fighter-strikes/selection.json`, route all six selected BVHs through the existing production Foundry stacks:

```bash
bash tools/kimodo/build-selected-strikes.sh \
  artifacts/kimodo-poly-fighter-strikes/selection.json \
  .tmp-quaternius/ual1-full.glb
```

Outputs are separated by the established runtime packs:

- `shared/blender-strikes-core.glb`: Jab, Body Blow, Backfist and optional generated Counter.
- `cross/blender-cross-core.glb`: Cross.
- `power/blender-fight-core.glb`: Power.

The generated Counter is optional. Runtime playback checks for `BF_Counter_R`; when an older shipping strike pack does not contain it, the established `CM_Counter_R` motion remains the fallback.

Kimodo strike priors are retimed so their detected hand-velocity peak lands on the deterministic gameplay impact frame. Existing Foundry contact IK is reduced rather than removed, while old COG/torso authoring offsets are strongly demoted so generated full-body weight transfer remains primary.


## Constrained refinement pass

The authoring runners now use two passes rather than accepting the best text-only sample directly.

### Pass A — exploration

Four deterministic text-only samples are generated for every move. The existing selector finds the strongest candidate using strike-limb velocity/reach, support-foot contact and bounded root motion.

### Constraint synthesis

`tools/kimodo/build-poly-fighter-constraints.py` converts the best exploratory NPZ into an official Kimodo constraints JSON. It deliberately uses the same fields Kimodo saves from the interactive demo:

- **Full-Body** keyframes at guard start, gameplay contact and guard end.
- **End-effector** keyframe for the striking hand or foot at gameplay contact.
- **Support-foot end-effector interval** around contact to keep the planted leg stable.
- **2D Root** waypoints at start/contact/end. Gross fighter translation remains owned by gameplay; the authored clip receives only a small bounded weight shift.
- **Heading** stays at the canonical +Z fighting direction so prompt interpretation cannot introduce an accidental spin.

The contact pose is not blindly taken from the same source frame number. The builder searches a small window around the gameplay-authored contact phase, chooses the strongest local kinetic/reach frame from the exploratory motion, and writes that pose back at the exact gameplay contact frame. This gives Kimodo a readable pose target without creating a second animation clock.

### Pass B — constrained regeneration

Two deterministic refinement seeds are generated per move with:

```text
cfg_type = separated
text_weight = 1.8
constraint_weight = 2.8
diffusion_steps = 140
```

Kimodo post-processing remains enabled, so its own foot-skate and constraint cleanup still runs after diffusion.

The final selector compares both exploratory and constrained candidates. In addition to the original naturalness heuristics it penalizes the absolute frame error between the generated kinetic peak and the deterministic gameplay contact frame.

This produces 6 candidates per move:

- 4 text-exploration candidates
- 2 constrained-refinement candidates

The selected result still passes through Blender Motion Foundry before shipping.

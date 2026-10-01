# UniMate-inspired motion integration notes

POLY FIGHTER does **not** ship UniMate or run its model in the browser. We reuse several transferable ideas from the public UniMate codebase in a lightweight deterministic runtime form.

## Relevant UniMate ideas

### Replacement-style motion editing

UniMate can keep selected frames or joints fixed while regenerating the rest of a motion. The important design principle is that known motion is treated as authoritative instead of merely encouraged by a soft loss.

POLY FIGHTER applies the same principle during clip transitions:

- the incoming authored strike hand/foot is increasingly authoritative,
- the support foot is protected,
- unrelated joints may still inherit outgoing velocity through inertialization,
- the exact gameplay contact frame remains fully authored.

### Skeleton graph structure

UniMate models the skeleton as a graph and uses topology distance and edge relations in spatial attention.

POLY FIGHTER now builds the actual runtime bone adjacency graph and computes shortest-path distance from important end effectors. Replacement strength falls off by graph distance rather than using a flat whole-body blend.

This means, for example, a right-hand strike protects:

`hand_r -> lowerarm_r -> upperarm_r -> clavicle_r -> torso`

progressively, instead of abruptly switching only the hand or suppressing inertialization on the entire body.

### Motion expansion overlap

UniMate chains generated segments by pinning an overlap from the previous segment.

POLY FIGHTER cannot regenerate motion in the iPhone runtime, but authored attack-to-attack combo seams use a slightly wider inertial overlap (75 ms). During that overlap the incoming strike/support chains are topology-pinned to the destination clip, while the rest of the body carries outgoing velocity.

## Runtime profiles

`src/game/unimate-motion-replacement.ts` creates one profile per rendered frame:

- `ATTACK_GRAPH_PIN` — strike limb + support leg + light guard-hand/core protection.
- `LOCOMOTION_LOWER_BODY` — feet/lower-body settle into the incoming locomotion clip while upper body retains continuity.
- `GUARD_UPPER_BODY` — hands/arms acquire the authored guard faster than the rest of the body.
- `LANDING_LOWER_BODY` — both feet and pelvis settle into the authored landing clip.
- `NONE` — normal velocity-aware inertialization.

The profile supplies per-bone inertial weights:

- scale `1`: full outgoing velocity continuity,
- scale `0`: exact incoming authored pose,
- intermediate scale: graph-distance falloff.

This is intentionally combined with the existing Kimodo-inspired runtime work:

1. deterministic gameplay tick selects the authored clip phase,
2. UniMate-inspired replacement mask protects task-critical joints,
3. velocity-aware inertialization smooths unprotected joints,
4. authored-contact suppression reaches zero at the actual hit frame,
5. Kimodo-inspired root/body/foot conditioning performs final presentation cleanup.

## Why this is useful for fighting-game motion

A fighting game has competing requirements:

- attacks need sharp, exact impact silhouettes,
- combo transitions should not visibly pop,
- feet should not skate,
- guard hands must remain readable,
- gameplay timing and hitboxes cannot be changed by presentation smoothing.

Whole-body crossfades trade one requirement against another. Per-joint replacement masks let the runtime preserve the parts that define the move while smoothing the rest.


## Candidate smoothness ranking

UniMate's training objective combines a geodesic rotation term with a motion-velocity smoothness term. POLY FIGHTER now borrows this evaluation principle for Kimodo candidate selection.

Both kick and hand-strike selectors read `local_rot_mats` from the generated NPZ and measure, on the combat-relevant joint chains:

- RMS geodesic joint-rotation step,
- RMS change in that angular step (rotation acceleration / jitter),
- maximum one-frame geodesic rotation.

Candidates with strong end-effector reach but visibly abrupt joint rotation are therefore penalized before they reach Motion Foundry. This supplements rather than replaces the existing strike velocity, support-foot contact, root travel and gameplay contact-timing metrics.


## Offline replacement in-between cleanup

The Blender Motion Foundry now applies `tools/blender/unimate_inbetween_pass.py` after visual-keying bake for:

- shared strikes (Jab, Cross, Body Blow, Backfist and generated Counter),
- Power,
- Front Kick, Low Kick and Rising Kick.

This is not the UniMate neural checkpoint. It transfers the exact-replacement invariant from UniMate's motion in-betweening into the deterministic shipping pipeline.

The seven combat phase frames remain immutable:

`START -> LOAD -> PRECONTACT -> IMPACT -> OVERTRAVEL -> RECOVERY -> END`

Only frames between those anchors are regularised. Each unknown frame is pulled toward the shortest-arc SLERP midpoint of its immediate temporal neighbours (a small geodesic Laplacian step), rather than toward one global start-to-end arc or by filtering quaternion components independently. The effect is deliberately weakest around PRECONTACT -> IMPACT -> OVERTRAVEL and stronger in anticipation/recovery gaps.

Dense quaternion keys are also hemisphere-canonicalized: q and -q encode the same pose, but leaving opposite signs in adjacent LINEAR keys can create an apparent near-2π spin during interpolation. Sign canonicalization changes no authored pose.

After the pass, rotation-acceleration RMS and maximum one-frame rotation are measured again. If either gets worse, Motion Foundry automatically restores the original baked poses, so this cleanup cannot ship a numerically worse transition.

The pelvis and the entire support-leg chain are excluded from the pass so Motion Foundry's world-space planted-foot solve remains authoritative. Smoothing a pelvis local transform would move the whole planted leg even when thigh/calf/foot keys were unchanged. Other bones keep their baked translation and only receive quaternion cleanup.

Each built move now records:

- rotation-acceleration RMS before/after,
- maximum one-frame rotation before/after,
- maximum anchor rotation/location error,
- the exact preserved support-chain bone names.

Anchor error is expected to remain zero within Blender floating-point evaluation tolerance.


## Optional neural in-between authoring bridge

POLY FIGHTER can now use the actual UniMate inference code as an **offline authoring accelerator** when a compatible GPU environment and released UniMate checkpoint are available. The browser/iPhone build still has no PyTorch, UniMate, T5, CUDA or checkpoint dependency.

The bridge is intentionally two-tiered:

1. **Neural path available** — run official UniMate custom-asset preprocessing and replacement-style in-betweening, recover the generated feature motion onto the canonical UAL character, export it to UAL BVH, then feed that BVH back through Motion Foundry.
2. **Neural path unavailable** — record `deterministic-fallback` and keep the current `unimate_inbetween_pass.py` shipping path. Existing public GLB packs remain unchanged.

### Single move

Set `UNIMATE_ROOT` to the official `Friedrich-M/UniMate` checkout and `UNIMATE_EXP_DIR` to a released/trained experiment directory containing `config.json`, `dataset_stats.npy` and `checkpoints/`.

Example:

```bash
UNIMATE_ROOT=/path/to/UniMate \
UNIMATE_EXP_DIR=/path/to/unimate-exp \
SOURCE_GLB=public/models/quaternius/blender-cross-core.glb \
ACTION_NAME=BF_Cross_R \
KEEP_FRAMES_60=1,6,16,21,24,33,42 \
PROMPT="A trained kickboxer throws one crisp right cross and returns to guard." \
bash tools/unimate/run-poly-fighter-neural-inbetween.sh
```

The runner:

- copies the source to a hyphen-free `polyfighter.glb` name because UniMate's multi-topology loader derives `object_type` from the filename prefix,
- uses the official `data_process/scripts/run_preprocess_char.sh` custom-asset path with UAL `thigh_r/thigh_l` facing references,
- preserves the checkpoint's architecture and training normalization statistics while redirecting only the Objaverse-style feature path to the preprocessed fighter,
- converts Motion Foundry's 60 Hz / one-based combat anchors into UniMate's 30 Hz / zero-based feature slots,
- runs `unimate.inference.sample --inbetween --keep_frames ...`,
- uses the official `run_animate_motion.sh` to recover the generated `.npy` features onto the canonical fighter,
- exports the resulting animated UAL GLB as BVH through `tools/unimate/export-animated-ual-bvh.py`.

The BVH keeps UAL names and is identified by Motion Foundry as provider `UNIMATE_UAL_BVH_REPLACEMENT_V1`.

### Nine-move batch

`tools/unimate/poly-fighter-neural-inbetween-presets.json` contains the seven immutable combat phase anchors and prompts for:

- Jab
- Cross
- Body Blow
- Backfist
- Power
- Counter
- Front Kick
- Low Kick
- Rising Kick

Generate all optional priors with:

```bash
UNIMATE_ROOT=/path/to/UniMate \
UNIMATE_EXP_DIR=/path/to/unimate-exp \
bash tools/unimate/generate-poly-fighter-neural-priors.sh
```

Each move receives its own `result.json`. A combined manifest records `neuralCount` and `fallbackCount`.

When a full UAL Foundry source is also available, route the generated BVHs back through the same production builders:

```bash
bash tools/unimate/build-neural-priors-through-foundry.sh \
  artifacts/unimate-neural-priors/manifest.json \
  .tmp-quaternius/ual1-full.glb
```

Provider-neutral `--motion-prior-*` flags accept UniMate UAL, Kimodo SOMA or legacy CMU BVH. The older `--kimodo-*` and `--mocap-*` flags remain supported for existing workflows.

Safety against quality regression is group-aware. Shared strikes are rebuilt only when Jab, Body Blow and Backfist neural priors are all present; Counter is optional. The kick pack is rebuilt only when all three kick priors are available. Otherwise the corresponding shipping pack is explicitly left unchanged.

### Why this remains deterministic in game

UniMate is used only to propose better frames **before shipping**. The result is baked into ordinary GLB animation clips. During gameplay the same 60 Hz gameplay tick, authored contact timeline, support-foot rules, UniMate-inspired runtime replacement masks and Kimodo-inspired inertialization remain authoritative. Neural inference never decides hit timing, movement, hurtboxes or hitboxes at runtime.

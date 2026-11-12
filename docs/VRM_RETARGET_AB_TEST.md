# VRM-style rest-basis retarget A/B trial (2026-11-12)

Reference: https://qiita.com/haruka_apps/items/7981cdce7304679af2cd

## What is now implemented

POLY FIGHTER already has GPU skinned meshes, an analytic two-bone IK solver,
Quaternius CC0 animation packs loaded independently of the characters, and
offline motion authoring/foot-contact cleanup. We **do not** replace GPU
skinning with Pyxel's rigid-per-bone fallback or per-frame CPU skinning.

This trial adds a second **rest-space** quaternion transfer to the common
`retargetMotionClips` function. The existing `LOCAL` method stays the default
for the actual fight so it does not change gameplay/hit timing. The Model View
can toggle `TRY WORLD`/`WORLD ON` to compare the same clip at the same time.

- **LOCAL** (shipping): `targetRest * inverse(sourceRest) * sourceAnimated`.
- **WORLD** (preview): compute the source animation's rest-relative quaternion
  delta, rotate that delta through the source *parent world rest orientation*,
  then express it in the target *parent world rest orientation*, and apply it
  to the target bone rest. This helps when skeleton joint coordinate axes differ.
- Bone aliases can be specified as `boneNameMap: { hips: "pelvis" }`.
- Hip translation remains restricted to one named bone. It is rest-relative
  and can be scaled for model proportions. No other track translates a limb.
- Input animation packs remain separate GLBs and are retargeted once during
  preview setup or an explicit mode switch, never per animation frame.
- A/B clip banks are cached after first use; a mode change retains selected
  animation, elapsed time, speed, loop and pause state.

## How to review on iPhone

1. Open the **MODEL VIEW** on the PR's preview deployment once available.
2. Select the **UBC CC0** character, then any punch, kick or guard motion.
3. Switch between **TRY WORLD** and **WORLD ON** using the new button below
   the motion toolbar. Compare shoulder, hip and knee axes for the same clip
   with the timeline paused at contact.
4. Switch both characters, repeat, and check neutral pose, limb twist, foot
   drift, silhouette, and end pose.
5. Keep the switch **LOCAL** in a real match. We will only promote WORLD to
   gameplay after the side-by-side visual audit and stable 60fps measurement.

## Validation and limits

- `npm run test:rules` covers world-parent orientation, LOCAL parity, and
  explicit VRM-to-game hip aliases/translation limits.
- The project's existing Core validation workflow covers lint and build.
- No VRoid sample avatar, third-party VRM binary, new dependency, or new
  copyright/licensing restriction is introduced in this change.
- This is a **motion pipeline experiment**, not a replacement character mesh.
  Improvements to facial morphs and high-end character sculpting need their
  own licensed assets and art-review pipeline.
- The WORLD method assumes source and target were both restored to rest pose
  when retargeting, and uses static world-rest parent orientations. Full
  hierarchical/world-motion retargeting and per-clip floor contact are future
  offline-authoring tasks; this trial does not claim those.

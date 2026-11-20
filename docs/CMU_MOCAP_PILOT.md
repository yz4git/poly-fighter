# CMU motion-capture A/B pilot (2026-11-20)

## Scope

This is an **opt-in Model View experiment**, not a replacement for the shipped POLY FIGHTER attack, movement or hitbox system. The original game, procedural characters and Quaternius animation packs remain unchanged until the team measures retarget fidelity, foot contacts and iPhone performance.

Dataset: https://huggingface.co/datasets/codepawl/cmu-mocap-glb

Three verified dataset entries are exposed as on-demand choices:

| UI button | Original motion | Duration (dataset listing) | Remote skeleton-only GLB |
| --- | --- | --- | --- |
| CMU WALK | `05_01-walk` | 4.983 s | `skeleton/05_01-walk/05_01-walk_skeleton.glb` |
| CMU BOXING | `13_17-boxing` | 40.333 s | `skeleton/13_17-boxing/13_17-boxing_skeleton.glb` |
| CMU KICK | `135_04-front-kick` | source GLB duration | `skeleton/135_04-front-kick/135_04-front-kick_skeleton.glb` |

The "kick" sample is **a soccer kick**, not a martial-arts side kick. The "boxing" sample is one long performance; it has not been segmented into guaranteed single-hit game clips. These are reference motions for comparison, not approved production move timings. The initial 10_01 soccer-kick trial was replaced with CMU subject 135's martial-arts **Front Kick** after detecting pronounced late-clip ankle crossings.

## iPhone review procedure

1. Open POLY FIGHTER → **MODEL VIEW** → choose **UBC CC0** (either fighter).
2. Wait for the existing Quaternius motion viewer to become ready.
3. Tap **CMU WALK**, **CMU BOXING**, or **CMU KICK**. The selected source is downloaded from Hugging Face only on demand; no third-party footage is loaded during normal gameplay or initial viewer startup.
4. Switch among **CMU**, **BLENDER**, **PF**, and **BASE** clips in the same selector. Pause at foot plants, punches and strikes; orbit the camera for silhouette and joint-twist inspection.
5. Use **ANATOMY ON / TRY ANATOMY** when a CMU clip is selected to compare absolute anatomical pose reconstruction with the original frame-zero legacy transfer. The selected clip is baked once per mode switch (not every frame).
6. If network access, CORS, a missing GLB or incompatible bone naming fails, a CMU error is shown and the previous local clip is restored. No combat logic is affected.

## Integration mechanics and limitations

- **WORLD/ANATOMY is the corrected conversion:** CMU animated joint positions determine the absolute directions of the target's corresponding upper arms, forearms, thighs, calves, clavicles and spine. A fixed source/target anatomical frame aligns axes, followed by parent-world-to-local reconstruction. See `docs/CMU_ANATOMICAL_RETARGET_PROTOCOL.md`.
- **LOCAL is now legacy-only:** frame-zero rotation deltas applied to a UBC T-pose were identified as the cause of outstretched arms in the previous screenshot review; do not use this mode in game.
- In corrected mode, the animation is fitted from the source's actual skeletal limb directions, **without** the older forced outward thigh correction. Per-frame sign tests still guard against crossed knees and ankles.
- Motion retargeting is baked once at a preview-only **30fps** sample rate and interpolated by Three.js. No runtime per-frame procedural retargeting is used in the live match.
- Horizontal root travel is intentionally dropped for **in-place preview**. A target-only **vertical pelvis translation** corrects plausible planted-foot height, but there is no full motion-path, stride-speed or stance-foot IK integration.
- The viewer's bone-coverage gate refuses an obviously incompatible skeleton instead of silently playing an empty animation.
- Skeleton-only GLBs are chosen instead of the compressed `objects`/`mobile` character files to avoid Meshopt/Basis texture decoder requirements and unnecessary geometry downloads. Despite this, external hosting and CORS must still be checked on a real device.
- There is **no production foot-lock IK, animation-to-hitbox integration, fighter-relative root-motion correction, gameplay motion segmentation or measured impact timing** for these CMU clips yet. Twist/roll around a bone's own direction also needs separate validation.
- The existing gameplay and model-selection defaults are unchanged. CMU data is **not committed** to this repo and is not sold or redistributed.
- Tests cover URL selection, synthetic bone mapping, actual upstream GLB conversion onto both UBC models, quantified arm/leg source-to-target direction fidelity (peak under 5°, mean under 1°), toe-to-ground clearance and full-clip ankle/knee clearance. Real-device WebGL visual sign-off and contact-quality review are still required before promoting anything to gameplay.

## License and provenance

The motion performances come from **Carnegie Mellon University Motion Capture Database** (https://mocap.cs.cmu.edu/), via the CodePawl `cmu-mocap-glb` conversion on Hugging Face. CMU allows use in projects (including commercial projects) but prohibits the resale of the motion data itself, including transformed/retargeted data. The dataset lists the license as **other**, not CC0. Confirm terms and preserve attribution for any eventual shipped assets.

Do not treat this conversion as a blanket permission to publish a separate commercial motion pack.

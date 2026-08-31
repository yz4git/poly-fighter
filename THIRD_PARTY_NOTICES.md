# Third-Party Notices

POLY FIGHTER includes or derives build-time/runtime assets from the third-party material listed below. Package dependencies installed through npm retain the licenses declared by their respective packages.

## Quaternius Universal Base Characters Kit

POLY FIGHTER uses the free **Universal Base Characters Kit** by **Quaternius** in two ways:

1. The Blender SERA reconstruction pipeline uses a Universal Base Characters source body/rig.
2. The selectable **UBC CC0** runtime skin uses `Superhero_Male_FullBody` for KAIRO and `Superhero_Female_FullBody` for SERA.

Runtime model provenance:

- Upstream project/author: Quaternius — Universal Base Characters
- License: **CC0 1.0 Universal (Public Domain Dedication)**
- Pinned redistribution/conversion source: `aaroohhiiii/ggj`
- Pinned source commit: `57c0855a6622d4654fe32e9208efb820051164e3`
- Imported paths: `Universal Base Characters[Standard]/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf` and `Superhero_Female_FullBody.gltf` plus their matching BIN files.
- POLY FIGHTER runtime paths: `public/models/quaternius/ubc-superhero-male-flat.glb` and `public/models/quaternius/ubc-superhero-female-flat.glb`.
- Runtime conversion removes texture dependencies, retains the skinned humanoid rig, and uses flat-shaded materials recolored from the selected fighter definition.
- Compatibility reports: `docs/quaternius-male-flat-report.json` and `docs/quaternius-female-flat-report.json`.
- Both runtime models retain **65/65** Universal Animation Library target joint names with `targetNameCoverage: 1`.
- The kit's CC0 notice is preserved at `public/models/quaternius/LICENSE-BASE-CHARACTERS.txt`.

Generated/modified POLY FIGHTER geometry that incorporates this CC0 source may be distributed subject to the project notice in `LICENSE`; the underlying Quaternius CC0 material remains CC0 and is not relicensed or restricted by that notice.

## Project reference artwork

`public/reference/female-turnaround.jpeg` is project-specific original AI-assisted reference artwork created for POLY FIGHTER during development. It is not a Quaternius asset and is not a third-party photograph or stock image. Its project-specific reuse status is covered by `LICENSE`. See `public/reference/README.md` for provenance and intended use.

## Quaternius Universal Animation Library

- Author: Quaternius
- Original library: Universal Animation Library
- License: Creative Commons Zero v1.0 Universal (CC0-1.0)
- Runtime curated GLB: `public/models/quaternius/ual-fight-core.glb`
- Runtime clips: Idle_Loop, Walk_Loop, Crouch_Idle_Loop, Jump_Start, Jump_Loop, Jump_Land, Punch_Jab, Punch_Cross, Hit_Chest, Hit_Head, Death01, Roll.
- Runtime source mirror: `Seyamalam/blood-league-kickoff` pinned at `aa02a4e6d8337a0604d2da131bcbbeb1f01badf0`.
- Verified source-library SHA-256: `4c748767741a3e495d89667b9a218b690ba9810b9517a12e960780e3ca72c4e9`.
- The library's bundled CC0 notice is preserved at `public/models/quaternius/LICENSE-ANIMATIONS.txt`.

The runtime does not assume that matching joint names also imply identical local rest rotations. Animation quaternions are retargeted as a rest-pose delta (`targetRest × inverse(sourceRest) × sourceAnimated`) before playback, while target-authored joint positions and scales remain intact. POLY FIGHTER also keeps its canonical gameplay rig alive invisibly for deterministic hitboxes. Active attacks receive imported-limb contact correction, and GUARD synchronizes the imported fists to the canonical guard pose.

POLY FIGHTER also evaluated Quaternius **Universal Animation Library 2** (CC0-1.0). The compatibility audit is retained at `docs/quaternius-ual2-model-report.json`. UAL2 is not loaded by the shipping runtime so the default iPhone payload stays smaller.

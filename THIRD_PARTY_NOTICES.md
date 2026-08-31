# Third-Party Notices

POLY FIGHTER includes or derives build-time/runtime assets from the third-party material listed below. Package dependencies installed through npm retain the licenses declared by their respective packages.

## Quaternius Universal Base Characters Kit

POLY FIGHTER uses the free **Universal Base Characters Kit** by **Quaternius** in two ways:

1. The Blender SERA reconstruction pipeline uses a Universal Base Characters source body/rig.
2. The selectable **UBC CC0** runtime model skin uses the kit's `Superhero_Male_FullBody` character, converted to an embedded GLB and normalized at runtime to POLY FIGHTER's canonical body height.

Runtime model provenance:

- Upstream project/author: Quaternius — Universal Base Characters
- License: **CC0 1.0 Universal (Public Domain Dedication)**
- Pinned redistribution/conversion source: `Seyamalam/blood-league-kickoff`
- Pinned source commit: `aa02a4e6d8337a0604d2da131bcbbeb1f01badf0`
- Imported source path: `public/assets/vendor/quaternius/night-striker.glb`
- POLY FIGHTER runtime path: `public/models/quaternius/ubc-superhero-male.glb`
- Verified imported SHA-256: `a466828c67a4acc9b2413212ce6d9cde235e3aed9b675680c14fd9673858f118`
- The asset's bundled CC0 notice is preserved at `public/models/quaternius/LICENSE-BASE-CHARACTERS.txt`.

Historical Blender SERA source provenance:

- Upstream source used by CI: `aaroohhiiii/ggj` at commit `57c0855a6622d4654fe32e9208efb820051164e3`
- Relevant upstream path: `first/assets/3d/characters/player/`

Generated/modified POLY FIGHTER geometry that incorporates this CC0 source may be distributed subject to the project notice in `LICENSE`; the underlying Quaternius CC0 material remains CC0 and is not relicensed or restricted by that notice.

## Project reference artwork

`public/reference/female-turnaround.jpeg` is project-specific original AI-assisted reference artwork created for POLY FIGHTER during development. It is not a Quaternius asset and is not a third-party photograph or stock image. Its project-specific reuse status is covered by `LICENSE`. See `public/reference/README.md` for provenance and intended use.

## Quaternius Universal Animation Library

- Author: Quaternius
- Original library: Universal Animation Library
- License: Creative Commons Zero v1.0 Universal (CC0-1.0)
- Runtime model compatibility: the imported UBC model and UAL animation targets match **65/65 joint names** (`targetNameCoverage: 1`) as recorded in `docs/quaternius-base-model-report.json`.
- Runtime curated GLB: `public/models/quaternius/ual-fight-core.glb`
- Runtime clips: Idle_Loop, Walk_Loop, Crouch_Idle_Loop, Jump_Start, Jump_Loop, Jump_Land, Punch_Jab, Punch_Cross, Hit_Chest, Hit_Head, Death01, Roll.
- Runtime source mirror: `Seyamalam/blood-league-kickoff` pinned at `aa02a4e6d8337a0604d2da131bcbbeb1f01badf0`.
- Verified source-library SHA-256: `4c748767741a3e495d89667b9a218b690ba9810b9517a12e960780e3ca72c4e9`.
- The asset's bundled CC0 notice is preserved at `public/models/quaternius/LICENSE-ANIMATIONS.txt`.

The UBC model plays the original Universal Animation Library clips directly on its matching skeleton. POLY FIGHTER keeps its own canonical rig alive invisibly for deterministic hitboxes and gameplay IK, and applies a contact correction to the imported limb during active attack frames.

POLY FIGHTER also evaluated Quaternius **Universal Animation Library 2** (CC0-1.0). The compatibility audit is retained at `docs/quaternius-ual2-model-report.json` and confirms the same 65/65 joint-name compatibility. UAL2 is not loaded by the shipping runtime so the default iPhone payload stays smaller.

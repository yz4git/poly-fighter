# Third-Party Notices

POLY FIGHTER includes or derives build-time/runtime assets from the third-party material listed below. Package dependencies installed through npm retain the licenses declared by their respective packages.

## Quaternius Universal Base Characters Kit

The Blender SERA pipeline uses the free **Universal Base Characters Kit** by **Quaternius** as a source body/rig for the current Blender-authored SERA runtime asset.

- Upstream project/author: Quaternius
- Upstream source used by CI: `aaroohhiiii/ggj` at commit `57c0855a6622d4654fe32e9208efb820051164e3`
- Relevant upstream path: `first/assets/3d/characters/player/`
- License: **CC0 1.0 Universal (Public Domain Dedication)**
- License text/source attribution is preserved in the upstream mirror used by CI.

Generated/modified POLY FIGHTER geometry that incorporates this CC0 source may be distributed subject to the project notice in `LICENSE`; the underlying Quaternius CC0 material remains CC0 and is not relicensed or restricted by that notice.

## Project reference artwork

`public/reference/female-turnaround.jpeg` is project-specific original AI-assisted reference artwork created for POLY FIGHTER during development. It is not a Quaternius asset and is not a third-party photograph or stock image. Its project-specific reuse status is covered by `LICENSE`. See `public/reference/README.md` for provenance and intended use.

## Quaternius Universal Animation Library

- Author: Quaternius
- Original library: Universal Animation Library
- License: Creative Commons Zero v1.0 Universal (CC0-1.0)
- Deterministic glTF mirror used for import: J-Ponzo/gltf-universal-animation-library
- Pinned mirror commit: e24c23cf2a1323488a3faa226ea7ea21f644b73e
- Incorporated form: normalized 30 fps motion trajectories only; no source character mesh, material, or texture is shipped.
- Imported clips: Idle_Loop, Walk_Loop, Jog_Fwd_Loop, Punch_Jab, Punch_Cross, Hit_Chest, Hit_Head, Death01.

The imported trajectories are retargeted at runtime to POLY FIGHTER's canonical IK rig. Hit detection remains driven by the game's own deterministic combat data.

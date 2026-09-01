# Motion Readability v2

## Playcheck finding

Motion Expansion v1 increased the number of named clips, but the visible fight animation still collapsed toward a small set of poses.

The main causes were:

1. several attacks reused the same `Melee_Hook` clip or substituted locomotion clips such as `Jump_Start` / `Roll` for kicks;
2. the imported Quaternius striking limb was then solved all the way back to the older procedural rig's own fist/foot contact position, erasing much of the imported clip silhouette;
3. animation packs started loading only after entering an expanded combat state, so the first attack could use the older fallback pose;
4. attack-only clips were stretched across startup, active and recovery instead of using available recovery clips;
5. the TPS audit checked damage and move IDs but did not require visually distinct active poses.

## V2 approach

- preload the motion packs during neutral gameplay;
- use the imported clip as full-body momentum rather than as the finished strike;
- apply move-specific pelvis/spine accents for jab, cross, hook, body blow, heavy strike, front/low/rising/dash kick, throw and counter;
- bias only the striking limb near impact toward the real opponent's head/body/leg target;
- keep that IK partial so authored animation remains visible;
- use separate recovery clips where available (`Melee_Hook_Rec`, `Slide_Exit`, `NinjaJump_Land`);
- use `Idle_Shield_Break` for block recoil and `LayToIdle` for wakeup;
- curate the additional UAL2 Standard clips actually present in the pinned source pack;
- capture each authored move at its active pose in WebGL and record clip/phase/bone positions.

## Source-library limitation

The pinned free UAL2 Standard GLB used by this repository contains 43 animations. It does not include dedicated unarmed kick clips. V2 therefore intentionally uses a hybrid authored-motion + opponent-weighted IK solution for kicks instead of pretending a jump/roll clip is a complete kick animation.

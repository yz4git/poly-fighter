# Poly Fighter competitive feel review — Virtua Fighter / Tekken benchmarks

Date: 2026-10-30. Benchmarks are official VF5 R.E.V.O. World Stage
[system guide](https://virtua-fighter.com/revo/jp/guide/) and Tekken 8
[battle system](https://tk8.tekken-official.jp/battle/system.php).

## Findings grounded in the latest playable build

- Strike animation and hitstop exist, but 224 move IDs include many parameter
  variants of shared base animations. That number is **not** equivalent to 224
  individually motion-captured authored techniques.
- Juggle physics, two-hit chase and meteor slam have dedicated browser tests.
  However, in neutral the player could only ATTACK or STEP: the CPU had an
  effective GUARD state but an iPhone player did not. This eliminated the
  block → punish, high/low and strike → guard → throw loops crucial to VF.
- Guard collision previously blocked low attacks with a standing guard,
  so lows did not create a defensive choice.
- Actual browser screenshots show comparatively small combatants in the wide
  camera frame and recurring silhouettes among kick families. Move count alone
  cannot remedy the lack of readable guard choices or frame advantage.
- FPS / real device performance and ranking against commercial animation
  quality cannot be asserted without iPhone capture and controlled benchmarks.

## This revision: no new touch buttons

- **Tap STEP**: committed nine-tick dodge. Still no instant invulnerability.
- **Hold STEP after the dodge**: enter standing GUARD. Block high/mid, but
  a low sweep can break through.
- **Hold BACK + STEP** after the dodge: crouch GUARD. Block low, duck high
  (high strike whiffs) but **mid attacks beat low guard**.
- **At close range, hold STEP and tap ATTACK** after the dodge: start an
  interruptible, block-bypassing THROW; it uses the existing knockdown physics,
  never magnet-snaps an out-of-range enemy to the player.
- On a successful BLOCK, derive real frame advantage from the enemy attack's
  remaining animation and the player's block stun, and present a short
  PUNISH cue when advantage is at least 5 frames. The user must still perform
  a sufficiently quick **in-range** attack: there is **no auto counter,
  extra invulnerability, auto-combo, or free damage**.
- Guard poses and a short active cue communicate high/mid vs low vulnerability.
  Existing sidestep, signature specials, keyboard controls and 224 attacks
  remain active.

## Intentional limitations / next major art pass

- The real iPhone guard's committed dodge has a startup delay; it cannot
  instantly cover an active strike. This is intended to preserve STEP risk.
- Full commercial throw-tech, wall splats, mid-combo wall hits, distinct
  full-body mocap for every variation, and a true dynamic frame-data practice
  panel are still future work, not represented here.
- Enemy low-guard adaptation and per-character guard break animations are
  limited. Existing active defense AI remains intact.
- Automated tests check guard levels and frame arithmetic; Chrome WebGL
  captures inspect displayed defensive cues and actual runtime state.

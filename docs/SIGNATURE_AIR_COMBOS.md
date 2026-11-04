# Signature attacks and air combos

This update extends each fighter from 51 to **58** techniques: **232 total** for
KAIRO, SERA, VANTA and AXION. Seven named signature attacks per fighter use
seven lightweight baked full-body choreographies derived from existing retargeted
authored strike clips. No third-party character art or game assets are copied.

## Play with iPhone ATTACK + STEP

1. Land a close ATTACK to start the normal earned-hit combo.
2. Hold the movement stick **toward** the enemy and tap ATTACK for **Skybreaker**
   (a committed upward launcher).
3. Against a physically airborne opponent, choose a real follow-up:
   **neutral ATTACK** for Aerial Barrage, **forward + ATTACK** for Wall Carry,
   **left/right + ATTACK** for signed Air Pivot. The opponent actually moves
   toward the wall or across the attack lane; the next hit is never automatic.
4. After **one actual airborne re-hit**, **back + ATTACK** chooses early
   **Meteor Slam** (damage/knockdown now, at the cost of later juggle chances).
   After two airborne re-hits, any ATTACK attempts Meteor Slam. The ender
   physically accelerates the rival downward.
5. Or use sideways movement + ATTACK from neutral for **Cyclone Sweep**; after
   a two-hit ground combo, back + ATTACK produces **Power Rush**.

Each fighter has a unique branded move name/adjusted performance, with slower
heavyweights and quicker lightweights. The attacks are *not* automatic strings.
An attack must physically connect in the correct facing/range/vertical window.
Missed, blocked, late or poorly spaced attacks do not earn more air hits.

## Guardrails and tuning

- Aerial combos are limited to two re-hits + a single slam; no infinite loops.
- After an aerial launcher, only real aerial-family moves can hit a suspended
  defender. Standard ground strikes cannot magically connect several meters up.
- Damage scales downward for successive air re-hits.
- Recovery/spacing are still player-owned and existing STEP/guard behavior is
  preserved. The only permitted long chain is an active earned air combo.
- Defenders use the shared 60Hz velocity/gravity/hitstop physics; their root
  positions are never warped toward a scripted attack endpoint.
- Camera aims upward while the aerial combo is active, but respects existing
  smoothing and travel clamps; existing pooled impact waves/lights/haptics
  accentuate high-impact finishers without new full-screen textures.
- Distinct upper-body twists and limb arcs are baked once on character loading,
  not computed by AI inference per frame.
- Original moves and opponent AI are retained; directional air follow-ups
  add choices rather than automatic damage, and the camera shots stay short.

## Validation

Run the core regression tests, lint, release build and TPS kick/visual audits.
`tests/signature-air-combos.test.ts` covers 232-move availability, seven
choreographies, source contact phase preservation, hit confirmation constraints,
height validation, max aerial hits, damage scaling and forced combo expiration.

Note: signature choreography is authored by remixing source skeleton clips;
there is no claim of seven completely new motion-captured performances. Real
iPhone frame-time and visual production quality still need device inspection.

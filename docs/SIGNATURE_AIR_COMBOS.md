# Signature attacks and air combos

This update extends each fighter from 51 to **56** techniques: **224 total** for
KAIRO, SERA, VANTA and AXION. Five new named signature attacks per fighter use
five new procedural full-body choreographies derived from existing retargeted
authored strike clips. No third-party character art or game assets are copied.

## Play with iPhone ATTACK + STEP

1. Land a close ATTACK to start the normal earned-hit combo.
2. Hold the movement stick **toward** the enemy and tap ATTACK for **Skybreaker**
   (a committed upward launcher).
3. Tap ATTACK while the opponent is physically airborne for **Aerial Barrage**.
   Land another actual aerial hit for a second Aerial Barrage.
4. Tap ATTACK again after the second airborne hit for **Meteor Slam**. The ender
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
- Existing 204 techniques and opponent AI are retained.

## Validation

Run the core regression tests, lint, release build and TPS kick/visual audits.
`tests/signature-air-combos.test.ts` covers 224-move availability, five
choreographies, source contact phase preservation, hit confirmation constraints,
height validation, max aerial hits, damage scaling and forced combo expiration.

Note: signature choreography is authored by remixing source skeleton clips;
there is no claim of five completely new motion-captured performances. Real
iPhone frame-time and visual production quality still need device inspection.

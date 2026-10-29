# Expanded combat techniques — 204-move collection

Four playable characters (KAIRO, SERA, VANTA, AXION) have 51 techniques each:

- 11 original attacks retained (including close throw).
- 40 unique per-character extensions: four variants of each of ten attack
  families: jab, straight, backfist, body blow, power punch, front kick,
  low kick, rising kick, dash kick, counter.
- **Flash:** quicker startup/recovery, lighter damage and narrower reach.
- **Drive:** forward pressure, greater reach/knockback with extra commitment.
- **Angle:** wider lateral coverage and torso/hip pivot, modest damage.
- **Breaker:** higher damage, stun and guard pressure, slower and more punishable.

Each fighter's original labels, strike hand/foot, high/mid/low classification,
launch/knockdown and signature specials remain intact. All four variants are
separate `MoveDefinition`s, with different startup, active/recovery, damage,
guard pressure, reach, tracking, knockback and power numbers.

## Existing iPhone TPS controls (no extra on-screen buttons)

- Tap **ATTACK** while standing neutral: repeats naturally cycle Base → Flash →
  Drive → Angle → Breaker → Base. Each strike's *base family* still depends on
  spacing, chain position and Fighter DNA.
- Hold joystick **toward the rival + ATTACK**: Drive variant.
- Hold joystick **away + ATTACK**: Breaker variant.
- Hold joystick **left/right orbit + ATTACK**: Angle variant.
- Reactive reversal / signature windows take priority, as before.
- STEP, attack buffering, clean-hit combo requirement and hitstop stay intact.

This adds content without multiplying buttons or modifying combo cancel rules.
The move name appears briefly for non-signature variant attacks.

## Rendered animation and boundaries

`expanded-motion-library.ts` bakes 4 visually distinct quaternion track
variations for each available authored source clip, once when the skinned
character's animation library is built. Variants change torso/shoulder/hip
coordination, striking arm or attacking leg, and a very small pelvis shift.
Contact frame time is inherited **exactly** from the original clip using
`sourceOfExpandedClip`. The supporting foot and neutral entry/recovery
quaternions are not modified.

This is not 40 independently mocapped attacks per character. Variants have
separate baked poses/timings and actual combat properties, derived from ten
original movement families. No model API, GPU inference or third-party asset
downloads are involved. The player-owned 60Hz combat simulation is unchanged.

## Validation

`npm run test:rules` checks move inventory, attack timing, per-style statistics,
variant discoverability, quaternion normalization, support foot, contact phases,
and attack handoffs. The CI build and Chrome WebGL audits remain the release
gates. Final iPhone real-device performance remains unverified until measured.

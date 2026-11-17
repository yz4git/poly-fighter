# PolyFighter — motion-system review (2026-11-18)

This is a **code + reproducible-browser** review of the playable motion pipeline,
not an artist-approved claim about the character models. The working branch
is deliberately based on the unmerged SERA Street Flow proposal (#211); neither
`main` nor Pages is changed.

## Motion ownership and invariants

| Layer | Owner | Must remain stable |
| --- | --- | --- |
| Real combat input / timers / hitstop | `FighterRuntime` at 60 Hz | No animation-driven phantom hits or changed startup/active/recovery |
| Authored motion event positions | `combat-motion-timeline.ts` | First active tick = keyed contact; recovery returns to guard |
| All attack identities, generated variants | `combat-motion-handoff.ts` + `sourceOfExpandedClip` | BF, FX, VM, Video, Range and Street Flow use one registry |
| Destination skeleton playback | `visual-quaternius-runtime.ts` | One shared mixer, locked clip time; no extra animation clock |
| Inertial blending / preservation | Kimodo + UniMate + MotionBricks adapters | Strike end-effectors exact at impact; immediate HIT/BLOCK priority |
| Eight-direction walking / sole IK | `combat-motion-clock.ts` + model finalization | No sector-boundary gait jump; shared step phase; planted soles |
| Rest/guard/turn | `stationaryTurnClip` + authored ready/guard clips | No rapid ready-turn oscillation or wrong-way frame |
| Knockdown/throw/KO/wakeup | `planCombatMotionHandoff` | Incoming reaction / landing gets priority over outgoing attack |
| Post-pose punch footlock / hit afterfeel | TPS presentation wrappers | No artificial root movement or mixed combat authority |

## Concrete defects addressed

1. **Mismatched clip registries**. The runtime knew `CM_StreetFlow_` was
   an authored attack while the handoff planner did not; combo links used a
   generic transition rather than `ATTACK_COMBO`. One classifier is now reused
   by both code paths, including generated cinematic and expanded variants,
   without confusing `BF_CounterHit` with `BF_Counter_R`.
2. **Quantized gait tempo**. Even though the eight-way locomotion blend is
   analogue, phase advance looked up the nearest 45-degree direction to
   estimate side travel. A small change across a sector boundary caused an
   abrupt tempo jump. Gait phase now advances from the real analogue lateral
   ratio of each measured move step; turn-rate and game physics are unchanged.
3. **Idle turning chatter**. An absolute angular speed of ~0.4 rad/s could
   alternate the turn and ready action each frame. Enter/exit thresholds and a
   directional reversal guard now prevent animation restarts from noisy
   micro-turns. Legitimate rapid turns are still allowed.
4. **Reaction priority gaps**. KO, ring out, throw, knockdown and tech-rise were
   able to take the general motion handoff despite their authored full-body
   posture changes. Reaction / landing interruptions now take precedence.

## Validation matrix

These cases are encoded as deterministic tests in
`tests/combat-motion-system-review.test.ts`:

- All known BF / VM / FX / Video / Range / Street Flow contact clips classify
  as attacks; reaction, block and walk clips do not.
- SERA: ready → jab = attack entry; jab → kick → palm = combo handoff;
  palm → guard / ready = release; hit interrupts a combo.
- KO, knockdown, throw, ring out and wakeup/tech-rise have intentional
  interruption or landing budgets.
- Analogue stride speed remains continuous when direction crosses 22.5° and
  67.5°; left/right mirrored movement has the same cadence.
- Idle-to-turn-and-back hysteresis is deterministic under jitter and
  instantaneous sign changes.

The actual Chrome WebGL three-strike script additionally checks the
**runtime** handoff mode and duration from rendered SERA, not only helper
functions, while the original tests continue to verify clean contact,
three real player taps, target HP changes and skinned foot/hand heights.

## Follow-up visual QA and acceptance limits

- Review recorded actual 3D frames for idle → walk → turn, backpedal/strafe,
  guard → jab, punch → kick, clean-hit combo, block/hit stun, KO, throw and
  wakeup. Check both sides and all selectable fighters.
- On iPhone Safari, specifically check touch-driven heading changes, two
  simultaneous control inputs, thumb release, screen pinch/zoom prevention and
  actual callback cadence; software Chrome/SwiftShader FPS is **not** a 60 fps
  guarantee.
- Any poor **sculpt, hair, outfit, skinning topology, facial expression or
  source keyframe** requires a legitimate artist/asset-production pass.
  Code-only interpolation cannot create production-grade geometry or
  replace missing authored animation.
- Do **not** merge or deploy until the real WebGL audits, screenshots and
  touch/performance review are acceptable. A green static test suite is not
  proof of cinematic quality.

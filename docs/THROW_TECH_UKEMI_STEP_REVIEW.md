# Poly Fighter – throw tech, ukemi, honest physical STEP audit

2026-10-30 continuation of the Tekken / Virtua Fighter-inspired gameplay
review. Original game mechanics and artwork only; no copyrighted assets.

## Two-button input (iPhone landscape)

- Near a **committed enemy throw**, tap ATTACK during the visible grab
  startup / first active frames. A valid read breaks the grab before damage,
  pushes the two fighters apart, applies short hitstop, and displays THROW BREAK.
  Attack mash before the move is committed or from far away cannot bank a
  guaranteed escape. Existing offensive interrupts still work as before.
- When **grounded after knockdown** (while the recovery window remains),
  press LEFT/RIGHT + STEP to tech-roll sideways, or BACK + STEP to roll away.
  The avatar physically moves a total of 0.48 world units over eight fixed
  60Hz ticks and recovers sooner. Roll **does not grant invulnerability**,
  and cannot be started in the air, during hitstop, or on a later wakeup frame.
- Original ATTACK/STEP directional combo inputs and all 224 moves remain.

## STEP audit correction

The old "REACTABLE STEP" audit pressed STEP with *12 telegraph ticks still
remaining*, before the enemy began their startup, then asserted this early
step must dodge the later strike. That expectation improperly turned
reactable telegraphs into guaranteed invulnerability. The improved audit
approaches real strike contact and requires a **true geometric miss** followed
by an earned PERFECT STEP/REVERSAL. This is a test correction, not a reduction
in the player's input requirement.

## Test coverage

- Pure behavior tests: timing/range/lockout for throw breaks; grounded,
  directional, once-per-knockdown tech roll and exact bounded 8-tick distance.
- Chrome WebGL: run existing two-button guard/throw + cinematic combo checks
  and extend them with actual throw-break / ukemi simulation observations and
  a PNG of the resulting 3D scene.
- Existing Reactable Step, kick sequence, motion, build and lint checks.

## Remaining work

Throw escapes and ukemi reuse existing authored reaction and ground poses;
they are **not** unique newly motion-captured moves. A full production-level
throw-tech animation and fully distinct rolling skeleton clip require a
separate art pass. Confirm real iPhone frame times on-device.

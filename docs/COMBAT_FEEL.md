# Readable combat and paired reactions

- Enemy aim is committed when its telegraph enters REACT. The visible attack
  and spatial contact use that same direction. Its short weight shift continues
  down the committed lane; an active strike cannot turn after a sidestep.
- A STEP records the threatening move until its active window. It grants no
  invulnerability. A perfect evade requires an actual lateral miss, and the
  player's position before STEP must have been inside that attack's lane.
  Early movement outside REACT and out-of-range whiffs do not award a reversal.
- Straight punches/front kicks cover a narrower lateral lane than backfists
  and low kicks. Their startup tracking is also lower. Existing startup,
  damage, recovery, hit-confirm and combo rules retain their separate roles.
- Close/far opener selection has hysteresis. Direction is captured with an
  ATTACK tap during STEP, so releasing the stick before the buffered attack
  begins does not erase the intended branch.
- Ordinary BRAWLER pressure repeats jab/straight/power; SKIRMISHER spacing
  favors kicks and a short retreat afterwards. Tactical adaptation retains
  priority. Heavy BRAWLER attacks leave a brief open reset beat.
- Resolved contact selects a head/body/leg or braced guard response and
  restarts it on repeated contacts. Each real target skeleton receives baked
  clips with early upper-body recoil, delayed hip transfer and a recovery step.
  These use the existing stun clock and single animation mixer. Attacker and
  defender presentation share the same contact tick and effect height.
  Legacy host recoil/guard tilts yield to these complete clips, and inertial
  transitions preserve their complete pelvis/leg solutions rather than mixing
  part of an outgoing stance into the planted feet.

Regression coverage includes actual fixed-step cue/STEP/contact behavior,
standing/early/far controls, touch selection, CPU phrases and both male/female
rigs' finite transforms, constant leg lengths and grounded support.
The existing kick WebGL audit additionally captures real evade/retaliation and
head/body/leg/block frames through `capture-tps-combat-feel-audit.mjs`.

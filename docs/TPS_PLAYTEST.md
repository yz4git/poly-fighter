# TPS Playtest Log

This file records real-WebGL TPS-mode playtest passes and the gameplay/readability changes that follow from them.

## 2026-08-31 — post aura-readability pass

Baseline head before this pass: `295db2dab454be534c65532f83a740d80a6d1b06`.

Goals for the pass:
- verify shoulder-camera readability at neutral and striking range;
- verify iPhone-landscape controls and HUD do not cover combat;
- verify lock-on movement, guard-step, CPU spacing and hit readability;
- improve remaining gameplay or presentation issues found in the rendered captures.

## 2026-08-31 — TPS gameplay quality pass

Implemented gameplay/presentation head: `e4ea86f30f939e57fffa52b55428a644dc8ee082`.

Real-WebGL findings and fixes:
- corrected the automated strafe probe to measure movement in lock-on tangent space rather than world X;
- retained the close-camera TPS-only attack-aura suppression so impacts do not cover the opponent;
- added `G + SIDE` quickstep without adding another mobile action button;
- quickstep has a short strike-evasion window while throws still beat it;
- lock reticle now follows the rendered chest and changes cyan/yellow/red for neutral/range/enemy-attack readability;
- enabled reticle depth testing so it no longer draws through the foreground player;
- increased close-range shoulder offset so both silhouettes remain more readable at contact;
- updated the TPS control hint to expose the quickstep.

Measured browser pass:
- lock-relative strafe: 0.87 m;
- quickstep: 0.78 m;
- deterministic close-range punch: SERA HP 100 -> 94 in 6 fixed steps;
- circular arena boundary clamp: 6.08 m;
- desktop and iPhone-landscape screenshots captured successfully.

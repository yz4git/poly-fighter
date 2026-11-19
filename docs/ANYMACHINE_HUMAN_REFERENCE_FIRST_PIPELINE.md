# Reference-first human animation QA — adapted from AnyMachine (2026-11-18)

Inspiration: [apekshik/anymachine](https://github.com/apekshik/anymachine) and its
[PIPELINE.md](https://github.com/apekshik/anymachine/blob/main/PIPELINE.md) (MIT).
This is a **method adaptation**, not a port of AnyMachine's robot geometry or
Python implementation. AnyMachine has no human-model generator or free hosted
text-to-rig API; the repo itself calls its programs experimental.

## Why this applies to PolyFighter

The older PolyFighter modeling process kept iterating procedural meshes and
animation curves without first establishing a stable approved character
turnaround, topology/weight specification and measurable joint envelope.
AnyMachine's valuable principle is: **reference sheet → mechanical/structural
specification → script-generated asset → compare identical camera views →
full-range joint sweep → re-import and engine check**. For people, this needs
anatomical retargeting, deformation-friendly topology and physically plausible
skin/cloth—not rigid hinge cylinders.

## The human-specific production gate

| Gate | PolyFighter artifact | Status |
| --- | --- | --- |
| 0. Character identity | One approved face, outfit, height and body-proportion source per KAIRO/SERA/VANTA/AXION | Missing final art approval; do not call a generic GLB production-grade |
| 1. Turnaround | Front/back/left/right + front/three-quarter at the same real scale, neutral A-pose, face close-ups | To author from approved character design; cannot infer hidden sides from one photograph |
| 2. Anatomical joint spec | Pelvis, thorax, clavicle, shoulder, elbow, wrist, hip, knee, ankle, ball and toes: measured bind pivots and local ranges | Existing UBC 65-bone retarget skeleton, now audited via machine-readable sweep |
| 3. Corrective shape anatomy | Skin weights in knees/shoulders/hips, bent-elbow and deep-crouch corrections; silhouette and hand anatomy | Not solved by AnyMachine or by this CI; must be authored/verified in Blender |
| 4. Reference pose plates | Ready, guard, forward/back/side step, jab, cross, each kick's chamber/contact/recoil, hit/block, throw, ground/wakeup | Current four-fighter baked motion library; actual contact defined by gameplay-timed event table |
| 5. Automated sweep | Every key limb has finite positions, constant segment length, bounded 120 Hz sample travel, seam continuity, stationary foot plant, contact support toe | **Implemented**: `scripts/audit-reference-first-motion.mjs` |
| 6. Same-camera comparison | Ref and actual game screenshot, front, side, three-quarter and live TPS for each key pose; log what does not match | Existing Chrome WebGL screenshots; full reference pairing still to implement after approved sheets |
| 7. Export re-import | GLB action/mesh/bone counts and independent viewer check | Existing imported GLB tested in engine; a fresh export/re-import of a replacement final human GLB is **not yet done** |
| 8. Mobile acceptance | Real iPhone Safari touch, horizontal lock, stable 60fps and memory, full fight | Unverified; desktop Chrome CI cannot certify mobile results |

## What the new no-charge automated gate does

Run:

```bash
node --import tsx scripts/audit-reference-first-motion.mjs
```

Inputs are **the project's checked-in GLBs**, including UBC male/female target
skeletons and Quaternius/Blender source animation packs. No paid generation,
no image service, and no connection to AnyMachine are required. The existing
TypeScript character definitions and `createCombatMotionLibrary` are used
directly so the test covers the real export format and baked skinned clips
instead of a separate toy rig.

The script samples KAIRO, SERA, VANTA and AXION. It explicitly samples 14
shared guard, locomotion, recovery, punch and kick clips for everyone, plus
the three Street Flow skinned moves for SERA. For each sample it checks:

- 18 named torso, limb and ball-of-foot joints exist and give finite world
  positions; measured arm/thigh/calf lengths are plausible for the actual model
  scale and remain unchanged through every evaluated animation.
- Ready/guard/locomotion loops close in 3D space and an idle model's feet stay
  approximately planted.
- At 120 samples per second (at least 40 per clip), no hand/head/foot skips
  more than 35% of body height in one sample.
- Actual authored contact phase: support-toe displacement for reference and
  SERA high kicks. The script writes measured values, and raises a failure for
  large (above 10.5% of body height) support displacements.
- A distinct pre-authored stance identity is registered for all four fighters.

Results go to `artifacts/reference-first-motion/rig-sweep-report.json` and
the GitHub Actions artifact **polyfighter-reference-first-rig-qa**. Failure
exits nonzero and writes the reasons to the report (no silent green pass).

**Limitations:** zero skin/self-intersections, cloth/rigid attachment collision,
muscle volume, realistic joint cartilage, thumb/finger articulation, or quality
of artistic poses **cannot** be established from a skeleton-only sweep. Human
hands may legitimately pass close to the torso in combat. A generic robotic
mesh-clash rejection rule would produce false positives.

## Immediate character-specific art breakdown to author

1. **SERA:** face identity, hair silhouette, shoulder-to-waist shape, wrist and
   knuckle form; side-kick knee chamber, foot extension and off-hand guard;
   add the character's three actual Street Flow contacts to the comparison deck.
2. **KAIRO:** neck/trapezius integration, broader torso and forearm mass;
   rear-heel boxing pivot, punch punch-glove silhouette, reaction recoil.
3. **VANTA:** oblique shoulder/hip counter-rotation, guard height and elbow
   separation, off-center weight transfer, distinct counter contact.
4. **AXION:** grounded stance width, hip-to-knee alignment under deep compression,
   strong support-palm/foot silhouette, weightier recovery than KAIRO.

For every body/weapon/outfit part, write its owner bone, expected volume,
deformation type (rigid vs smooth weights), camera angles in which it matters,
maximum polygon cost and whether normal-map baking is appropriate **before**
creating new geometry. Keep non-deforming hard-surface outfit fittings as
independent authorable pieces; *do not* make skin, knees, hands or faces into
AnyMachine-style hinged rigid plates.

## 2026-11-18 motion stabilisation checkpoint

Measured from the **same four real imported UBC rigs**, same 59 skinned
clips and identical approximately 120 Hz offline sweep, not inferred from
screenshots:

| Clip | Original worst 120 Hz foot travel | Corrected worst | Status |
| --- | ---: | ---: | --- |
| SERA Street Flow high kick | 0.48707 m | 0.12280 m | Under continuity budget |
| KAIRO front kick | 0.40210 m | 0.161 m | Under budget |
| SERA front kick | 0.40830 m | 0.156 m | Under budget |
| KAIRO low kick | 0.31018 m | 0.163 m | Under budget |
| SERA rising kick | 0.25267 m before first experiments; 0.333 m after the single-leg rewrite | 0.196 m | Under budget |

Overall **14 → 0** clips above the audit's normalised `0.13 ×
character-height` 120 Hz jump threshold.

The fix is not a screen blur or artificial frame interpolation:
- Include a constrained knee interior angle during the one-time authored
  two-bone IK solve, preventing near-singular overfolding.
- Solve the striking leg **once**, not once for general stance and again
  for the reference kicking leg.
- Retain the impact-time knee bend plane during the rising kick's retract arc,
  preventing the knee from crossing to the opposite IK pole side in one frame.
- Bake the 4 reference kicks and SERA's high kick with **121 pose keys per
  authored clip** instead of 49–61, preserving contact time and planned foot
  trajectories. This adds *bake-time* cost/clip data, not extra per-frame
  gameplay IK.
- At each clip's entry/recovery, blend only the striking leg/upper body toward
  the character's authored guard, without re-solving or moving the planted foot.

The reference-first QA now **fails CI** when any of these five corrected
kicks exceeds the measured jump budget. The JSON includes each kick's minimum
interpolated knee angle, actual maximum travel, joint identity, phase, and
a 7-frame skeletal trace if a jump warrants visual review.

**Limits of the evidence:** An accurate foot path is not enough to certify
the artistic kick silhouette. There is still no approved reference-image
versus exactly-matched camera contact sheet, no physical iPhone Safari
60 fps run, and no complete soft-tissue / cloth / muscle-deformation audit.

## Provenance and licensing

No AnyMachine project files or artwork are copied here, only the concept of
reference-first verification. AnyMachine uses the MIT license, but its
third-party reference generation/motion tools may have separate terms. PolyFighter
does not run its fal-based GPT Image jobs, image-to-video model, Tripo or Meshy,
and never stores private API keys in the repository.

## Acceptance

CI passing establishes **technical stability**, not commercial art quality.
Merge only after someone inspects reference-vs-actual same-camera renders and
real iPhone Safari behavior. Both main and Pages remain untouched by this
working branch.


## 2026-11-20 gait knee-plane experiment (draft PR, not published)

This follows the **foot-plant plus knee-pole** approach from open-source
three.js IK work without copying its renderer or adding a frame-by-frame IK pass.

- New `combat-gait-knee-pole.ts` steers the knee's two-bone IK **pole**
  toward each already authored step-foot path (56% of lateral displacement,
  38% of forward displacement). The knee remains outward of the sagittal
  centerline on both sides, including 8-way diagonals.
- The new pole is **only** passed to the existing one-time `CM_Move_*`
  skinned-clip bake. Guard, attacks, hits, reaction clips, foot targets,
  deterministic 60Hz simulation, and contact/hitbox timings are unchanged.
- The cache key includes the knee-pole version to prevent reusing the
  previous gait after hot reload. Regression tests exercise both anatomical
  stance widths, all eight directions, 120Hz-like sampling, loop boundaries,
  pole finiteness and non-inversion.
- The reference-first actual-GLB sweep now samples **all eight**
  locomotion directions instead of only F/B/L/R. It reports maximum
  per-sample knee travel and how far the knee moves laterally outside the
  hip-to-ankle lane, as well as existing leg-length/loop/foot checks.
  Gross knee teleports fail the gate; splay is recorded for **visual**
  review, not mislabeled an objective proof of good art.

Acceptance pending: CI, real same-camera gait filmstrips, and actual
iPhone Safari legibility/60fps. Mechanical tests cannot establish that
the new walk feels natural until a real render is compared.


## 2026-11-20 gait knee corridor calibration — second iteration

The original 8-way steering experiment steered the knee toward the foot but
kept the generic pole 2 cm (in normalized world coordinates) outside the
anatomical stance. A full imported-GLB trace still showed outward knee splay
on long sidesteps, especially the wide-stance AXION. The second iteration
uses a pole 0.004 normalized coordinates **inside** the stance foot, tracking
80% of lateral swing and 44% of forward swing. All existing foot paths,
60Hz gameplay roots, locomotion blend clock and hitboxes stay unchanged.

Matched measurement from the *same four imported 65-bone rigs*, all eight
directions, all 75 audited clips, using the same 120Hz sample sweep:

| Fighter | First steering pass: max knee outside hip–ankle lane | Calibrated pass | Approx reduction |
| --- | ---: | ---: | ---: |
| KAIRO | 0.06609m | 0.00826m | 87.5% |
| SERA | 0.04403m | 0.00070m | 98.4% |
| VANTA | 0.05293m | 0.00339m | 93.6% |
| AXION | 0.07859m | 0.01414m | 82.0% |

[Candidate 2 GLB test run #44640209697](https://github.com/yz4git/poly-fighter/actions/runs/44640209697)
completed successfully: zero structural violations, 75 audited clips and
the existing 292 core-rule tests; reference-kick and contact checks remain.
The worst per-120Hz-knee-step remains near 0.019m, not an abrupt pole flip.

The reference-first gate now fails a return of lateral knee displacement
beyond 1.8% of the model's measured height. A separate **front/profile
skeleton projection contact sheet** records four gait phases for left,
right and diagonal approaches from the actual imported GLB joints. It is
NOT a skin render, a game screenshot, or a demonstration of actual iPhone
Safari performance. Keep same-camera skinned WebGL and mobile QA as
independent approval gates before merging.

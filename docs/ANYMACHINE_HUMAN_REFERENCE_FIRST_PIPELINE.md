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

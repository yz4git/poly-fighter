# CMU motion visual acceptance review — 2026-11-20

**Decision: DO NOT PROMOTE CMU clips into live POLY FIGHTER combat or locomotion.**

This decision is based on *actual WebGL MODEL VIEW screenshots*, not on bone-track coverage or leg-distance metrics alone.

## What was checked
- Production game built and served locally in GitHub Actions.
- Real Chrome/WebGL Model View, UBC CC0 model, **SERA and KAIRO**.
- Three downloaded CMU GLBs: walk (`05_01`), boxing (`13_17`), martial-arts front kick (`135_04`).
- Four or five sampled phases per motion, both the opening camera angle and a roughly side-on angle.
- **52 PNG screenshots**, one JSON record and the browser logs; no capture errors.
- Screenshot run: https://github.com/yz4git/poly-fighter/actions/runs/44686961446 (artifact `poly-fighter-cmu-motion-visual`, retention 7 days).

## Findings from the screen

| Motion | Actual result | Decision |
| --- | --- | --- |
| WALK | Both characters hold both arms close to a T-pose throughout walking; leg stepping exists but upper body does not resemble practical walking or fight locomotion | **Reject** |
| BOXING | Arm pose stays predominantly stretched sideways; no recognizable head-covering guard or coordinated striking/return; torso bends do not resemble the existing BF/PF cross or jab | **Reject** |
| FRONT KICK | Front leg lifts high and extends; both arms continue out to the sides instead of guarding and supporting proper fighting balance; would look clearly wrong in combat | **Reject** |

The 30fps whole-clip numerical test for knees/ankles passed for all six retarget combinations. **That test was necessary but insufficient:** it checks geometric crossing only, not contact, pose semantics, or natural fight motion. The viewer's bottom toolbar also occludes part of the lower legs in captured frames, so ground-contact appearance is **not** signed off by the screenshots.

## Likely technical cause

The CMU pose-referenced transfer expresses each source joint's **delta from the first recorded frame** on top of the Quaternius character's **rest pose**, which has nearly horizontal arms. This keeps upper-body motion around the target's T-pose even when the source person makes a punch or kick. Resolving lower-leg crossing via thigh abduction does not solve the missing shoulder/arm **absolute pose calibration**, guarded elbow shape, or opponent-facing motor timing.

Other issues to address before adopting: shared source/body coordinate convention, reliable source neutral/motion reference selection (not blindly frame 0), balanced hip/shoulder offsets, foot contact and planted-foot IK, martial-arts motion segmentation, and appropriate speed/cancel/hit windows.

## What stays unchanged

- Fight runtime and KAIRO/SERA production combat animation sets stay on current authored Blender/Quaternius motion.
- The CMU assets remain **opt-in preview-only**, externally fetched from the dataset on button tap. No packaged CMU animation has been promoted.
- The CI image-capture script is useful for future retarget experiments, independent of gameplay.

## Reconsider only when

1. Walk has relaxed/fighting arm swing rather than T-pose, and uses credible weight transfer.
2. Boxing can show a recognizable guard → strike → retract → guard sequence at selected phases.
3. Front kick supports correct guard, torso counterbalance, support leg and foot grounding.
4. Both models pass front/side visual review across full action phases and remain smooth on iPhone Safari at 60fps target rendering.
5. Regression tests still show no knee inversion or swapped ankles.

This is **a rejected production adoption, not a rejection of CMU as reference motion data**. Keep it available for offline analysis/selected motion extraction only.

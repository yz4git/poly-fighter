# CMU boxing → standalone strike preview extraction

Status: **MODEL VIEW experiment, NOT approved combat animation.**

## Why this exists

The full CMU `13_17-boxing` source lasts about 40.3167 seconds.
Directly using it as a game attack would cause uncontrolled startup,
recovery, opponent distance, strike contact, cancel timing and root motion.

First the actual source wrist trajectories were scanned at 30fps.
The dominant plausible early segments showed a guard, marked forward
extension, and recovery. Later the source was analyzed at 120Hz
to identify wrist extension peaks more precisely.

The extraction in `src/game/cmu-strike-extraction.ts` creates two
**separate, non-looping, non-destructive** MODEL VIEW clips:

| Clip | Source window | Duration | Source wrist peak(s) | Within subclip |
| --- | --- | ---: | --- | --- |
| `CMU_BOXING_RIGHT_STRAIGHT` | 1.70–2.48s | 0.78s | R 2.104s | R 0.404s |
| `CMU_BOXING_LEFT_RIGHT_COMBO` | 2.74–3.76s | 1.02s | L 3.039s; R 3.262s | L 0.299s; R 0.522s |

The named motions are identifiable **candidates**, not fully authored
commercial fighting attacks. The source contact label actually denotes the
maximum **wrist forward extension in the actor's torso frame**, NOT an
opponent collision, a validated impact, or gameplay hitbox timing.

Source-derived quality gates: forward extension from the window's guard
>=0.12 units, return/retraction >=0.10 units, and maximum forward
wrist approach speed >0.70 units/second. An extraction fails closed
if these measurements are absent. Two combo contact markers must
occur in their actual source order.

## Non-destructive baking and gameplay isolation

1. Retarget the full source motion via the already-validated anatomical
   world-joint-direction method; leave `CMU_BOXING` available for A/B.
2. Read the real source hand/shoulder geometry in its animated anatomical
   hip/torso frame for the selected windows; restore all CMU bones after
   scanning, regardless of errors.
3. Sample every quaternion and vertical pelvis position track from the
   existing retarget at **120Hz in the short excerpt**, rather than
   recalculating or copying individual arm rotations. This minimizes
   double-interpolation errors around fast elbow changes.
4. Keep the entire 23-track skinned skeleton. No horizontal root motion
   is introduced, no original animation is overwritten, and no game
   move/hitbox component imports these clips.
5. Use `MODEL VIEW → UBC CC0 → CMU BOXING → RIGHT STRAIGHT / LEFT → RIGHT COMBO`.
   The timeline displays the measured wrist extension peaks. The extracted
   clips default to one-shot playback.

The 120Hz bake is a short offline/on-demand animation sample resolution;
it does **not** imply that source capture or iPhone display actually
runs at 120fps. Neither a new source GLB nor extra third-party data
is automatically fetched outside an explicit CMU BOXING selection.

## Verification against actual data and real WebGL

- [Actual source + male/female UBC clip checks](https://github.com/yz4git/poly-fighter/actions/runs/44786250611):
  **success**. Two clips on each avatar; all 23 skinned
  skeleton tracks retained; source guard→extension→recovery proven;
  each generated animation track matches full anatomy at start,
  contact and end (quaternion deviations under 1.2°).
- [Core validation, static build and regression suite](https://github.com/yz4git/poly-fighter/actions/runs/44786250292):
  **success**.
- [Real Chrome/WebGL Model Viewer captures](https://github.com/yz4git/poly-fighter/actions/runs/44786250370):
  **success**. 88 screenshots total, including 28
  new GUARD / EXTENSION PEAK / RECOVERY screenshots for
  SERA and KAIRO, both front and side cameras. The browser CI
  asserts live skeleton track consistency and that each struck
  hand actually extends then withdraws in the rendered avatar.

## Visual quality review — not gameplay ready

Inspecting the real rendered avatars showed recognizable guards and
forward arm travel. It also showed shortcomings:

- **Open hands, not fists**: the source CMU skeleton contains no
  finger-curl animation. The target UBC hand remains largely open,
  so these frames resemble palm strikes or pushes.
- **Over-pronounced torso lean / poor balance** in certain frames,
  especially the two-hit combination.
- **No foot-plant IK for boxing**. The original source's root
  translation is deliberately discarded in the in-place preview.
  Some weight shifts and foot hovering remain visible.
- A measured source wrist-extension peak cannot determine
  when a hand would actually contact an opponent. Per-move
  range, hit activation, hitstop, cancel and recovery authoring
  remains unsolved.

**Adoption decision:** keep the extraction algorithm and both clips
as opt-in MODEL VIEW reference data. Do not replace gameplay
jab/cross animation, hitboxes, gait or selected fighter meshes with
these clips.

## Next quality gates

1. Design reliable *fist closing* for the actual UBC finger rig, or
   adapt a licensed glove/fist asset; no hand pose fabrication from
   nonexistent source finger data.
2. Fix source-driven shoulder/torso roll and balance while maintaining
   source-to-avatar arm-direction fidelity.
3. Build contact-aware stance IK with horizontal root-motion/velocity
   reconciliation rather than forcing feet to impossible in-place
   targets.
4. Measure opponent-facing reach/collision, annotate
   startup/active/recovery as integer gameplay ticks, and test
   hitbox contact and cancels in a sandbox.
5. Review continuous animation, nonloop transitions and iPhone
   Safari rendering at the intended 60fps before any live-combat
   rollout.

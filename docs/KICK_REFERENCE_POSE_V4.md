# Kick Reference Pose V4

The authored grounded kicks are reconstructed from five visual checkpoints generated for this pass.

1. **START** — balanced guard, weight available to the support leg.
2. **CHAMBER / LOAD** — knee clearly folded; support foot begins its pivot; pelvis starts to travel.
3. **IMPACT / PEAK** — pelvis commits behind the strike; support foot has pivoted; torso and arms counterbalance rather than remaining rigid.
4. **RECOVERY** — the strike leg folds again before landing; torso and pelvis begin returning independently.
5. **GUARD** — both feet and the upper body resolve cleanly back into the ready stance.

The Blender generator keeps intermediate pre-contact and overtravel controls for interpolation, but the five poses above are explicit quality gates and are exported to `blender-kicks-core.metrics.json` as `referencePoses`.

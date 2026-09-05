# Motion Foundry V6.8 kick audit

V6.8 treats the generated GLB as a frame-continuity artifact, not just a set of representative poses.

## Audit scope

KAIRO is captured at every authored frame in Model View:

- `BF_FrontKick_R`: 43 frames
- `BF_LowKick_L`: 46 frames
- `BF_RisingKick_R`: 49 frames

The generated motion must retain the measured full-body prior while contact assistance remains local to the strike window.

## Contact-shape gates

V6.8 intentionally avoids the V6.7 near-lockout look at impact. The regression test therefore constrains each kick to a bent-but-readable contact shape rather than requiring maximum knee extension.

- Front: knee 140–155 deg, reach ratio 0.94–0.97
- Low: knee 129–145 deg, reach ratio 0.90–0.94
- Rising: knee 120–140 deg, reach ratio 0.87–0.92
- Low kick must remain visibly below both Front and Rising trajectories.

The final regenerated Low contact is approximately 0.429 vertical rise with a 129.99 degree knee and 0.906 reach ratio. This preserves a bent knee while restoring a recognizably low attack line.

## All-frame Low trajectory gates

Representative checkpoints are not sufficient for Low Kick. The V6.8 generator records the extrema across all 46 authored frames, and the regression test rejects a clip if an in-between frame turns the move into a waist-height middle kick.

- `allFrameStrikeFootVerticalRiseMax < 0.65`
- `allFrameStrikeFootForwardReachMax < 0.95`
- Final regenerated Low: max vertical rise `0.569691` at frame 19
- Final regenerated Low: max forward reach `0.831767` at frame 22

This specifically guards against the previous F29–F33 failure where the impact looked low but the leg rose to waist height during overtravel/recovery.

## Recovery gates

Recovery is move-specific rather than inferred from one knee-angle rule:

- Front must fold the strike knee by more than 8 degrees after impact.
- Low is primarily validated by its all-frame low-line trajectory and by the strike foot retreating/downshifting after contact; its knee may re-open while the thigh and foot descend.
- Rising is validated by spatial retraction because its thigh drops while the knee can re-open slightly.

Low therefore keeps stronger low-line contact assistance through OVERTRAVEL and a moderate assist into RECOVERY. This prevents the measured prior from lifting the foot back toward waist height before returning to guard.

The reference time warp uses eight knots: START, LOAD, PRECONTACT, IMPACT, OVERTRAVEL, RECOVERY, SETTLE, GUARD. SETTLE must occur after RECOVERY so the measured post-impact phase cannot collapse into a late one-frame snap.

## Airborne compatibility

V6.8 split the grounded-kick implementation into a thin entrypoint plus `build-fight-motion-foundry-v2-kicks-base.py`. The airborne Dash Kick historically imports the grounded entrypoint as a helper library, so the entrypoint now delegates unknown helper attributes to the shared base. This preserves the existing helper API (`body_axes`, guard helpers and metric helpers) without duplicating implementation.

The compatibility repair was verified by regenerating `BF_DashKick_R`: Blender generation, airborne metrics/GLB validation, airborne contract tests, production build, rules/lint and generated-artifact publication all pass.

## Final visual result

The regenerated 138-frame KAIRO audit was reviewed frame by frame. The old Low F29–F33 waist-height horizontal extension is gone; the new sequence stays bent and descends toward guard. Front and Rising remain continuous through their complete authored frame ranges.

Do not merge V6.8 until the generated GLB is committed and the all-frame audit has captured all 138 KAIRO kick frames successfully and the resulting image sequence has been visually reviewed.

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
- Low: knee 130–145 deg, reach ratio 0.90–0.94, vertical rise below 0.65
- Rising: knee 120–140 deg, reach ratio 0.87–0.92
- Low kick must remain visibly below both Front and Rising trajectories.

The accepted regenerated Low contact is approximately 0.456 vertical rise with a 131.1 degree knee and 0.911 reach ratio. This preserves a bent knee while restoring a recognizably low attack line.

## Recovery gates

Recovery is move-specific rather than inferred from one knee-angle rule:

- Front must fold the strike knee by more than 8 degrees after impact.
- Low must fold the knee by at least 3 degrees, drop the strike foot by more than 0.25, and stop extending forward (recovery no more than 0.08 beyond impact).
- Rising is validated by spatial retraction because its thigh drops while the knee can re-open slightly.

For the accepted regenerated Low candidate, impact-to-recovery moves from about 0.456 to 0.050 in strike-foot rise while forward position changes only from about 0.791 to 0.797. That is treated as a deliberate downward retraction instead of the old late snap.

The reference time warp uses eight knots: START, LOAD, PRECONTACT, IMPACT, OVERTRAVEL, RECOVERY, SETTLE, GUARD. SETTLE must occur after RECOVERY so the measured post-impact phase cannot collapse into a late one-frame snap.

Do not merge V6.8 until the generated GLB is committed and the all-frame audit has captured all 138 KAIRO kick frames successfully and the resulting image sequence has been visually reviewed.

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
- Low: knee 130–145 deg, reach ratio 0.90–0.94
- Rising: knee 120–140 deg, reach ratio 0.87–0.92
- Low kick must remain visibly below both Front and Rising kick trajectories.

## Recovery gates

Front and Low must visibly fold the strike knee after impact. Rising is validated by spatial retraction because its thigh drops while the knee can re-open slightly.

The reference time warp uses eight knots: START, LOAD, PRECONTACT, IMPACT, OVERTRAVEL, RECOVERY, SETTLE, GUARD. SETTLE must occur after RECOVERY so the measured post-impact phase cannot collapse into a late one-frame snap.

Do not merge V6.8 until the generated GLB is committed and the all-frame audit has captured all 138 KAIRO kick frames successfully.

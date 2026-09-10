# TPS Close Punch Lane

This presentation-only layer improves close-range readability for `jab`, `straight`, and `bodyBlow` in TPS mode.

- It preserves authored Blender arm, elbow, wrist, and fist animation.
- It adds a small imported-host lateral offset plus torso yaw/roll near contact.
- It activates only at close range and releases shortly after the active frames.
- It does not change `FighterRuntime.position`, hitboxes, reach, startup, active/recovery timing, input, lock-on, or camera targeting.
- `bodyBlow` remains compatible with the existing level-change presentation pass.

Regression coverage lives in `scripts/capture-tps-close-punch-lane-audit.mjs` and records PNGs plus `tps-close-punch-lane.json`.

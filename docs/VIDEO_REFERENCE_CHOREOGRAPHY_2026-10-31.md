# User-supplied 10-second martial arts video → Poly Fighter choreography

Date: 2026-10-31

## Reference video breakdown

Analyzed the uploaded portrait 512 × 768, 30 fps, ten-second video
via time-sampled frames. The footage is a stylized visual reference, **not**
a motion-capture file or 3D joint data. No media is added to the game's
production bundle.

| Approx. source time | Observed movement | In-game interpretation |
| --- | --- | --- |
| 0–0.7 s | Close upright guard, shoulders relaxed | Stable guard preparation/return |
| 0.8–1.6 s | Short straight fist extension, opposite arm shielding face | **Jab**: quick counter-rotating hip and shoulder, end-of-reach at contact |
| 2.4–3.4 s | Body shift and palm-up / palm-out guarding strike | **Backfist**: lateral body load, palm-style extension, forearm and wrist turn |
| 4.4–5.2 s | Knee chamber, weight on support leg, outward thrust | **Kick**: grounded support foot, knee load, lateral lean, extension and retraction |
| 5.3–7.4 s | Turning body, high single-leg strike and balanced landing | **Rising kick**: staged rotating pivot, high kick, guarded recovery |
| 7.5–10 s | Finishing punch and relaxed reset | Brief controlled recoil and defensive return |

## Implementation

The reference is manually translated into **four full-skeleton clips**, sampled
at 51 or 69 keys using the existing Quaternius/UBC calibrated IK skeleton:
`CM_Video_Jab`, `CM_Video_Palm`, `CM_Video_SideKick`,
`CM_Video_SpinKick`. The motion sampler is deterministic and shared by all
fighters with compatible source limb. All animations visibly return to a
guard. First ACTIVE strike tick coincides with normalized contact key 0.50
in `combat-motion-timeline.ts`.

The standard TPS ATTACK context already selects these accessible moves:
neutral close ATTACK for **jab**; BACK + ATTACK for **backfist**;
long-range ATTACK for **kick**; aerial/launcher context for **risingKick**.
One carefully chosen pivot variation reuses the spinning motion. Other
expanded variations and signature mechanics remain intact.

This is NOT a replacement for full-body motion-capture retargeting. Face,
hair, cloth simulation, finger articulation, and exact frame-by-frame motion
of the source person are not reconstructed. Rotational pivot is pose-only;
strike contact and world displacement are always determined by existing
gameplay physics. No automatic attacks are added.

## Verification

- Pure tests: contact phase, arm/hip distinction, knee chamber, foot support,
  high-kick extension, settled 2π turn, finite blended joint targets.
- Chrome WebGL audit: in an actual fight, initialize each of the four moves,
  assert the correct renderer clip is selected, assert all four clips were
  installed, save a screenshot per active strike pose, and ensure existing
  stand/low guard, throws, ukemi and air-combo audits still run.
- Device caveat: browser WebGL screenshots are not a measurement of iPhone
  physical-device 60fps or a guarantee that the reference likeness is exact.

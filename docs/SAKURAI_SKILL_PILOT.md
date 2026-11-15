# sakurai-skill pilot: readable combat impact (2026-11-14)

## Goal

Make one-button TPS strikes feel intentional and readable **without adding moves, meters, buttons or input delay**. This pilot tests three design ideas from [kociden/sakurai-skill](https://github.com/kociden/sakurai-skill), an unofficial compilation of the *Masahiro Sakurai on Creating Games* videos:

- **036 / 062 — Attack silhouette and contact pose:** the impact moment needs to express the attack family. A light variant of a heavy technique should still feel like that heavy technique.
- **130 — Hit marks:** sparks should communicate what happened with minimal occlusion.
- **191 / 245 — Risk/reward and distinctive strengths:** a guarded heavy attack should visibly carry more weight than a guarded jab, while still being less rewarding than a clean hit.

These are project interpretations of the ideas, not copied content and not an official endorsement.

## Baseline found in the current PolyFighter code

- Core TPS combat already has startup, recovery, hitstop, guard levels, punish windows and directional evasion.
- The hype presentation already uses light / medium / heavy visual tiers and 3 / 5 / 9 ticks of clean-hit shared hitstop.
- The hype tier used only `move.id` and numeric `power`. Expanded techniques use distinct IDs and `motionBase`, so a fast variant of an authored POWER/BACKFIST technique could be read as a light strike.
- **Every guard** received the same 1-tick presentation stop and identically sized subdued guard sparks, regardless of attack family.

## Changes in this pilot

1. **Authoring-aware tiers:** `tpsHypeImpactTierForMove` resolves the original `motionBase`, original ID and numeric power; cinematic-role techniques always use the heavy tier. All other combat values remain untouched.
2. **Graded guard impact:** shared guard presentation stop is 1 / 2 / 3 ticks for light / medium / heavy, always shorter than clean hitstop (3 / 5 / 9).
3. **Readable defensive contact:** the pooled single-layer guard spark has modest tier-scaled size/brightness/lifetime, with no arena shockwave or extra particle layers. Tiny camera response is also tier-scaled. No new textures, meshes or shader passes.
4. **Regression tests** verify derived move tiers, asymmetric guard vs clean impact and guard-spark limits.

## What does NOT change

- No damage, active frames, startup, recovery, physics, input mappings, hitboxes, combo-confirm rule or CPU logic changes.
- No changes to SERA art/model PRs, GLB asset licensing or model selection.
- No modification to the published `main` build until this PR is reviewed/merged.

## Validation and acceptance

Automated:
- `npm run test:ci:static`
- `npm run lint`
- `npm run build`

Manual on **iPhone Safari landscape**:
1. Guard a jab, a body blow/kick and a slow power strike. Heavier blocks should read as weightier while still looking unmistakably *blocked*.
2. Compare a derived POWER SNAP and plain POWER. Both should read as heavy-family hits; neither should gain automatic contact or damage from the presentation change.
3. Side-step a committed heavy strike; verify physical whiff and punish timing still work.
4. Repeat 15 seconds of rapid ATTACK/STEP inputs; check frame pacing, control responsiveness, black-frame artifacts and unwanted zoom.
5. Check both a blocked and clean-hit event at reduced camera-shake settings, and verify visible silhouettes.

**Status:** Code and unit tests are included in the branch. A real iPhone visual/performance acceptance test is still required before calling the experience improved or merging to `main`.

## Follow-up if accepted

Review punch/kick pose silhouettes at impact and character-specific follow-through with actual device captures before increasing VFX. Do not treat extra particle density as a replacement for readable body poses.

## Phase 2: authored silhouette timing, same combat rules

The reference motion skill highlights **036 (attack breakdown)**, **049 (instant readable startup)**, **062 (contact pose)** and **077 (follow-through)**. The game's `combat-motion-timeline.ts` now assigns light punches, committed punches, heavy strikes and kicks distinct **animation sampling** profiles.

- **Anticipation:** heavy strikes show a modest windup pose on their first accepted rendered tick, instead of waiting for interpolation to leave neutral.
- **Contact:** the exact original authored contact key remains at the *first ACTIVE gameplay tick*; no hit detection or startup timers are shifted.
- **Overtravel:** the ACTIVE pose continues a modest distance through the authored clip. Heavy and rotating moves travel farther than jabs, rather than appearing to freeze at the same near-contact key.
- **Follow-through:** heavy strikes briefly retain the end of that clip's active arc into RECOVERY before sampling back to neutral, without extending recovery or lockout time.
- **Variants:** expanded moves inherit their base clip's readable anticipation/contact/recovery sampling via `sourceOfExpandedClip`.

No new animations, procedural limb deformation or geometry have been created; this is a targeted, reversible **timing remap over existing authored Blender keyframes**. It needs actual video-frame review before claiming visual quality. Existing punch/kick and model-preview contracts remain unchanged.

**Phase 2 audit:** compare jab, straight, power and rising kick on the same opponent and camera, including startup frame 0, first ACTIVE, last ACTIVE and first RECOVERY; also compare the POWER SNAP expanded variation. Reject the experiment if an arm passes through the chest, a planted foot skates, a fast jab feels delayed or an idle transition snaps.

## Phase 3: afterfeel consistency and evidence review

The completed Phase 2 GitHub WebGL audits show **all eight checks passing** for commit `18aeddf`. The browser-rendered images were compared against the prior commit's screenshots:

- Same-position contact screenshots for jab, straight, body blow, backfist, power and kicks still look broadly similar. This is **expected**, since the first active tick is intentionally anchored to the same authored contact key.
- Motion-readability diagnostics show distinct punch silhouettes at capture: jab/straight distance `2.515`, backfist/bodyblow `6.673`, backfist/power `4.338`, bodyblow/power `3.542` (sum of selected joint-space point distances in the audit; **not** a quality rating or a before/after improvement score).
- Rendered strike heights retain low kick `0.908`, front kick `2.123` and rising kick `2.415` (audit world units).
- **Important:** one still image cannot prove whether the new windup/hold timing feels better. Real iPhone Safari review remains a release requirement.

**Newly fixed issue:** the imported-model `motion-reaction.ts` afterfeel and combo momentum classifier previously checked only exact move IDs. `powerSnap`, `backfistPivot`, `lowKickDrive`, and other generated variants silently fell back to a generic punch tail. Both end-of-attack and combo-link afterfeel now use their actual `motionBase`. Cinematic moves receive explicit heavy/sweep handling. Tests cover four variants across the base families, including cinematic roles. Only small presentation-layer transforms are affected, not gameplay timing or balance.

**Next review priority:** sample and inspect motion at startup, first ACTIVE, late ACTIVE and early RECOVERY on a consistent fixed camera, rather than judging from the contact frame alone; also assess foot stability and arm silhouette in a real 60 fps iPhone capture before merging.

## Phase 9: contact-aware planted-foot IK (measured in actual WebGL)

**Problem:** the contact camera uses a cosmetic close-neutral lane and a second
punch lane to keep both fighters visible. The previous Phase 8 correction stopped
the one-frame teleport but moved the *entire* imported model, including both
planted boots, sideways through jab startup.

**Implementation:** a final `tps-grounded-punch-footlock.ts` presentation
wrapper now captures both ankle positions from a stable close neutral, follows
the real fighter's gameplay translation, and applies bounded two-bone IK to
`thigh/calf/foot` bones on jab, straight and body blow. The support leg has
higher weight; each foot target is clamped to **0.16 world units** correction.
The authored torso, punch-contact hand, camera, hitboxes, damage, input and
locomotion code remain unchanged. IK fades out during recovery. Kicks, jumps,
throws and combo-followup attacks never inherit old idle foot anchors.
References to imported rig bones are cached to avoid repeated scene-tree
searches on 60 Hz mobile frames.

**Measured result:** comparing production WebGL artifact
[baseline #43625267499](https://github.com/yz4git/poly-fighter/actions/runs/43625267499/artifacts/14126016731)
with
[IK #43627352753](https://github.com/yz4git/poly-fighter/actions/runs/43627352753/artifacts/14127131918),
using the same close neutral and continuous eight-frame jab:

| Motion metric (world units) | Prior | With foot IK |
| --- | ---: | ---: |
| Peak left-foot horizontal displacement from neutral | 0.2492 | 0.1271 |
| Peak right-foot horizontal displacement from neutral | 0.2164 | 0.0560 |
| Largest per-tick left-foot travel | 0.1022 | 0.0648 |
| Largest per-tick right-foot travel | 0.1013 | 0.0507 |
| First-frame host displacement | 0 | 0 |
| Gameplay-root displacement | 0 | 0 |
| Left striking-hand horizontal reach at jab contact | 1.1926 | 1.1915 |

Actual screenshots show no obvious broken knee geometry at contact. The
post-IK browser audit requires planted-foot drift to remain below bounded
thresholds and the striking-hand reach to remain at least 1.1 world units.
The next release gate remains a real iPhone Safari 60 fps play session,
because a fixed-camera CI pose cannot rule out all visual ankle pops.

## Phase 11: overlap the jab stance and strike lanes instead of increasing IK

**Measured bottleneck:** Phase 10's CONTACT_FOOT_IK_V2 left only
0.06871 world units of lead boot drift, but the worst displacement remained
at jab startup ticks 3-4. The close-neutral screen lane was releasing faster
than the close-punch silhouette lane was entering. Both move the entire imported
visual host, forcing the planted boot IK to absorb an avoidable transient.

**Change:** in `tps-close-punch-lane.ts`, `SHOULDER_CONTACT_LANE_V3`
begins loading the **jab only** one startup tick earlier (at startup - 5
instead of startup - 4). It still begins at zero, reaches contact via the
same eased smoothstep and leaves the cross/body-blow timing untouched.
No more ankle reach, no extra pelvis translation, no game physics changes.

**Actual continuous 60 Hz TPS WebGL evidence:**
[previous V2 / run 43663250347](https://github.com/yz4git/poly-fighter/actions/runs/43663250347/artifacts/14140418802)
versus
[V3 / run 43666449616](https://github.com/yz4git/poly-fighter/actions/runs/43666449616/artifacts/14142520957).

| Measurement, game-world units unless noted | V2 | V3 |
| --- | ---: | ---: |
| Maximum jab left-boot horizontal drift from planted idle | 0.06871 | **0.02103** |
| Maximum jab right-boot horizontal drift | 0.05603 | **0.000000013** |
| Maximum left-boot travel in a single simulation tick | 0.04980 | **0.00783** |
| Maximum right-boot travel in a single simulation tick | 0.05074 | **0.00262** |
| Maximum imported visual-host travel per tick | 0.10748 | **0.06670** |
| Striking left glove's horizontal travel at ACTIVE contact | 1.19146 | **1.18502** |
| Point-blank jab chest screen separation | 94.91 px | **95.97 px** |

At the same time, the gameplay root remained exactly stationary and the
initial neutral-to-attack frame did not acquire a position teleport.
The contact-camera audit still exceeds its **90 px** chest readability floor,
and both cross and body blow retain their original presentation profiles.
The final foot-IK correction remains bounded and unchanged; V3 reduces the
need for that correction rather than applying a stronger constraint.

The browser CI now rejects a reintroduced jab startup glide above **0.045**
(left) / **0.025** (right), per-tick glide above **0.022** for either foot,
imported-host travel above **0.085** per tick, loss of V3 contact-lane
telemetry, or striking-hand contact travel below **1.15** world units.

**Limits:** headless WebGL screenshots and bone coordinates establish
the measured correction but do not substitute for landscape iPhone Safari
60 fps input, long combo loops, or skinning stress tests. Main stays unchanged
until explicitly reviewed and merged.

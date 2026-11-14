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

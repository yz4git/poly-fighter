# Procedural Fight Motion Generator v1

POLY FIGHTER now generates a lightweight combat-only GLB inside GitHub Actions instead of relying only on third-party animation names.

## Pipeline

1. `public/models/quaternius/ual-fight-core.glb` is the stable 65-joint UAL source skeleton and base body-motion library.
2. `scripts/generate-procedural-fight-motions.mjs` clones a known-good base action for each generated move and applies deterministic additive rotation curves to pelvis, spine, clavicles, arms and legs.
3. `.github/workflows/procedural-fight-motion-generator.yml` generates `procedural-fight-core.glb` plus metrics and commits them back to the current branch.
4. `motion-expansion-runtime.ts` loads UAL1 + UAL2 + the procedural pack, retargets all three to the current KAIRO/SERA UBC skeleton and keeps the old packs as fallbacks.
5. `motion-profile.ts` routes the 11 combat moves to `PF_*` clips. Opponent-weighted IK is intentionally weaker than before so the generated body motion remains visible.
6. `capture-motion-readability-audit.mjs` requires the procedural pack to preload and captures all 11 moves during their ACTIVE frame in real WebGL.

## Generated v1 clips

- PF_Jab_L
- PF_Cross_R
- PF_Backfist_R
- PF_BodyBlow_L
- PF_Power_R
- PF_FrontKick_R
- PF_LowKick_L
- PF_RisingKick_R
- PF_DashKick_R
- PF_Throw
- PF_Counter_R
- PF_HitHeavy
- PF_Launch
- PF_DownBack
- PF_Wakeup

## Design rule

The generator uses authored source movement as a continuity scaffold but generates POLY FIGHTER-specific body mechanics on top. This is deliberate: fully synthetic T-pose-to-strike animation is cheap to generate but tends to lose weight transfer and foot continuity. The procedural-remix approach keeps a stable human motion baseline while making attack anticipation, hip/torso rotation, strike height and recovery data-driven and reproducible.

All generated clips are motion-only: meshes, skins, materials and textures are removed from the exported pack.

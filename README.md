# POLY FIGHTER

POLY FIGHTER is an original, textureless 3D fighting game for iPhone Safari.
Its art direction is **HIGH-POLY FLAT SHADING**: the visual language of early
3D fighters rebuilt with denser angular meshes, strong color planes, and clean
future architecture.

## Play

- Open the published Site in Safari in landscape orientation.
- Choose a fighter and CPU difficulty.
- Use the left direction pad for movement, crouch, jump, and sidestep.
- Use `P` for punch, `K` for kick, and `G` for guard.
- Direction + button commands include low attacks, rising attacks, dash kicks,
  counters, power attacks, and throws.

## Included systems

- Three.js WebGL renderer with a safe initialization fallback.
- Procedural faceted humanoids driven by `FighterDefinition` data.
- Fixed 60 Hz combat simulation with input buffering and command parsing.
- High / Mid / Low / Throw hit levels, guard, hit stun, block stun, throw
  escape, knockdown, wakeup, KO, and ring out.
- Two original fighters: KAIRO (power) and SERA (speed), 11 moves each.
- State-based CPU with Easy, Normal, and Hard behavior.
- Impact flash, polygon fragments, synthesized Web Audio, haptics, and camera
  shake.
- iPhone-safe touch controls, safe-area layout, PWA manifest, and versioned
  service worker cache.

## Development

```sh
npm run build
npm test
npm run lint
```

The source is organized under `src/game/` so combat rules remain independent
from the renderer and the playable Site shell stays in `app/`.

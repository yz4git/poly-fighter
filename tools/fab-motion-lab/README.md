# FAB Motion Lab — PolyFighter proof of concept

**Status:** Format adapter tested with a synthetic NPZ fixture; browser/real FAB inference not yet validated. The built-in punches and kicks are hand-authored *synthetic motion*, not AI inference from video. No modifications to PolyFighter production gameplay.

## Files
- `fab_npz_to_json.py`: convert the `fab-world` **world-space** `.npz` (`joints`, `valid`, `fps`, `contacts`) into browser-readable `fab-smpl24-joints-v1` JSON. Requires Python 3.10+ and `numpy`.
- `fab-motion-lab.html`: iPhone-friendly Three.js SMPL24 3D stick-skeleton player, with contact indicators, orbit and scrubbing. This standalone page loads Three.js 0.185.1 from jsDelivr at runtime (internet required).
- `synthetic-input.npz` / `synthetic-output.json`: test fixtures ONLY, not real FAB estimation results.

## Reproduce the adapter smoke test

```sh
python3 -m pip install numpy
python3 fab_npz_to_json.py synthetic-input.npz converted.json
# Open fab-motion-lab.html in a browser, click "FAB JSON 読込", select converted.json.
```

The parser requires 24 SMPL world joints per frame, expressed as **x/y horizontal and z up**, in meters. The viewer displays Three.js axes `X=x`, `Y=z`, `Z=-y` and keeps the actor's root translation relative to its first frame. Invalid frames are marked gray and hold the last valid pose.

## Run actual FAB (requires your own authorised dependencies and a suitable machine)

Follow [FAB upstream instructions](https://github.com/noahcao/FAB) for installations and licensing. You must separately accept SAM 3D Body and download SMPL; the model weights themselves are **research/noncommercial only**. Do not publish model weights in the game repository or run untrusted pickled outputs.

```sh
# From the official FAB repository, after all dependencies and model files are installed:
fab-world ./input-kick.mp4 --out output/world --fab S
# output/world/input-kick.npz is produced by FAB, if inference completes.
python3 fab_npz_to_json.py output/world/input-kick.npz ./kick.json
# Open fab-motion-lab.html, choose kick.json.
```

`fab-world` requires CUDA, environment setup and significant disk space. A CPU-only Python API exists for image predictions, but it is **not equivalent to `fab-world`'s camera/world reconstruction**. No GPU or locked model assets were present in the evaluation environment; real inference has not been performed.

## What this proves / does NOT prove

**Proven locally:** synthetic `(T,24,3)` FAB-world-shaped NPZ converts into JSON with valid time/frame data and contact flags. JSON output was parsed and frame/joint count checked. JavaScript syntax was checked with Node.

**Not yet proven:** end-to-end FAB accuracy on actual fighting videos, fit on RTX 3070 8GB VRAM, real iPhone rendering or any mapping to PolyFighter's existing fighter rigs and AnimationClips. The preview draws a 3D skeleton, not an animated GLB skin. Fighter rig retargeting would require rest-pose-aware mapping, foot constraints/IK, hip/root motion handling and frame alignment with gameplay hit windows. `fab-world` output itself is not a drop-in Three.js AnimationClip.

## Source & licenses

FAB official repository: https://github.com/noahcao/FAB — weights are for research/noncommercial use. Our adapter/demo is independently written, contains no weights, and does not change upstream rights. Three.js is MIT licensed and loaded from jsDelivr.
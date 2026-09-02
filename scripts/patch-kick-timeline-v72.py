from pathlib import Path

p = Path('src/game/motion-expansion-runtime.ts')
s = p.read_text()
old = '''  if (tick < move.startup + move.active) {
    const progress = THREE.MathUtils.clamp((tick - move.startup) / Math.max(1, move.active), 0, 1);
    const impactAt = 0.46;
    if (progress <= impactAt) {
      return THREE.MathUtils.lerp(timing.pre, timing.impact, smooth01(progress / impactAt));
    }
    return THREE.MathUtils.lerp(timing.impact, timing.over, smooth01((progress - impactAt) / (1 - impactAt)));
  }
'''
new = '''  if (tick < move.startup + move.active) {
    // Gameplay hitboxes become live on the first ACTIVE frame, so the visible
    // strike must already be at authored contact at that exact boundary.
    // STARTUP ends at PRE/chamber; ACTIVE snaps to IMPACT then carries through
    // OVERTRAVEL. This removes the old invisible-hit gap while preserving recoil.
    const progress = THREE.MathUtils.clamp((tick - move.startup) / Math.max(1, move.active - 1), 0, 1);
    return THREE.MathUtils.lerp(timing.impact, timing.over, smooth01(progress));
  }
'''
if old not in s:
    raise SystemExit('v7.1 active phase block not found')
s = s.replace(old, new, 1)
s = s.replace('"PHASE_ALIGNED_KICK_V1"', '"PHASE_ALIGNED_KICK_V2"')
p.write_text(s)
print('patched PHASE_ALIGNED_KICK_V2')

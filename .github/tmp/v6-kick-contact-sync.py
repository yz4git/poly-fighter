from pathlib import Path

path = Path("src/game/visual-quaternius-runtime.ts")
text = path.read_text()

anchor = """function proceduralAttackClip(moveId: string): string | null {
  return PROCEDURAL_ATTACK_CLIPS[moveId] ?? null;
}
"""

insert = """function proceduralAttackClip(moveId: string): string | null {
  return PROCEDURAL_ATTACK_CLIPS[moveId] ?? null;
}

// The exported V6 mocap clips intentionally retain a readable anticipation arc,
// so their authored IMPACT pose lands around the middle of each clip. Gameplay,
// however, can connect on the first ACTIVE tick. Lock the three grounded V6 kicks
// to their measured impact phase at ACTIVE start, hold only a narrow contact arc
// through ACTIVE, then spend the remaining time on recovery. This keeps hit timing
// unchanged while making the rendered foot and gameplay hitbox agree.
const V6_KICK_CONTACT_PHASE: Readonly<Record<string, number>> = {
  BF_FrontKick_R: 0.5476190476190477,
  BF_LowKick_L: 0.5333333333333333,
  BF_RisingKick_R: 0.5625,
};
const V6_KICK_ACTIVE_RELEASE = 0.035;

function syncV6KickContactPhase(runtime: QuaterniusRuntime, fighter: FighterRuntime): void {
  const move = fighter.currentMove;
  const action = runtime.currentAction;
  const clip = runtime.clips.get(runtime.currentClip);
  const impactPhase = V6_KICK_CONTACT_PHASE[runtime.currentClip];
  if (fighter.state !== "ATTACK" || !move || !action || !clip || !Number.isFinite(impactPhase)) return;

  const totalTicks = Math.max(2, move.startup + move.active + move.recovery);
  const activeStart = THREE.MathUtils.clamp(move.startup, 0, totalTicks - 1);
  const activeEnd = THREE.MathUtils.clamp(move.startup + move.active - 1, activeStart, totalTicks - 1);
  const tick = THREE.MathUtils.clamp(fighter.moveTick, 0, totalTicks - 1);
  const releasePhase = Math.min(0.64, impactPhase + V6_KICK_ACTIVE_RELEASE);
  let sampledPhase = 0;

  if (tick <= activeStart) {
    const alpha = activeStart > 0 ? tick / activeStart : 1;
    sampledPhase = THREE.MathUtils.lerp(0, impactPhase, alpha);
  } else if (tick <= activeEnd) {
    const span = Math.max(1, activeEnd - activeStart);
    sampledPhase = THREE.MathUtils.lerp(impactPhase, releasePhase, (tick - activeStart) / span);
  } else {
    const span = Math.max(1, totalTicks - 1 - activeEnd);
    sampledPhase = THREE.MathUtils.lerp(releasePhase, 1, (tick - activeEnd) / span);
  }

  // AnimationMixer still owns fade weights; only the authored clip clock is
  // phase-locked. update(0) evaluates the newly sampled time without advancing
  // hit-stop or crossfade time a second time.
  action.timeScale = 0;
  action.time = clip.duration * THREE.MathUtils.clamp(sampledPhase, 0, 1);
  runtime.mixer.update(0);
  runtime.host.userData.quaterniusKickTimingPolicy = "V6_ACTIVE_CONTACT_SYNC";
  runtime.host.userData.quaterniusKickSampledPhase = sampledPhase;
}
"""

if "V6_ACTIVE_CONTACT_SYNC" not in text:
    if anchor not in text:
        raise SystemExit("proceduralAttackClip anchor missing")
    text = text.replace(anchor, insert, 1)

old = """  playClip(runtime, desired.name, desired.loop, desired.speed, restartingAttack || restartingReaction);
  advance(runtime, timeSeconds, fighter.hitStop > 0);
  const correctionsEnabled = motionCorrectionsEnabled();
"""
new = """  playClip(runtime, desired.name, desired.loop, desired.speed, restartingAttack || restartingReaction);
  advance(runtime, timeSeconds, fighter.hitStop > 0);
  syncV6KickContactPhase(runtime, fighter);
  const correctionsEnabled = motionCorrectionsEnabled();
"""

if "syncV6KickContactPhase(runtime, fighter);" not in text:
    if old not in text:
        raise SystemExit("update hook anchor missing")
    text = text.replace(old, new, 1)

path.write_text(text)

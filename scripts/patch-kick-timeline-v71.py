from pathlib import Path

branch_files = {
    'profile': Path('src/game/motion-profile.ts'),
    'runtime': Path('src/game/motion-expansion-runtime.ts'),
    'tests': Path('tests/motion-expansion.test.ts'),
}

profile = branch_files['profile'].read_text()
for old, new in [
    ('kick: { clip: "PF_FrontKick_R", recoveryClip: "PF_KickRecover", style: "FRONT_KICK",', 'kick: { clip: "PF_FrontKick_R", style: "FRONT_KICK",'),
    ('lowKick: { clip: "PF_LowKick_L", recoveryClip: "PF_KickRecover", style: "LOW_KICK",', 'lowKick: { clip: "PF_LowKick_L", style: "LOW_KICK",'),
    ('risingKick: { clip: "PF_RisingKick_R", recoveryClip: "PF_KickRecover", style: "RISING_KICK",', 'risingKick: { clip: "PF_RisingKick_R", style: "RISING_KICK",'),
    ('dashKick: { clip: "PF_DashKick_R", recoveryClip: "PF_KickRecover", style: "DASH_KICK",', 'dashKick: { clip: "PF_DashKick_R", style: "DASH_KICK",'),
]:
    if old not in profile:
        raise SystemExit(f'motion profile pattern missing: {old}')
    profile = profile.replace(old, new, 1)
branch_files['profile'].write_text(profile)

runtime = branch_files['runtime'].read_text()
marker = 'function attackWeights(fighter: FighterRuntime): AttackWeights {'
if marker not in runtime:
    raise SystemExit('attackWeights marker missing')
helper = '''function phaseAlignedAttackPoseU(fighter: FighterRuntime, tick: number): number {
  const move = fighter.currentMove;
  if (!move) return 1;
  const total = Math.max(1, move.startup + move.active + move.recovery);
  if (move.animation !== "kick") return THREE.MathUtils.clamp(tick / total, 0, 1);

  const timing = motionTimingForMove(move);
  if (tick < move.startup) {
    const progress = THREE.MathUtils.clamp(tick / Math.max(1, move.startup), 0, 1);
    return THREE.MathUtils.lerp(0, timing.pre, smooth01(progress));
  }
  if (tick < move.startup + move.active) {
    const progress = THREE.MathUtils.clamp((tick - move.startup) / Math.max(1, move.active), 0, 1);
    const impactAt = 0.46;
    if (progress <= impactAt) {
      return THREE.MathUtils.lerp(timing.pre, timing.impact, smooth01(progress / impactAt));
    }
    return THREE.MathUtils.lerp(timing.impact, timing.over, smooth01((progress - impactAt) / (1 - impactAt)));
  }
  const recovery = THREE.MathUtils.clamp(
    (tick - move.startup - move.active) / Math.max(1, move.recovery),
    0,
    1,
  );
  return THREE.MathUtils.lerp(timing.over, 1, smooth01(recovery));
}

'''
runtime = runtime.replace(marker, helper + marker, 1)
old_pose = '''  const total = Math.max(1, move.startup + move.active + move.recovery);
  const poseU = THREE.MathUtils.clamp(tick / total, 0, 1);
  const timing = motionTimingForMove(move);'''
new_pose = '''  const timing = motionTimingForMove(move);
  const poseU = phaseAlignedAttackPoseU(fighter, tick);'''
if old_pose not in runtime:
    raise SystemExit('attackWeights pose block missing')
runtime = runtime.replace(old_pose, new_pose, 1)

sync_anchor = 'function setWorldQuaternion(object: THREE.Object3D, desiredWorld: THREE.Quaternion): void {'
if sync_anchor not in runtime:
    raise SystemExit('setWorldQuaternion marker missing')
sync_helper = '''function syncKickActionToAuthoredPose(runtime: ExpansionRuntime, fighter: FighterRuntime): void {
  const move = fighter.currentMove;
  const action = runtime.currentAction;
  if (fighter.state !== "ATTACK" || !move || move.animation !== "kick" || !action || !runtime.currentClip.startsWith("PF_")) return;
  const clip = action.getClip();
  const poseU = phaseAlignedAttackPoseU(fighter, Math.max(0, fighter.moveTick));
  action.time = THREE.MathUtils.clamp(poseU, 0, 0.99999) * clip.duration;
  runtime.mixer.update(0);
  fighter.visual.root.userData.motionExpansionTimelinePolicy = "PHASE_ALIGNED_KICK_V1";
  fighter.visual.root.userData.motionExpansionAuthoredPoseU = poseU;
}

'''
runtime = runtime.replace(sync_anchor, sync_helper + sync_anchor, 1)

old_update = '''  runtime.mixer.update(delta);
  runtime.model.updateMatrixWorld(true);
  captureFootLocks(runtime, fighter);'''
new_update = '''  runtime.mixer.update(delta);
  syncKickActionToAuthoredPose(runtime, fighter);
  runtime.model.updateMatrixWorld(true);
  captureFootLocks(runtime, fighter);'''
if old_update not in runtime:
    raise SystemExit('main mixer update block missing')
runtime = runtime.replace(old_update, new_update, 1)
branch_files['runtime'].write_text(runtime)

tests = branch_files['tests'].read_text()
for old, new in [
    ('test("v3 mappings retain generated recovery clips and authored support feet", () => {', 'test("v7.1 kick mappings retain authored support feet and keep the attack clip through recovery", () => {'),
    ('assert.equal(kick.recoveryClip, "PF_KickRecover");', 'assert.equal(kick.recoveryClip, undefined);'),
    ('assert.equal(low.recoveryClip, "PF_KickRecover");', 'assert.equal(low.recoveryClip, undefined);'),
    ('assert.equal(rising.recoveryClip, "PF_KickRecover");', 'assert.equal(rising.recoveryClip, undefined);'),
    ('assert.equal(dash.recoveryClip, "PF_KickRecover");', 'assert.equal(dash.recoveryClip, undefined);'),
]:
    if old not in tests:
        raise SystemExit(f'test pattern missing: {old}')
    tests = tests.replace(old, new, 1)
needle = '  assert.match(source, /motionExpansionStrikeContactBlend/);\n'
addition = '  assert.match(source, /motionExpansionStrikeContactBlend/);\n  assert.match(source, /phaseAlignedAttackPoseU/);\n  assert.match(source, /syncKickActionToAuthoredPose/);\n  assert.match(source, /PHASE_ALIGNED_KICK_V1/);\n  assert.match(source, /motionExpansionAuthoredPoseU/);\n'
if needle not in tests:
    raise SystemExit('runtime test insertion marker missing')
tests = tests.replace(needle, addition, 1)
branch_files['tests'].write_text(tests)
print('patched PHASE_ALIGNED_KICK_V1')

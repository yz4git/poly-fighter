from pathlib import Path

runtime_path = Path('src/game/motion-expansion-runtime.ts')
test_path = Path('tests/motion-expansion.test.ts')
source = runtime_path.read_text()

start = source.index('function solveFootLock(runtime: ExpansionRuntime, fighter: FighterRuntime): number {')
end = source.index('\nfunction fullBodyStrikeSolve(', start)
old = source[start:end]
new = r'''function translateBoneWorld(bone: THREE.Object3D, deltaWorld: THREE.Vector3): void {
  const parent = bone.parent;
  if (!parent || deltaWorld.lengthSq() <= 1e-12) return;
  parent.updateWorldMatrix(true, false);
  const desiredWorld = bone.getWorldPosition(new THREE.Vector3()).add(deltaWorld);
  bone.position.copy(parent.worldToLocal(desiredWorld));
  bone.updateWorldMatrix(true, true);
}

function solveFootLock(runtime: ExpansionRuntime, fighter: FighterRuntime): number {
  const lock = runtime.footLock;
  const move = fighter.currentMove;
  if (!lock || fighter.state !== "ATTACK" || !move) return 0;
  const timing = motionTimingForMove(move);
  const weights = attackWeights(fighter);
  const release = smooth01((weights.poseU - timing.recoil) / Math.max(0.001, 1 - timing.recoil));
  const groundedKick = move.animation === "kick" && motionPlantFootForMove(move) !== "AIR";
  let maxError = 0;
  const solve = (suffix: "l" | "r", target: THREE.Vector3 | null, side: number) => {
    if (!target) return;
    const thigh = runtime.bones.get(`thigh_${suffix}`);
    const calf = runtime.bones.get(`calf_${suffix}`);
    const foot = runtime.bones.get(`foot_${suffix}`);
    if (!thigh || !calf || !foot) return;
    const blendedTarget = target.clone().lerp(foot.getWorldPosition(new THREE.Vector3()), release);
    const pole = fighter.visual.root.localToWorld(new THREE.Vector3(side * 0.30, 0.50, 0.18));

    solveLimb(thigh, calf, foot, blendedTarget, pole);
    runtime.model.updateMatrixWorld(true);

    // At the v7 contact pose the authored pelvis can sit a few centimetres
    // outside the support leg's reachable circle. Rotating the support leg
    // harder then produces a visible skate. Move the pelvis only by the
    // residual that the two-bone solve could not absorb, clamp it tightly,
    // and solve the planted leg again. Because this runs after strike IK, the
    // subsequent kick-only contact pass can recover the attacking foot without
    // disturbing the support chain.
    let solved = foot.getWorldPosition(new THREE.Vector3());
    let residual = blendedTarget.clone().sub(solved);
    if (groundedKick && release < 0.55 && residual.length() > 0.024) {
      const pelvis = runtime.bones.get("pelvis");
      if (pelvis) {
        const correction = residual.clone();
        const maxPelvisCorrection = THREE.MathUtils.lerp(0.058, 0.020, release);
        if (correction.length() > maxPelvisCorrection) correction.setLength(maxPelvisCorrection);
        translateBoneWorld(pelvis, correction);
        runtime.model.updateMatrixWorld(true);
        solveLimb(thigh, calf, foot, blendedTarget, pole);
        runtime.model.updateMatrixWorld(true);
        solved = foot.getWorldPosition(new THREE.Vector3());
        residual = blendedTarget.clone().sub(solved);
      }
    }
    maxError = Math.max(maxError, residual.length());
  };
  solve("l", lock.left, -1);
  solve("r", lock.right, 1);
  return maxError;
}
'''
source = source[:start] + new + source[end:]

old_update = '''  runtime.model.updateMatrixWorld(true);\n  const strikeContactError = strikeTrajectory(runtime, fighter, opponent);\n  runtime.model.updateMatrixWorld(true);\n  const footLockError = solveFootLock(runtime, fighter);\n  runtime.model.updateMatrixWorld(true);'''
new_update = '''  runtime.model.updateMatrixWorld(true);\n  let strikeContactError = strikeTrajectory(runtime, fighter, opponent);\n  runtime.model.updateMatrixWorld(true);\n  let footLockError = solveFootLock(runtime, fighter);\n  runtime.model.updateMatrixWorld(true);\n  if (fighter.currentMove?.animation === "kick" && attackWeights(fighter).phase === "ACTIVE") {\n    strikeContactError = strikeTrajectory(runtime, fighter, opponent);\n    runtime.model.updateMatrixWorld(true);\n    footLockError = solveFootLock(runtime, fighter);\n    runtime.model.updateMatrixWorld(true);\n  }'''
if old_update not in source:
    raise SystemExit('update-order anchor not found')
source = source.replace(old_update, new_update, 1)
source = source.replace('const V3_KICK_CONTACT_SOLVER = "KICK_CONTACT_SOLVER_V1";', 'const V3_KICK_CONTACT_SOLVER = "KICK_CONTACT_SOLVER_V2_PLANT_COMPENSATED";', 1)
runtime_path.write_text(source)

tests = test_path.read_text()
tests = tests.replace('V3_KICK_CONTACT_SOLVER = \\"KICK_CONTACT_SOLVER_V1\\"', 'V3_KICK_CONTACT_SOLVER = \\"KICK_CONTACT_SOLVER_V2_PLANT_COMPENSATED\\"')
if 'KICK_CONTACT_SOLVER_V2_PLANT_COMPENSATED' not in tests:
    raise SystemExit('test expectation was not updated')
test_path.write_text(tests)

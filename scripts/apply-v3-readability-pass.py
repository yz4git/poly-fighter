from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'patch target not found: {path}\n---\n{old[:240]}')
    p.write_text(text.replace(old, new, 1))

# 1) Contact framing: pull back and open a stronger 3/4 lane specifically at hit-stop.
replace_once(
    'src/game/tps-game-base.ts',
    '''const TPS_CAMERA_CLOSE_SHOULDER_BONUS = 2.55;\nconst TPS_CAMERA_CLOSE_BACK_DELTA = -0.58;\nconst TPS_CAMERA_CLOSE_TARGET_SIDE_SHIFT = 0.30;\nconst TPS_CAMERA_CLOSE_TARGET_LIFT = 0.14;''',
    '''const TPS_CAMERA_CLOSE_SHOULDER_BONUS = 3.15;\nconst TPS_CAMERA_CLOSE_BACK_DELTA = 0.18;\nconst TPS_CAMERA_CLOSE_TARGET_SIDE_SHIFT = 0.42;\nconst TPS_CAMERA_CLOSE_TARGET_LIFT = 0.12;\nconst TPS_CAMERA_IMPACT_PULLBACK = 0.42;\nconst TPS_CAMERA_IMPACT_SHOULDER = 0.62;''',
)
replace_once(
    'src/game/tps-game-base.ts',
    '''    const backDistance = 4.70 + closeFactor * TPS_CAMERA_CLOSE_BACK_DELTA + compactLandscapeFactor * 0.18;\n    const shoulderOffset = 2.50 + closeFactor * TPS_CAMERA_CLOSE_SHOULDER_BONUS\n      + compactLandscapeFactor * (0.52 + closeFactor * 0.48);\n    const cameraHeight = 2.36 + closeFactor * 0.24 + compactLandscapeFactor * 0.06;\n    const targetHeight = 1.22 + closeFactor * TPS_CAMERA_CLOSE_TARGET_LIFT;\n    this.cameraTarget.copy(this.p2.position)\n      .addScaledVector(right, TPS_CAMERA_CLOSE_TARGET_SIDE_SHIFT * closeFactor - flankLaneShift)\n      .add(new THREE.Vector3(0, targetHeight, 0));\n    this.camera.userData.tpsCloseReadabilityFactor = closeFactor;\n    this.camera.userData.tpsShoulderOffset = shoulderOffset;\n    this.camera.userData.tpsTargetHeight = targetHeight;''',
    '''    const impactReadabilityFactor = THREE.MathUtils.clamp(Math.max(this.p1.hitStop, this.p2.hitStop) / 9, 0, 1);\n    const backDistance = 4.70\n      + closeFactor * TPS_CAMERA_CLOSE_BACK_DELTA\n      + compactLandscapeFactor * 0.18\n      + impactReadabilityFactor * TPS_CAMERA_IMPACT_PULLBACK;\n    const shoulderOffset = 2.50\n      + closeFactor * TPS_CAMERA_CLOSE_SHOULDER_BONUS\n      + compactLandscapeFactor * (0.52 + closeFactor * 0.48)\n      + impactReadabilityFactor * TPS_CAMERA_IMPACT_SHOULDER;\n    const cameraHeight = 2.36 + closeFactor * 0.24 + compactLandscapeFactor * 0.06 + impactReadabilityFactor * 0.035;\n    const targetHeight = 1.22 + closeFactor * TPS_CAMERA_CLOSE_TARGET_LIFT;\n    this.cameraTarget.copy(this.p2.position)\n      .addScaledVector(right, TPS_CAMERA_CLOSE_TARGET_SIDE_SHIFT * closeFactor - flankLaneShift + impactReadabilityFactor * 0.08)\n      .add(new THREE.Vector3(0, targetHeight, 0));\n    this.camera.userData.tpsCloseReadabilityFactor = closeFactor;\n    this.camera.userData.tpsImpactReadabilityFactor = impactReadabilityFactor;\n    this.camera.userData.tpsShoulderOffset = shoulderOffset;\n    this.camera.userData.tpsTargetHeight = targetHeight;''',
)

# 2) Reduce effect occlusion while preserving hit-stop and impact camera punch.
replace_once(
    'src/game/tps-hype.ts',
    '''  lightImpactRingCount: 2,\n  mediumImpactRingCount: 2,\n  heavyImpactRingCount: 3,\n  impactRingExpansion: 2.2,\n  heavyBurstScale: 0.64,''',
    '''  lightImpactRingCount: 1,\n  mediumImpactRingCount: 1,\n  heavyImpactRingCount: 2,\n  impactRingExpansion: 1.6,\n  heavyBurstScale: 0.48,''',
)
replace_once(
    'src/game/tps-hype.ts',
    '''  heavyImpactFovPunch: -7.2,''',
    '''  heavyImpactFovPunch: -5.2,''',
)
replace_once(
    'src/game/tps-hype.ts',
    '''  private readonly ringGeometry = new THREE.RingGeometry(0.22, 0.29, 40);''',
    '''  private readonly ringGeometry = new THREE.RingGeometry(0.18, 0.235, 40);''',
)
replace_once(
    'src/game/tps-hype.ts',
    '''      ring.mesh.material.opacity = event.blocked ? 0.42 : Math.max(0.44, 0.92 - index * 0.11);''',
    '''      ring.mesh.material.opacity = event.blocked ? 0.36 : Math.max(0.38, 0.76 - index * 0.10);''',
)
replace_once(
    'src/game/tps-hype.ts',
    '''    burst.lines.material.opacity = event.blocked ? 0.32 : tier === 3 ? 0.82 : 0.68;''',
    '''    burst.lines.material.opacity = event.blocked ? 0.28 : tier === 3 ? 0.68 : 0.58;''',
)
replace_once(
    'src/game/tps-hype.ts',
    '''    const tierFov = tier === 3 ? TPS_HYPE_PROFILE.heavyImpactFovPunch : tier === 2 ? -3.8 : -1.7;''',
    '''    const tierFov = tier === 3 ? TPS_HYPE_PROFILE.heavyImpactFovPunch : tier === 2 ? -2.9 : -1.2;''',
)
replace_once(
    'src/game/tps-hype.ts',
    '''      this.fovOffset = Math.min(this.fovOffset, -8.4);''',
    '''      this.fovOffset = Math.min(this.fovOffset, -6.4);''',
)

# 3) Strengthen character-specific whole-body silhouettes and attacker/victim impact pairing.
replace_once(
    'src/game/motion-expansion-runtime.ts',
    '''const FULL_BODY_BALANCE_VERSION = "FULL_BODY_SOLVER_V3";''',
    '''const FULL_BODY_BALANCE_VERSION = "FULL_BODY_SOLVER_V3";\nconst V3_VISUAL_READABILITY_VERSION = "PROCEDURAL_FIGHT_V3_READABILITY_1";''',
)
replace_once(
    'src/game/motion-expansion-runtime.ts',
    '''  if (attacker) {\n    const power = fighter.currentMove?.power ?? 1;\n    addRotation(runtime, "pelvis", 0, side * 0.025 * power, 0, 1);\n    addRotation(runtime, "spine_02", 0, side * 0.045 * power, side * 0.012, 1);\n    addRotation(runtime, "spine_03", 0, side * 0.055 * power, side * 0.018, 1);\n    return "ATTACKER";\n  }\n  addRotation(runtime, "pelvis", 0.018, -side * 0.035, side * 0.045, 1);\n  addRotation(runtime, "spine_02", 0.045, -side * 0.055, side * 0.070, 1);\n  addRotation(runtime, "spine_03", 0.060, -side * 0.070, side * 0.090, 1);\n  addRotation(runtime, "head", 0.018, -side * 0.055, side * 0.080, 1);\n  return "VICTIM";''',
    '''  if (attacker) {\n    const power = THREE.MathUtils.clamp(fighter.currentMove?.power ?? 1, 0.7, 2.2);\n    const accent = 0.88 + power * 0.18;\n    addRotation(runtime, "pelvis", 0.010 * power, side * 0.034 * power, side * 0.010, accent);\n    addRotation(runtime, "spine_02", 0.012 * power, side * 0.060 * power, side * 0.020, accent);\n    addRotation(runtime, "spine_03", 0.018 * power, side * 0.078 * power, side * 0.030, accent);\n    addRotation(runtime, "head", -0.008, -side * 0.030, -side * 0.020, accent);\n    fighter.visual.root.userData.motionExpansionImpactPairStrength = accent;\n    return "ATTACKER";\n  }\n  const incomingPower = THREE.MathUtils.clamp(opponent.currentMove?.power ?? 1, 0.7, 2.2);\n  const recoil = 0.92 + incomingPower * 0.17;\n  addRotation(runtime, "pelvis", 0.030, -side * 0.050, side * 0.075, recoil);\n  addRotation(runtime, "spine_02", 0.070, -side * 0.085, side * 0.115, recoil);\n  addRotation(runtime, "spine_03", 0.090, -side * 0.105, side * 0.145, recoil);\n  addRotation(runtime, "neck_01", 0.035, -side * 0.095, side * 0.125, recoil);\n  addRotation(runtime, "head", 0.035, -side * 0.090, side * 0.135, recoil);\n  addRotation(runtime, "upperarm_l", 0.035, side * 0.045, -side * 0.055, recoil);\n  addRotation(runtime, "upperarm_r", 0.025, side * 0.035, side * 0.060, recoil);\n  fighter.visual.root.userData.motionExpansionImpactPairStrength = recoil;\n  return "VICTIM";''',
)
replace_once(
    'src/game/motion-expansion-runtime.ts',
    '''  if (dna.id === "KAIRO_POWER") {\n    addRotation(runtime, "pelvis", 0, side * 0.035 * dna.hipLead, 0, weights.drive);\n    addRotation(runtime, "spine_02", 0, side * 0.025 * dna.chestFollow, 0, weights.drive);\n    if (weights.phase === "RECOVERY") addRotation(runtime, "spine_03", 0.020 * dna.recoil, -side * 0.020, 0, 1 - weights.drive);\n  } else {\n    addRotation(runtime, "pelvis", 0, side * 0.018, -side * 0.030 * dna.lateral, weights.drive);\n    addRotation(runtime, "spine_03", -0.018, side * 0.018, -side * 0.025 * dna.lateral, weights.drive);\n    if (weights.phase === "RECOVERY") addRotation(runtime, "pelvis", -0.012, -side * 0.025, side * 0.018, 1 - weights.drive);\n  }''',
    '''  if (dna.id === "KAIRO_POWER") {\n    // KAIRO visibly commits mass through hip -> chest -> shoulder, then keeps a\n    // heavier overtravel in recovery. Foot Lock runs afterwards and preserves\n    // the authored support foot despite the larger upper-body torque.\n    addRotation(runtime, "pelvis", 0.018, side * 0.060 * dna.hipLead, side * 0.012, weights.drive);\n    addRotation(runtime, "spine_02", 0.026, side * 0.050 * dna.chestFollow, side * 0.016, weights.drive);\n    addRotation(runtime, "spine_03", 0.038, side * 0.055 * dna.chestFollow, side * 0.022, weights.drive);\n    addRotation(runtime, "head", -0.012, -side * 0.025, -side * 0.018, weights.drive);\n    if (weights.phase === "RECOVERY") {\n      const settle = 1 - weights.drive;\n      addRotation(runtime, "spine_02", 0.026 * dna.recoil, -side * 0.024, side * 0.014, settle);\n      addRotation(runtime, "spine_03", 0.042 * dna.recoil, -side * 0.034, side * 0.020, settle);\n    }\n    fighter.visual.root.userData.motionExpansionDnaSilhouetteStrength = 1.28;\n  } else {\n    // SERA takes a narrower, more elastic line: stronger lateral slip, quicker\n    // chest counter-rotation and a visibly springy return instead of KAIRO's mass.\n    addRotation(runtime, "pelvis", -0.010, side * 0.026, -side * 0.066 * dna.lateral, weights.drive);\n    addRotation(runtime, "spine_02", -0.018, -side * 0.030, -side * 0.042 * dna.lateral, weights.drive);\n    addRotation(runtime, "spine_03", -0.032, side * 0.036, -side * 0.062 * dna.lateral, weights.drive);\n    addRotation(runtime, "head", 0.008, -side * 0.030, side * 0.028, weights.drive);\n    if (weights.phase === "RECOVERY") {\n      const settle = 1 - weights.drive;\n      addRotation(runtime, "pelvis", -0.020, -side * 0.040, side * 0.030, settle);\n      addRotation(runtime, "spine_03", -0.018, -side * 0.025, side * 0.038, settle);\n    }\n    fighter.visual.root.userData.motionExpansionDnaSilhouetteStrength = 1.42;\n  }''',
)
replace_once(
    'src/game/motion-expansion-runtime.ts',
    '''  fighter.visual.root.userData.motionExpansionMotionDna = motionDnaForFighter(fighter.definition).id;\n  fighter.visual.root.userData.motionExpansionPoseGraph = "9_POSE_GRAPH";''',
    '''  fighter.visual.root.userData.motionExpansionMotionDna = motionDnaForFighter(fighter.definition).id;\n  fighter.visual.root.userData.motionExpansionVisualReadabilityVersion = V3_VISUAL_READABILITY_VERSION;\n  fighter.visual.root.userData.motionExpansionPoseGraph = "9_POSE_GRAPH";''',
)

# 4) Regression expectations for the readability pass.
replace_once(
    'tests/tps-mode.test.ts',
    '''  assert.match(source, /TPS_CAMERA_CLOSE_SHOULDER_BONUS = 2\\.55/);\n  assert.match(source, /TPS_CAMERA_CLOSE_BACK_DELTA = -0\\.58/);\n  assert.match(source, /TPS_CAMERA_CLOSE_TARGET_SIDE_SHIFT = 0\\.30/);\n  assert.match(source, /TPS_CAMERA_CLOSE_TARGET_LIFT = 0\\.14/);\n  assert.match(source, /tpsCloseReadabilityFactor/);''',
    '''  assert.match(source, /TPS_CAMERA_CLOSE_SHOULDER_BONUS = 3\\.15/);\n  assert.match(source, /TPS_CAMERA_CLOSE_BACK_DELTA = 0\\.18/);\n  assert.match(source, /TPS_CAMERA_CLOSE_TARGET_SIDE_SHIFT = 0\\.42/);\n  assert.match(source, /TPS_CAMERA_CLOSE_TARGET_LIFT = 0\\.12/);\n  assert.match(source, /TPS_CAMERA_IMPACT_PULLBACK = 0\\.42/);\n  assert.match(source, /TPS_CAMERA_IMPACT_SHOULDER = 0\\.62/);\n  assert.match(source, /impactReadabilityFactor/);\n  assert.match(source, /tpsImpactReadabilityFactor/);\n  assert.match(source, /tpsCloseReadabilityFactor/);''',
)
replace_once(
    'tests/tps-graphics.test.ts',
    '''  assert.equal(TPS_HYPE_PROFILE.heavyImpactRingCount, 3);\n  assert.ok(TPS_HYPE_PROFILE.mediumImpactRingCount <= 2);\n  assert.ok(TPS_HYPE_PROFILE.impactRingExpansion <= 2.2);\n  assert.ok(TPS_HYPE_PROFILE.heavyBurstScale <= 0.64);''',
    '''  assert.equal(TPS_HYPE_PROFILE.lightImpactRingCount, 1);\n  assert.equal(TPS_HYPE_PROFILE.mediumImpactRingCount, 1);\n  assert.equal(TPS_HYPE_PROFILE.heavyImpactRingCount, 2);\n  assert.ok(TPS_HYPE_PROFILE.impactRingExpansion <= 1.6);\n  assert.ok(TPS_HYPE_PROFILE.heavyBurstScale <= 0.48);''',
)
replace_once(
    'tests/motion-expansion.test.ts',
    '''  assert.match(source, /applyMotionDna/);\n  assert.match(source, /motionExpansionFootLockError/);''',
    '''  assert.match(source, /applyMotionDna/);\n  assert.match(source, /V3_VISUAL_READABILITY_VERSION = "PROCEDURAL_FIGHT_V3_READABILITY_1"/);\n  assert.match(source, /motionExpansionDnaSilhouetteStrength/);\n  assert.match(source, /motionExpansionImpactPairStrength/);\n  assert.match(source, /motionExpansionVisualReadabilityVersion/);\n  assert.match(source, /motionExpansionFootLockError/);''',
)

print('Applied Procedural Fight v3 visual readability pass')

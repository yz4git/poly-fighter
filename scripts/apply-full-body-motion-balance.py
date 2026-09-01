from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"missing patch target: {label}")
    file.write_text(text.replace(old, new, 1))


def replace_all(path: str, replacements: list[tuple[str, str, str]]) -> None:
    for old, new, label in replacements:
        replace_once(path, old, new, label)

# Generated motion source: reduce trunk pitch at the authored clip level so reach
# comes from COM drive + rotation + limbs instead of folding the whole torso.
generator = "scripts/generate-procedural-fight-motions-v2.mjs"
replace_once(generator, 'const S = (v, n = 1) => v * n;\n', '', 'remove unused S')
replace_all(generator, [
    ('torso(10, 3, -2); rootDrive(0.030, 0.010, 0.012);', 'torso(10, 1, -2); rootDrive(0.030, 0.010, 0.012);', 'jab torso'),
    ('torso(18, 4, 2); rootDrive(0.050, 0.018, 0.014);', 'torso(18, 1, 2); rootDrive(0.050, 0.018, 0.014);', 'cross torso'),
    ('torso(17, 1, 2); rootDrive(0.040, -0.010, 0.012);', 'torso(17, 0, 2); rootDrive(0.040, -0.010, 0.012);', 'hook torso'),
    ('torso(11, 11, -2); rootDrive(0.044, 0.010, 0.024);', 'torso(11, 5, -2); rootDrive(0.044, 0.010, 0.020);', 'body torso'),
    ('torso(20, 6, 2); rootDrive(0.085, 0.014, 0.024);', 'torso(20, 1, 2); rootDrive(0.078, 0.014, 0.018);', 'heavy torso'),
    ('torso(14, 2, 1); rootDrive(0.050, 0.010, 0.015);', 'torso(14, 0, 1); rootDrive(0.048, 0.010, 0.014);', 'counter torso'),
    ('torso(16, 15, 0); rootDrive(0.046, 0, 0.028);', 'torso(16, 5, 0); rootDrive(0.042, 0, 0.018);', 'throw torso'),
    ('torso(6, rising ? -15 : dash ? -18 : -11);', 'torso(6, rising ? -8 : dash ? -5 : -6);', 'kick torso envelope'),
    ('rootDrive(dash ? 0.075 : rising ? 0.030 : 0.045, 0, dash ? 0.018 : 0.040, rising ? 0.022 : dash ? 0.034 : 0.006);', 'rootDrive(dash ? 0.068 : rising ? 0.030 : 0.043, 0, dash ? 0.014 : 0.034, rising ? 0.018 : dash ? 0.026 : 0.006);', 'kick root envelope'),
    ('torso(21, 4, 8); rootDrive(0.032, 0.022, 0.045);', 'torso(21, 2, 7); rootDrive(0.032, 0.020, 0.036);', 'low kick torso'),
])

old_recover = '''      bones.pelvis = [K(0, R(-6, heavy ? -10 : 0, 0)), K(0.30, R(heavy ? 10 : 8, heavy ? 6 : 0, 0)), K(0.62, R(3, heavy ? 2 : 0, 0)), K(1, R())];\n      bones.spine_02 = [K(0, R(heavy ? -12 : -10, heavy ? -12 : 0, 0)), K(0.30, R(heavy ? 12 : 9, heavy ? 7 : 0, 0)), K(0.62, R(4, heavy ? 2 : 0, 0)), K(1, R())];\n      bones.spine_03 = [K(0, R(heavy ? -17 : -15, heavy ? -15 : 0, 0)), K(0.30, R(heavy ? 15 : 12, heavy ? 9 : 0, 0)), K(0.62, R(5, heavy ? 3 : 0, 0)), K(1, R())];'''
new_recover = '''      // FULL_BODY_BALANCE_V3: recovery carries momentum without folding at the waist.\n      bones.pelvis = [K(0, R(-2, heavy ? -7 : 0, 0)), K(0.30, R(heavy ? 5 : 4, heavy ? 4 : 0, 0)), K(0.62, R(2, heavy ? 1 : 0, 0)), K(1, R())];\n      bones.spine_02 = [K(0, R(heavy ? -5 : -4, heavy ? -8 : 0, 0)), K(0.30, R(heavy ? 6 : 5, heavy ? 5 : 0, 0)), K(0.62, R(2, heavy ? 1 : 0, 0)), K(1, R())];\n      bones.spine_03 = [K(0, R(heavy ? -7 : -6, heavy ? -10 : 0, 0)), K(0.30, R(heavy ? 7 : 6, heavy ? 6 : 0, 0)), K(0.62, R(3, heavy ? 2 : 0, 0)), K(1, R())];'''
replace_once(generator, old_recover, new_recover, 'balanced recovery chain')

# Runtime silhouette layer: remove the second source of exaggerated trunk bending.
runtime = "src/game/motion-expansion-runtime.ts"
replace_once(runtime, 'function attackSilhouette(runtime: ExpansionRuntime, fighter: FighterRuntime): void {', 'const FULL_BODY_BALANCE_VERSION = "FULL_BODY_BALANCE_V3";\n\nfunction attackSilhouette(runtime: ExpansionRuntime, fighter: FighterRuntime): void {', 'balance version')
replace_all(runtime, [
    ('      addRotation(runtime, "spine_02", 0.13, side * 0.18, 0, w);\n      addRotation(runtime, "spine_03", 0.08, side * 0.12, -side * 0.035, w);', '      addRotation(runtime, "spine_02", 0.055, side * 0.18, 0, w);\n      addRotation(runtime, "spine_03", 0.035, side * 0.12, -side * 0.035, w);', 'body blow runtime pitch'),
    ('      addRotation(runtime, "spine_02", 0.05, side * 0.14, side * 0.020, w);\n      addRotation(runtime, "spine_03", 0.03, side * 0.10, side * 0.025, w);', '      addRotation(runtime, "spine_02", 0.012, side * 0.14, side * 0.020, w);\n      addRotation(runtime, "spine_03", 0.008, side * 0.10, side * 0.025, w);', 'heavy runtime pitch'),
    ('      addRotation(runtime, "pelvis", 0.035, -side * 0.055, 0, w);\n      addRotation(runtime, "spine_03", -0.15, 0, -side * 0.025, w);', '      addRotation(runtime, "pelvis", 0.018, -side * 0.055, 0, w);\n      addRotation(runtime, "spine_03", -0.075, 0, -side * 0.025, w);', 'front kick runtime pitch'),
    ('      addRotation(runtime, "pelvis", -0.04, -side * 0.10, 0, w);\n      addRotation(runtime, "spine_03", -0.21, side * 0.04, -side * 0.035, w);', '      addRotation(runtime, "pelvis", -0.020, -side * 0.10, 0, w);\n      addRotation(runtime, "spine_03", -0.105, side * 0.04, -side * 0.035, w);', 'rising runtime pitch'),
    ('      addRotation(runtime, "pelvis", -0.055, -side * 0.075, 0, w);\n      addRotation(runtime, "spine_02", -0.07, 0, 0, w);\n      addRotation(runtime, "spine_03", -0.25, side * 0.05, 0, w);', '      addRotation(runtime, "pelvis", -0.020, -side * 0.075, 0, w);\n      addRotation(runtime, "spine_02", -0.025, 0, 0, w);\n      addRotation(runtime, "spine_03", -0.080, side * 0.05, 0, w);', 'dash kick runtime pitch'),
    ('      addRotation(runtime, "pelvis", 0.05, side * 0.09, 0, w);\n      addRotation(runtime, "spine_02", 0.12, side * 0.15, 0, w);', '      addRotation(runtime, "pelvis", 0.018, side * 0.09, 0, w);\n      addRotation(runtime, "spine_02", 0.045, side * 0.15, 0, w);\n      addRotation(runtime, "spine_03", 0.025, side * 0.08, 0, w);', 'throw runtime pitch'),
    ('      addRotation(runtime, "spine_03", -0.035, side * 0.12, 0, w);', '      addRotation(runtime, "spine_03", -0.010, side * 0.12, 0, w);', 'counter runtime pitch'),
])
replace_once(runtime, '  if (!runtime?.ready) return false;\n\n  const previousState', '  if (!runtime?.ready) return false;\n  fighter.visual.root.userData.motionExpansionBalanceVersion = FULL_BODY_BALANCE_VERSION;\n\n  const previousState', 'publish balance telemetry')

# Browser audit: quantify torso collapse using the midpoint of both upper-arm roots.
audit = "scripts/capture-motion-readability-audit.mjs"
insert_after_pose = '''function poseDistance(a, b) {\n  if (!a?.points || !b?.points) return 0;\n  const keys = ["head", "handL", "handR", "footL", "footR"];\n  return keys.reduce((sum, key) => sum + distance(a.points[key], b.points[key]), 0);\n}\n'''
posture_fn = insert_after_pose + '''\nfunction torsoPosture(points, neutralPoints) {\n  if (!points?.pelvis || !points?.upperArmL || !points?.upperArmR || !neutralPoints?.pelvis || !neutralPoints?.upperArmL || !neutralPoints?.upperArmR) return null;\n  const midpoint = (p) => ({\n    x: (p.upperArmL.x + p.upperArmR.x) * 0.5,\n    y: (p.upperArmL.y + p.upperArmR.y) * 0.5,\n    z: (p.upperArmL.z + p.upperArmR.z) * 0.5,\n  });\n  const shoulder = midpoint(points);\n  const neutralShoulder = midpoint(neutralPoints);\n  const vertical = Math.abs(shoulder.y - points.pelvis.y);\n  const neutralVertical = Math.abs(neutralShoulder.y - neutralPoints.pelvis.y);\n  const horizontal = Math.hypot(shoulder.x - points.pelvis.x, shoulder.z - points.pelvis.z);\n  return {\n    horizontal,\n    vertical,\n    leanRatio: vertical > 1e-5 ? horizontal / vertical : 99,\n    heightRetention: neutralVertical > 1e-5 ? vertical / neutralVertical : 0,\n  };\n}\n'''
replace_once(audit, insert_after_pose, posture_fn, 'posture metric helper')
replace_once(audit, '        targetHealth: game.p2.health,\n      };', '        targetHealth: game.p2.health,\n        balanceVersion: root.userData.motionExpansionBalanceVersion ?? null,\n      };', 'balance telemetry result')
validation_anchor = '''    if (result.contactMode !== "OPPONENT_WEIGHTED_IK") {\n      throw new Error(`Motion ${moveId} did not use opponent-weighted strike targeting: ${JSON.stringify(result)}`);\n    }\n  }\n\n  const distinctPairs = ['''
validation_new = '''    if (result.contactMode !== "OPPONENT_WEIGHTED_IK") {\n      throw new Error(`Motion ${moveId} did not use opponent-weighted strike targeting: ${JSON.stringify(result)}`);\n    }\n    if (result.balanceVersion !== "FULL_BODY_BALANCE_V3") {\n      throw new Error(`Motion ${moveId} did not publish the full-body balance contract: ${JSON.stringify(result)}`);\n    }\n  }\n\n  const torsoPostures = Object.fromEntries(\n    Object.entries(results).map(([moveId, result]) => [moveId, torsoPosture(result.points, neutral.points)]),\n  );\n  for (const moveId of ["jab", "straight", "bodyBlow", "backfist", "power", "kick", "lowKick", "risingKick", "throw", "counter"]) {\n    const posture = torsoPostures[moveId];\n    if (!posture || posture.leanRatio > 0.58 || posture.heightRetention < 0.62) {\n      throw new Error(`Motion ${moveId} collapses the torso chain: ${JSON.stringify(posture)}`);\n    }\n  }\n  const dashPosture = torsoPostures.dashKick;\n  if (!dashPosture || dashPosture.leanRatio > 0.95 || dashPosture.heightRetention < 0.38) {\n    throw new Error(`Dash kick folds the body instead of driving through the target: ${JSON.stringify(dashPosture)}`);\n  }\n\n  const distinctPairs = ['''
replace_once(audit, validation_anchor, validation_new, 'posture validation')
replace_once(audit, '    pairDistances,\n    kickHeights: { lowY, kickY, risingY },', '    pairDistances,\n    torsoPostures,\n    kickHeights: { lowY, kickY, risingY },', 'posture diagnostics')

# Static regressions make the source-level balance contract explicit.
test_file = "tests/motion-expansion.test.ts"
replace_once(test_file, '  assert.match(source, /PF_KickRecover/);\n  assert.match(source, /sampleCurve/);', '  assert.match(source, /PF_KickRecover/);\n  assert.match(source, /FULL_BODY_BALANCE_V3/);\n  assert.match(source, /sampleCurve/);', 'generator balance assertion')
replace_once(test_file, '  assert.match(source, /currentPhase = "SETTLE"/);', '  assert.match(source, /currentPhase = "SETTLE"/);\n  assert.match(source, /FULL_BODY_BALANCE_VERSION = "FULL_BODY_BALANCE_V3"/);\n  assert.match(source, /motionExpansionBalanceVersion = FULL_BODY_BALANCE_VERSION/);', 'runtime balance assertions')

print("full-body motion balance patch applied")

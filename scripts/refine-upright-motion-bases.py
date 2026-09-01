from pathlib import Path


def rep(path, old, new, label):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"missing patch target: {label}")
    p.write_text(text.replace(old, new, 1))


g = "scripts/generate-procedural-fight-motions-v2.mjs"
rep(g, '{ name: "PF_BodyBlow_L", base: "Punch_Jab",', '{ name: "PF_BodyBlow_L", base: "Idle_Loop",', 'body left base')
rep(g, '{ name: "PF_BodyBlow_R", base: "Punch_Jab",', '{ name: "PF_BodyBlow_R", base: "Idle_Loop",', 'body right base')
rep(g, '{ name: "PF_Power_R", base: "Punch_Cross",', '{ name: "PF_Power_R", base: "Idle_Loop",', 'power base')
rep(g, '{ name: "PF_Throw", base: "Punch_Cross",', '{ name: "PF_Throw", base: "Idle_Loop",', 'throw base')
rep(g, 'torso(11, 5, -2); rootDrive(0.044, 0.010, 0.020);', 'torso(13, 2, -2); rootDrive(0.050, 0.012, 0.018);', 'body drive')
rep(g, 'torso(20, 1, 2); rootDrive(0.078, 0.014, 0.018);', 'torso(24, 0, 2); rootDrive(0.082, 0.016, 0.016);', 'power drive')
rep(g, 'torso(16, 5, 0); rootDrive(0.042, 0, 0.018);', 'torso(18, 2, 0); rootDrive(0.046, 0, 0.016);', 'throw drive')

a = "scripts/capture-motion-readability-audit.mjs"
rep(a, "      pelvis: point(get('pelvis')),\n      head: point(get('head')),", "      pelvis: point(get('pelvis')),\n      spine02: point(get('spine_02')),\n      chest: point(get('spine_03')),\n      neck: point(get('neck_01')),\n      head: point(get('head')),", 'torso points')
old = '''function torsoPosture(points, neutralPoints) {
  if (!points?.pelvis || !points?.upperArmL || !points?.upperArmR || !neutralPoints?.pelvis || !neutralPoints?.upperArmL || !neutralPoints?.upperArmR) return null;
  const midpoint = (p) => ({
    x: (p.upperArmL.x + p.upperArmR.x) * 0.5,
    y: (p.upperArmL.y + p.upperArmR.y) * 0.5,
    z: (p.upperArmL.z + p.upperArmR.z) * 0.5,
  });
  const shoulder = midpoint(points);
  const neutralShoulder = midpoint(neutralPoints);
  const vertical = Math.abs(shoulder.y - points.pelvis.y);
  const neutralVertical = Math.abs(neutralShoulder.y - neutralPoints.pelvis.y);
  const horizontal = Math.hypot(shoulder.x - points.pelvis.x, shoulder.z - points.pelvis.z);
  return {
    horizontal,
    vertical,
    leanRatio: vertical > 1e-5 ? horizontal / vertical : 99,
    heightRetention: neutralVertical > 1e-5 ? vertical / neutralVertical : 0,
  };
}
'''
new = '''function torsoPosture(points, neutralPoints) {
  if (!points?.pelvis || !points?.upperArmL || !points?.upperArmR || !points?.chest || !points?.neck
      || !neutralPoints?.pelvis || !neutralPoints?.upperArmL || !neutralPoints?.upperArmR || !neutralPoints?.chest || !neutralPoints?.neck) return null;
  const midpoint = (p) => ({
    x: (p.upperArmL.x + p.upperArmR.x) * 0.5,
    y: (p.upperArmL.y + p.upperArmR.y) * 0.5,
    z: (p.upperArmL.z + p.upperArmR.z) * 0.5,
  });
  const ratioFor = (top, pelvis) => {
    const vertical = Math.abs(top.y - pelvis.y);
    const horizontal = Math.hypot(top.x - pelvis.x, top.z - pelvis.z);
    return { horizontal, vertical, ratio: vertical > 1e-5 ? horizontal / vertical : 99 };
  };
  const shoulder = midpoint(points);
  const neutralShoulder = midpoint(neutralPoints);
  const shoulderMetric = ratioFor(shoulder, points.pelvis);
  const chestMetric = ratioFor(points.chest, points.pelvis);
  const neckMetric = ratioFor(points.neck, points.pelvis);
  const neutralVertical = Math.abs(neutralShoulder.y - neutralPoints.pelvis.y);
  return {
    horizontal: shoulderMetric.horizontal,
    vertical: shoulderMetric.vertical,
    leanRatio: shoulderMetric.ratio,
    chestLeanRatio: chestMetric.ratio,
    neckLeanRatio: neckMetric.ratio,
    heightRetention: neutralVertical > 1e-5 ? shoulderMetric.vertical / neutralVertical : 0,
  };
}
'''
rep(a, old, new, 'spine posture metric')
rep(a, 'if (!posture || posture.leanRatio > 0.58 || posture.heightRetention < 0.62)', 'if (!posture || posture.leanRatio > 0.52 || posture.chestLeanRatio > 0.42 || posture.neckLeanRatio > 0.48 || posture.heightRetention < 0.68)', 'grounded posture threshold')
rep(a, 'if (!dashPosture || dashPosture.leanRatio > 0.95 || dashPosture.heightRetention < 0.38)', 'if (!dashPosture || dashPosture.leanRatio > 0.72 || dashPosture.chestLeanRatio > 0.65 || dashPosture.neckLeanRatio > 0.72 || dashPosture.heightRetention < 0.55)', 'dash posture threshold')

t = "tests/motion-expansion.test.ts"
rep(t, '  assert.match(source, /FULL_BODY_BALANCE_V3/);\n  assert.match(source, /sampleCurve/);', '  assert.match(source, /FULL_BODY_BALANCE_V3/);\n  assert.match(source, /PF_Power_R.*, base: "Idle_Loop"/);\n  assert.match(source, /PF_Throw.*, base: "Idle_Loop"/);\n  assert.match(source, /PF_BodyBlow_L.*, base: "Idle_Loop"/);\n  assert.match(source, /sampleCurve/);', 'upright base tests')

print("upright motion bases and spine audit refined")

from pathlib import Path


def replace(path, old, new, label):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f"{label}: missing anchor")
    p.write_text(s.replace(old, new, 1))


# Reuse the previously screen-reviewed natural-biomechanics patch as the base.
lines = Path('.github/workflows/kick-naturalness-v3-implementation.yml').read_text().splitlines()
marker = "          python3 - <<'PY'"
start = lines.index(marker) + 1
end = next(i for i in range(start, len(lines)) if lines[i] == '          PY')
code = '\n'.join(line[10:] if line.startswith('          ') else line for line in lines[start:end])
exec(compile(code, '<kick-v3-base>', 'exec'), {})

path = 'tools/blender/build-fight-motion-foundry-v2-kicks.py'

# V3 low kick refinement: preserve support-foot pivot, avoid a locked 180-degree knee.
replace(
    path,
    "        (0.18, 0.22, 0.20),\n        (0.40, 0.34, 0.18),\n        (0.42, 0.42, 0.17),\n        (0.02, 0.10, 0.14),",
    "        (0.18, 0.18, 0.20),\n        (0.34, 0.27, 0.18),\n        (0.36, 0.31, 0.17),\n        (0.02, 0.08, 0.14),",
    'low kick reach refinement',
)
replace(
    path,
    "foot_yaw=(0.0, 12.0, 38.0, 72.0, 86.0, 18.0, 0.0),\n    support_yaw=(0.0, 4.0, 14.0, 30.0, 38.0, 10.0, 0.0),",
    "foot_yaw=(0.0, 10.0, 34.0, 66.0, 78.0, 16.0, 0.0),\n    support_yaw=(0.0, 3.0, 12.0, 26.0, 32.0, 8.0, 0.0),",
    'low kick pivot refinement',
)

# Generated reference sheets: make chamber and recovery unmistakably bent-leg poses.
replace(
    path,
    "        (-0.05, 0.00, 0.18),\n        (0.34, 0.00, 0.34),",
    "        (-0.06, 0.00, 0.27),\n        (0.31, 0.00, 0.36),",
    'front chamber',
)
replace(
    path,
    "        (0.04, 0.00, 0.18),\n        (0.00, 0.00, 0.00),",
    "        (-0.02, 0.00, 0.25),\n        (0.00, 0.00, 0.00),",
    'front recovery',
)
replace(
    path,
    "        (-0.06, 0.00, 0.19),\n        (0.32, 0.00, 0.48),",
    "        (-0.07, 0.00, 0.29),\n        (0.29, 0.00, 0.52),",
    'rising chamber',
)
replace(
    path,
    "        (0.02, 0.00, 0.22),\n        (0.00, 0.00, 0.00),",
    "        (-0.02, 0.00, 0.30),\n        (0.00, 0.00, 0.00),",
    'rising recovery',
)

p = Path(path)
s = p.read_text().replace('NATURAL_KICK_V3', 'REFERENCE_POSE_V4')

phase_anchor = """    def strike_suffix(self) -> str:
        return self.strike_side.lower()
"""
phase_insert = """    @property
    def reference_pose_frames(self) -> Tuple[int, int, int, int, int]:
        # Five readable checkpoints from the generated reference sheets.
        return (self.start_frame, self.load_frame, self.impact_frame, self.recovery_frame, self.end_frame)

    @property
    def strike_suffix(self) -> str:
        return self.strike_side.lower()
"""
if phase_anchor not in s:
    raise SystemExit('reference frame property anchor missing')
s = s.replace(phase_anchor, phase_insert, 1)

build_anchor = '\ndef build_kick_action(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec, axes):\n'
helpers = '''
REFERENCE_POSE_LABELS = ("START", "CHAMBER", "IMPACT", "RECOVERY", "GUARD")


def _knee_extension_at(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec, frame: int) -> float:
    thigh = f"thigh_{spec.strike_suffix}"
    calf = f"calf_{spec.strike_suffix}"
    foot = f"foot_{spec.strike_suffix}"
    scene.frame_set(frame); bpy.context.view_layer.update()
    hip = rig.v1.pose_head(armature, thigh)
    knee = rig.v1.pose_head(armature, calf)
    ankle = rig.v1.pose_head(armature, foot)
    upper = hip - knee
    lower = ankle - knee
    if upper.length < 1e-6 or lower.length < 1e-6:
        return 0.0
    return math.degrees(upper.angle(lower))


def reference_pose_snapshots(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec, forward: Vector, up: Vector):
    strike_foot = f"foot_{spec.strike_suffix}"
    support_foot = f"foot_{spec.support_suffix}"
    scene.frame_set(spec.start_frame); bpy.context.view_layer.update()
    start_strike = rig.v1.pose_head(armature, strike_foot)
    start_pelvis = rig.v1.pose_head(armature, "pelvis")
    start_support_q = rig.pose_world_matrix(armature, support_foot).to_quaternion()
    poses = []
    for label, frame in zip(REFERENCE_POSE_LABELS, spec.reference_pose_frames):
        scene.frame_set(frame); bpy.context.view_layer.update()
        foot = rig.v1.pose_head(armature, strike_foot)
        pelvis = rig.v1.pose_head(armature, "pelvis")
        support_q = rig.pose_world_matrix(armature, support_foot).to_quaternion()
        poses.append({
            "label": label,
            "frame": frame,
            "normalizedTime": (frame - spec.start_frame) / max(1, spec.end_frame - spec.start_frame),
            "strikeFootForward": (foot - start_strike).dot(forward),
            "strikeFootRise": (foot - start_strike).dot(up),
            "strikeKneeExtensionDegrees": _knee_extension_at(scene, armature, spec, frame),
            "pelvisForward": (pelvis - start_pelvis).dot(forward),
            "pelvisRise": (pelvis - start_pelvis).dot(up),
            "supportFootPivotDegrees": math.degrees(start_support_q.rotation_difference(support_q).angle),
        })
    return poses
'''
if build_anchor not in s:
    raise SystemExit('reference snapshot insertion anchor missing')
s = s.replace(build_anchor, '\n' + helpers + build_anchor, 1)

bake_anchor = """    final_action = rig.v1.bake_visual_action(scene, armature, constrained)
    final_action.use_fake_user = True
    rig.v1.remove_controls([*controls, *guards, *masters])
    metrics = {
"""
bake_insert = """    final_action = rig.v1.bake_visual_action(scene, armature, constrained)
    final_action.use_fake_user = True
    armature.animation_data.action = final_action
    reference_poses = reference_pose_snapshots(scene, armature, spec, axes[0], axes[2])
    rig.v1.remove_controls([*controls, *guards, *masters])
    metrics = {
"""
if bake_anchor not in s:
    raise SystemExit('reference snapshot bake anchor missing')
s = s.replace(bake_anchor, bake_insert, 1)

metric_anchor = """        "naturalnessPass": "REFERENCE_POSE_V4",
        "pipeline": [
"""
metric_insert = """        "naturalnessPass": "REFERENCE_POSE_V4",
        "referencePoseMethod": "FIVE_KEY_REFERENCE_V4",
        "referencePoses": reference_poses,
        "pipeline": [
"""
if metric_anchor not in s:
    raise SystemExit('reference metrics anchor missing')
s = s.replace(metric_anchor, metric_insert, 1)
s = s.replace(
    '            "shared COG/pelvis and staged torso masters",',
    '            "five-pose visual reference: START / CHAMBER / IMPACT / RECOVERY / GUARD",\n            "shared COG/pelvis and staged torso masters",',
    1,
)
summary_anchor = """        "naturalnessPass": "REFERENCE_POSE_V4",
        "fps": rig.FPS,
"""
summary_insert = """        "naturalnessPass": "REFERENCE_POSE_V4",
        "referencePoseMethod": "FIVE_KEY_REFERENCE_V4",
        "fps": rig.FPS,
"""
if summary_anchor not in s:
    raise SystemExit('summary reference method anchor missing')
s = s.replace(summary_anchor, summary_insert, 1)
p.write_text(s)

# Permanent kick CI now treats controlled support-foot rotation as a pivot, not drift.
wf = Path('.github/workflows/blender-motion-foundry-v2-kicks.yml')
ws = wf.read_text().replace('supportFootLockMaxAngularDriftDegrees', 'supportFootPivotMaxDegrees')
wf.write_text(ws)

# Tests: preserve V3 biomechanical gates and add the five explicit pose gates.
t = Path('tests/blender-motion-foundry-v2-kicks.test.mjs')
ts = t.read_text().replace('NATURAL_KICK_V3', 'REFERENCE_POSE_V4')
ts = ts.replace('supportFootLockMaxAngularDriftDegrees', 'supportFootPivotMaxDegrees')
extra = r'''

test("reference-pose v4 keeps all five kick checkpoints readable and physically staged", () => {
  assert.equal(metrics.naturalnessPass, "REFERENCE_POSE_V4");
  assert.equal(metrics.referencePoseMethod, "FIVE_KEY_REFERENCE_V4");
  for (const move of metrics.moves) {
    assert.equal(move.referencePoseMethod, "FIVE_KEY_REFERENCE_V4");
    assert.deepEqual(move.referencePoses.map((pose) => pose.label), ["START", "CHAMBER", "IMPACT", "RECOVERY", "GUARD"]);
    const [start, chamber, impact, recovery, guard] = move.referencePoses;
    assert.ok(chamber.strikeFootRise > 0.10, `${move.action} chamber rise ${chamber.strikeFootRise}`);
    assert.ok(impact.strikeKneeExtensionDegrees > chamber.strikeKneeExtensionDegrees + 8, `${move.action} chamber->impact knee`);
    assert.ok(recovery.strikeKneeExtensionDegrees < impact.strikeKneeExtensionDegrees - 8, `${move.action} impact->recovery knee`);
    assert.ok(Math.abs(guard.strikeFootForward) < 0.09, `${move.action} guard forward ${guard.strikeFootForward}`);
    assert.ok(Math.abs(guard.strikeFootRise) < 0.09, `${move.action} guard rise ${guard.strikeFootRise}`);
    assert.ok(guard.supportFootPivotDegrees < 4.0, `${move.action} guard pivot ${guard.supportFootPivotDegrees}`);
    assert.ok(start.supportFootPivotDegrees < 0.5, `${move.action} start pivot ${start.supportFootPivotDegrees}`);
  }
  const byAction = new Map(metrics.moves.map((move) => [move.action, move]));
  const front = byAction.get("BF_FrontKick_R");
  const low = byAction.get("BF_LowKick_L");
  const rising = byAction.get("BF_RisingKick_R");
  assert.ok(front.referencePoses[2].supportFootPivotDegrees > 8 && front.referencePoses[2].supportFootPivotDegrees < 20);
  assert.ok(low.referencePoses[2].supportFootPivotDegrees > 18 && low.referencePoses[2].supportFootPivotDegrees < 38);
  assert.ok(rising.referencePoses[2].supportFootPivotDegrees > 10 && rising.referencePoses[2].supportFootPivotDegrees < 28);
  assert.ok(rising.referencePoses[2].strikeFootRise > front.referencePoses[2].strikeFootRise + 0.16);
});
'''
if 'reference-pose v4 keeps all five kick checkpoints readable' not in ts:
    ts += extra
t.write_text(ts)

# Model View artifact: capture all five checkpoints for all three grounded authored kicks.
a = Path('scripts/capture-model-view-audit.mjs')
av = a.read_text()
anchor = '  const proceduralDashKick = await poseMotionViewer(sessionId, "PF_DashKick_R", 0.52);\n'
block = '''  const referenceKickPoses = [
    ["start", 0.02], ["chamber", 0.18], ["impact", 0.56], ["recovery", 0.82], ["guard", 0.98],
  ];
  for (const [clip, slug] of [["BF_FrontKick_R", "front"], ["BF_LowKick_L", "low"], ["BF_RisingKick_R", "rising"]]) {
    for (const [phase, normalized] of referenceKickPoses) {
      await poseMotionViewer(sessionId, clip, normalized);
      await screenshot(sessionId, `${outputDir}/reference-v4-${slug}-${phase}.png`);
    }
  }

  const proceduralDashKick = await poseMotionViewer(sessionId, "PF_DashKick_R", 0.52);
'''
if anchor not in av:
    raise SystemExit('model viewer reference capture anchor missing')
a.write_text(av.replace(anchor, block, 1))

docs = Path('docs/KICK_REFERENCE_POSE_V4.md')
docs.write_text('''# Kick Reference Pose V4

The authored grounded kicks are reconstructed from five visual checkpoints generated for this pass.

1. **START** — balanced guard, weight available to the support leg.
2. **CHAMBER / LOAD** — knee clearly folded; support foot begins its pivot; pelvis starts to travel.
3. **IMPACT / PEAK** — pelvis commits behind the strike; support foot has pivoted; torso and arms counterbalance rather than remaining rigid.
4. **RECOVERY** — the strike leg folds again before landing; torso and pelvis begin returning independently.
5. **GUARD** — both feet and the upper body resolve cleanly back into the ready stance.

The Blender generator keeps intermediate pre-contact and overtravel controls for interpolation, but the five poses above are explicit quality gates and are exported to `blender-kicks-core.metrics.json` as `referencePoses`.
''')

print('Kick Reference Pose V4 patch applied')

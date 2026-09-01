from pathlib import Path


def rep(path, old, new, label, count=1):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"missing patch target: {label}")
    p.write_text(text.replace(old, new, count))


def insert_after(path, marker, addition, label):
    p = Path(path)
    text = p.read_text()
    if marker not in text:
        raise SystemExit(f"missing insert target: {label}")
    p.write_text(text.replace(marker, marker + addition, 1))


# ---------------------------------------------------------------------------
# 1) Pose Graph + move-specific timing generator
# ---------------------------------------------------------------------------
v2 = Path("scripts/generate-procedural-fight-motions-v2.mjs").read_text()
v3 = v2.replace('const VERSION = "PROCEDURAL_FIGHT_V2";', 'const VERSION = "PROCEDURAL_FIGHT_V3";', 1)
v3 = v3.replace(
    'const K = (u, xyz) => ({ u, xyz });',
    '''const K = (u, xyz, ease = "smooth") => ({ u, xyz, ease });

const POSE_GRAPH_NODES = [
  "STANCE", "LOAD", "ANTICIPATION_HOLD", "LAUNCH", "PRE_CONTACT",
  "IMPACT", "OVERTRAVEL", "RECOIL", "SETTLE",
];

// Each family gets a deliberately different rhythm. The old generator derived
// every move from impact +/- fixed offsets, which made unrelated attacks share
// the same cadence. V3 treats timing as authored move data.
const MOVE_TIMINGS = {
  JAB:         { load: .10, hold: .16, launch: .26, pre: .48, impact: .61, over: .67, recoil: .76, settle: .88 },
  CROSS:       { load: .12, hold: .21, launch: .32, pre: .55, impact: .68, over: .75, recoil: .84, settle: .93 },
  HOOK:        { load: .14, hold: .27, launch: .38, pre: .54, impact: .64, over: .74, recoil: .84, settle: .94 },
  BODY:        { load: .16, hold: .29, launch: .41, pre: .58, impact: .70, over: .77, recoil: .87, settle: .95 },
  HEAVY:       { load: .17, hold: .34, launch: .47, pre: .63, impact: .73, over: .81, recoil: .90, settle: .97 },
  FRONT_KICK:  { load: .13, hold: .25, launch: .37, pre: .52, impact: .64, over: .72, recoil: .83, settle: .94 },
  LOW_KICK:    { load: .15, hold: .28, launch: .40, pre: .55, impact: .67, over: .76, recoil: .87, settle: .95 },
  RISING_KICK: { load: .17, hold: .30, launch: .42, pre: .58, impact: .69, over: .78, recoil: .88, settle: .96 },
  DASH_KICK:   { load: .08, hold: .16, launch: .27, pre: .49, impact: .66, over: .73, recoil: .82, settle: .92 },
  THROW:       { load: .13, hold: .26, launch: .39, pre: .51, impact: .58, over: .66, recoil: .80, settle: .93 },
  COUNTER:     { load: .06, hold: .12, launch: .22, pre: .42, impact: .55, over: .63, recoil: .75, settle: .88 },
};

const DEFAULT_TIMING = { load: .12, hold: .22, launch: .34, pre: .53, impact: .66, over: .74, recoil: .84, settle: .94 };
const MOTION_DNA = {
  POWER: { id: "KAIRO_POWER", hipLead: 1.18, chestFollow: 1.10, recoil: 1.14, lateral: 0.82, guardDiscipline: 1.00 },
  SPEED: { id: "SERA_SPEED", hipLead: 1.04, chestFollow: 0.94, recoil: 0.82, lateral: 1.22, guardDiscipline: 0.92 },
};

function timingFor(spec) {
  return MOVE_TIMINGS[spec.style] ?? DEFAULT_TIMING;
}
''',
    1,
)
old_cadence = '''function strikeCadence(spec, scale = 1) {
  const p = spec.power * scale;
  const s = spec.side;
  const impact = spec.contactU;
  const anticipate = Math.max(0.18, impact - 0.34);
  const settle = Math.min(0.90, impact + 0.13);
  return { p, s, impact, anticipate, settle };
}'''
new_cadence = '''function strikeCadence(spec, scale = 1) {
  const p = spec.power * scale;
  const s = spec.side;
  const timing = timingFor(spec);
  return {
    p, s, timing,
    load: timing.load,
    anticipate: timing.hold,
    launch: timing.launch,
    preContact: timing.pre,
    impact: timing.impact,
    overtravel: timing.over,
    recoil: timing.recoil,
    settle: timing.settle,
  };
}'''
if old_cadence not in v3:
    raise SystemExit("missing v2 strikeCadence")
v3 = v3.replace(old_cadence, new_cadence, 1)
v3 = v3.replace(
    'const { p, s, impact, anticipate, settle } = strikeCadence(spec);',
    'const { p, s, timing, load, impact, anticipate, launch, preContact, overtravel, recoil, settle } = strikeCadence(spec);',
    1,
)
old_torso = '''  const torso = (yaw, pitch = 0, roll = 0) => {
    bones.pelvis = [K(0, R()), K(anticipate, R(pitch * 0.35 * p, yaw * -0.55 * s * p, roll * -0.35 * s * p)), K(impact, R(pitch * -0.28 * p, yaw * s * p, roll * s * p)), K(settle, R(pitch * -0.10 * p, yaw * 0.38 * s * p, roll * 0.28 * s * p)), K(1, R())];
    bones.spine_02 = [K(0, R()), K(anticipate, R(pitch * 0.55 * p, yaw * -0.80 * s * p, roll * -0.55 * s * p)), K(impact, R(pitch * -0.52 * p, yaw * 1.35 * s * p, roll * 1.25 * s * p)), K(settle, R(pitch * -0.18 * p, yaw * 0.48 * s * p, roll * 0.42 * s * p)), K(1, R())];
    bones.spine_03 = [K(0, R()), K(anticipate, R(pitch * 0.45 * p, yaw * -0.95 * s * p, roll * -0.70 * s * p)), K(impact, R(pitch * -0.68 * p, yaw * 1.60 * s * p, roll * 1.55 * s * p)), K(settle, R(pitch * -0.24 * p, yaw * 0.55 * s * p, roll * 0.50 * s * p)), K(1, R())];
  };'''
new_torso = '''  const torso = (yaw, pitch = 0, roll = 0) => {
    // Pose-first torso chain. LOAD/HOLD stores energy, LAUNCH releases the hips,
    // chest arrives a fraction later, IMPACT is readable, and OVERTRAVEL keeps
    // momentum without folding the waist.
    bones.pelvis = [
      K(0, R()),
      K(load, R(pitch * 0.10 * p, yaw * -0.16 * s * p, roll * -0.10 * s * p), "easeIn"),
      K(anticipate, R(pitch * 0.14 * p, yaw * -0.22 * s * p, roll * -0.14 * s * p), "hold"),
      K(launch, R(pitch * 0.05 * p, yaw * -0.04 * s * p, roll * -0.04 * s * p), "snap"),
      K(preContact, R(pitch * -0.05 * p, yaw * 0.56 * s * p, roll * 0.46 * s * p), "snap"),
      K(impact, R(pitch * -0.08 * p, yaw * 1.00 * s * p, roll * 0.82 * s * p), "snap"),
      K(overtravel, R(pitch * -0.07 * p, yaw * 1.08 * s * p, roll * 0.88 * s * p), "easeOut"),
      K(recoil, R(pitch * -0.03 * p, yaw * 0.64 * s * p, roll * 0.48 * s * p), "easeOut"),
      K(settle, R(pitch * -0.01 * p, yaw * 0.26 * s * p, roll * 0.18 * s * p), "smooth"),
      K(1, R()),
    ];
    bones.spine_02 = [
      K(0, R()),
      K(load, R(pitch * 0.14 * p, yaw * -0.24 * s * p, roll * -0.16 * s * p), "easeIn"),
      K(anticipate, R(pitch * 0.18 * p, yaw * -0.34 * s * p, roll * -0.22 * s * p), "hold"),
      K(launch, R(pitch * 0.07 * p, yaw * -0.08 * s * p, roll * -0.06 * s * p), "snap"),
      K(preContact, R(pitch * -0.08 * p, yaw * 0.76 * s * p, roll * 0.64 * s * p), "snap"),
      K(impact, R(pitch * -0.12 * p, yaw * 1.26 * s * p, roll * 1.00 * s * p), "snap"),
      K(overtravel, R(pitch * -0.10 * p, yaw * 1.36 * s * p, roll * 1.08 * s * p), "easeOut"),
      K(recoil, R(pitch * -0.05 * p, yaw * 0.76 * s * p, roll * 0.56 * s * p), "easeOut"),
      K(settle, R(pitch * -0.02 * p, yaw * 0.30 * s * p, roll * 0.22 * s * p)),
      K(1, R()),
    ];
    bones.spine_03 = [
      K(0, R()),
      K(load, R(pitch * 0.12 * p, yaw * -0.28 * s * p, roll * -0.20 * s * p), "easeIn"),
      K(anticipate, R(pitch * 0.15 * p, yaw * -0.40 * s * p, roll * -0.26 * s * p), "hold"),
      K(launch, R(pitch * 0.06 * p, yaw * -0.12 * s * p, roll * -0.08 * s * p), "snap"),
      K(preContact, R(pitch * -0.10 * p, yaw * 0.90 * s * p, roll * 0.76 * s * p), "snap"),
      K(impact, R(pitch * -0.14 * p, yaw * 1.46 * s * p, roll * 1.18 * s * p), "snap"),
      K(overtravel, R(pitch * -0.12 * p, yaw * 1.58 * s * p, roll * 1.26 * s * p), "easeOut"),
      K(recoil, R(pitch * -0.06 * p, yaw * 0.86 * s * p, roll * 0.64 * s * p), "easeOut"),
      K(settle, R(pitch * -0.02 * p, yaw * 0.34 * s * p, roll * 0.24 * s * p)),
      K(1, R()),
    ];
  };'''
if old_torso not in v3:
    raise SystemExit("missing v2 torso")
v3 = v3.replace(old_torso, new_torso, 1)
old_root = '''  const rootDrive = (forward, lateral = 0, down = 0.018, lift = 0) => {
    pelvisMove = [
      K(0, T()),
      K(anticipate, T(-lateral * 0.25 * s, -down, -forward * 0.30)),
      K(impact, T(lateral * s, lift - down * 0.20, forward)),
      K(settle, T(lateral * 0.42 * s, lift * 0.25, forward * 0.42)),
      K(1, T()),
    ];
  };'''
new_root = '''  const rootDrive = (forward, lateral = 0, down = 0.018, lift = 0) => {
    pelvisMove = [
      K(0, T()),
      K(load, T(-lateral * 0.18 * s, -down * 0.72, -forward * 0.18), "easeIn"),
      K(anticipate, T(-lateral * 0.26 * s, -down, -forward * 0.30), "hold"),
      K(launch, T(-lateral * 0.10 * s, -down * 0.72, -forward * 0.12), "snap"),
      K(preContact, T(lateral * 0.52 * s, lift * 0.36 - down * 0.35, forward * 0.58), "snap"),
      K(impact, T(lateral * s, lift - down * 0.20, forward), "snap"),
      K(overtravel, T(lateral * 1.05 * s, lift * 0.86 - down * 0.18, forward * 1.08), "easeOut"),
      K(recoil, T(lateral * 0.70 * s, lift * 0.48 - down * 0.30, forward * 0.70), "easeOut"),
      K(settle, T(lateral * 0.30 * s, lift * 0.18 - down * 0.12, forward * 0.28)),
      K(1, T()),
    ];
  };

  // Generated support-leg counter motion gives the runtime IK a stable starting
  // configuration. Runtime foot lock is authoritative; this prevents the source
  // clip from trying to lift the named support foot before IK is applied.
  const authorSupportLeg = (suffix) => {
    if (!bones[`thigh_${suffix}`]) bones[`thigh_${suffix}`] = [K(0, R()), K(anticipate, R(4, 0, 0)), K(impact, R(-3, 0, 0)), K(settle, R(1, 0, 0)), K(1, R())];
    if (!bones[`calf_${suffix}`]) bones[`calf_${suffix}`] = [K(0, R()), K(anticipate, R(-7, 0, 0)), K(impact, R(5, 0, 0)), K(settle, R(-2, 0, 0)), K(1, R())];
    if (!bones[`foot_${suffix}`]) bones[`foot_${suffix}`] = [K(0, R()), K(impact, R(2, 0, 0)), K(1, R())];
  };'''
if old_root not in v3:
    raise SystemExit("missing v2 rootDrive")
v3 = v3.replace(old_root, new_root, 1)
v3 = v3.replace(
    '  return { bones, translation: { pelvis: pelvisMove } };',
    '''  if (spec.plantFoot === "LEFT" || spec.plantFoot === "BOTH") authorSupportLeg("l");
  if (spec.plantFoot === "RIGHT" || spec.plantFoot === "BOTH") authorSupportLeg("r");

  return { bones, translation: { pelvis: pelvisMove }, timing, poseGraph: POSE_GRAPH_NODES };''',
    1,
)
old_sample = '''      const t = (u - left.u) / Math.max(1e-6, right.u - left.u);
      const smooth = t * t * (3 - 2 * t);
      return left.xyz.map((value, axis) => value + (right.xyz[axis] - value) * smooth);'''
new_sample = '''      const t = (u - left.u) / Math.max(1e-6, right.u - left.u);
      const mode = right.ease ?? left.ease ?? "smooth";
      const shaped = mode === "hold" ? (t < 0.82 ? 0 : ((t - 0.82) / 0.18) ** 2)
        : mode === "snap" ? 1 - (1 - t) ** 4
        : mode === "easeIn" ? t ** 3
        : mode === "easeOut" ? 1 - (1 - t) ** 3
        : t * t * (3 - 2 * t);
      return left.xyz.map((value, axis) => value + (right.xyz[axis] - value) * shaped);'''
if old_sample not in v3:
    raise SystemExit("missing v2 sampleCurve")
v3 = v3.replace(old_sample, new_sample, 1)
v3 = v3.replace(
    '    contactU: spec.contactU, plantFoot: spec.plantFoot, duration,',
    '    contactU: timingFor(spec).impact, plantFoot: spec.plantFoot, duration,\n    poseGraphNodes: POSE_GRAPH_NODES, timingProfile: timingFor(spec),',
    1,
)
v3 = v3.replace(
    '  rootMotionPolicy: "ADDITIVE_COM_RETURN_TO_BIND",\n  timingPolicy: "ANTICIPATION_DRIVE_IMPACT_OVERTRAVEL_SETTLE",',
    '  rootMotionPolicy: "POSE_GRAPH_COM_WITH_RUNTIME_FOOT_LOCK",\n  timingPolicy: "MOVE_SPECIFIC_9_POSE_TIMING",\n  poseGraph: POSE_GRAPH_NODES,\n  motionDna: MOTION_DNA,',
    1,
)
Path("scripts/generate-procedural-fight-motions-v3.mjs").write_text(v3)

# ---------------------------------------------------------------------------
# 2) Motion profile: plant foot, timing, DNA
# ---------------------------------------------------------------------------
p = Path("src/game/motion-profile.ts")
text = p.read_text()
text = text.replace('  contactBlend: number;\n};', '''  contactBlend: number;
  plantFoot: "LEFT" | "RIGHT" | "BOTH" | "AIR";
};''', 1)
text = text.replace(
    'const MOVE_MOTIONS: Readonly<Record<string, MoveMotionSpec>> = {',
    '''export type MotionTimingProfile = {
  load: number; hold: number; launch: number; pre: number;
  impact: number; over: number; recoil: number; settle: number;
};

export type MotionDna = {
  id: "KAIRO_POWER" | "SERA_SPEED";
  hipLead: number;
  chestFollow: number;
  recoil: number;
  lateral: number;
  guardDiscipline: number;
};

const MOVE_TIMINGS: Readonly<Record<string, MotionTimingProfile>> = {
  jab:        { load: .10, hold: .16, launch: .26, pre: .48, impact: .61, over: .67, recoil: .76, settle: .88 },
  straight:   { load: .12, hold: .21, launch: .32, pre: .55, impact: .68, over: .75, recoil: .84, settle: .93 },
  backfist:   { load: .14, hold: .27, launch: .38, pre: .54, impact: .64, over: .74, recoil: .84, settle: .94 },
  bodyBlow:   { load: .16, hold: .29, launch: .41, pre: .58, impact: .70, over: .77, recoil: .87, settle: .95 },
  power:      { load: .17, hold: .34, launch: .47, pre: .63, impact: .73, over: .81, recoil: .90, settle: .97 },
  kick:       { load: .13, hold: .25, launch: .37, pre: .52, impact: .64, over: .72, recoil: .83, settle: .94 },
  lowKick:    { load: .15, hold: .28, launch: .40, pre: .55, impact: .67, over: .76, recoil: .87, settle: .95 },
  risingKick: { load: .17, hold: .30, launch: .42, pre: .58, impact: .69, over: .78, recoil: .88, settle: .96 },
  dashKick:   { load: .08, hold: .16, launch: .27, pre: .49, impact: .66, over: .73, recoil: .82, settle: .92 },
  throw:      { load: .13, hold: .26, launch: .39, pre: .51, impact: .58, over: .66, recoil: .80, settle: .93 },
  counter:    { load: .06, hold: .12, launch: .22, pre: .42, impact: .55, over: .63, recoil: .75, settle: .88 },
};

const MOTION_DNA: Readonly<Record<FighterDefinition["archetype"], MotionDna>> = {
  POWER: { id: "KAIRO_POWER", hipLead: 1.18, chestFollow: 1.10, recoil: 1.14, lateral: 0.82, guardDiscipline: 1.00 },
  SPEED: { id: "SERA_SPEED", hipLead: 1.04, chestFollow: 0.94, recoil: 0.82, lateral: 1.22, guardDiscipline: 0.92 },
};

const MOVE_MOTIONS: Readonly<Record<string, MoveMotionSpec>> = {''',
    1,
)
repls = {
'jab: { clip: "PF_Jab_L", style: "JAB", speedScale: 1.08, contactBlend: 0.24 }':'jab: { clip: "PF_Jab_L", style: "JAB", speedScale: 1.08, contactBlend: 0.24, plantFoot: "RIGHT" }',
'straight: { clip: "PF_Cross_R", style: "CROSS", speedScale: 1.02, contactBlend: 0.28 }':'straight: { clip: "PF_Cross_R", style: "CROSS", speedScale: 1.02, contactBlend: 0.28, plantFoot: "LEFT" }',
'backfist: { clip: "PF_Backfist_R", recoveryClip: "PF_HeavyRecover", style: "HOOK", speedScale: 1.0, contactBlend: 0.31 }':'backfist: { clip: "PF_Backfist_R", recoveryClip: "PF_HeavyRecover", style: "HOOK", speedScale: 1.0, contactBlend: 0.31, plantFoot: "LEFT" }',
'bodyBlow: { clip: "PF_BodyBlow_L", style: "BODY_BLOW", speedScale: 1.05, contactBlend: 0.31 }':'bodyBlow: { clip: "PF_BodyBlow_L", style: "BODY_BLOW", speedScale: 1.05, contactBlend: 0.31, plantFoot: "RIGHT" }',
'power: { clip: "PF_Power_R", recoveryClip: "PF_HeavyRecover", style: "HEAVY", speedScale: 0.92, contactBlend: 0.36 }':'power: { clip: "PF_Power_R", recoveryClip: "PF_HeavyRecover", style: "HEAVY", speedScale: 0.92, contactBlend: 0.36, plantFoot: "LEFT" }',
'kick: { clip: "PF_FrontKick_R", recoveryClip: "PF_KickRecover", style: "FRONT_KICK", speedScale: 1.0, contactBlend: 0.62 }':'kick: { clip: "PF_FrontKick_R", recoveryClip: "PF_KickRecover", style: "FRONT_KICK", speedScale: 1.0, contactBlend: 0.62, plantFoot: "LEFT" }',
'lowKick: { clip: "PF_LowKick_L", recoveryClip: "PF_KickRecover", style: "LOW_KICK", speedScale: 1.02, contactBlend: 0.66 }':'lowKick: { clip: "PF_LowKick_L", recoveryClip: "PF_KickRecover", style: "LOW_KICK", speedScale: 1.02, contactBlend: 0.66, plantFoot: "RIGHT" }',
'risingKick: { clip: "PF_RisingKick_R", recoveryClip: "PF_KickRecover", style: "RISING_KICK", speedScale: 0.94, contactBlend: 0.70 }':'risingKick: { clip: "PF_RisingKick_R", recoveryClip: "PF_KickRecover", style: "RISING_KICK", speedScale: 0.94, contactBlend: 0.70, plantFoot: "LEFT" }',
'dashKick: { clip: "PF_DashKick_R", recoveryClip: "PF_KickRecover", style: "DASH_KICK", speedScale: 0.9, contactBlend: 0.74 }':'dashKick: { clip: "PF_DashKick_R", recoveryClip: "PF_KickRecover", style: "DASH_KICK", speedScale: 0.9, contactBlend: 0.74, plantFoot: "AIR" }',
'throw: { clip: "PF_Throw", style: "THROW", speedScale: 0.92, contactBlend: 0.28 }':'throw: { clip: "PF_Throw", style: "THROW", speedScale: 0.92, contactBlend: 0.28, plantFoot: "BOTH" }',
'counter: { clip: "PF_Counter_L", style: "COUNTER", speedScale: 1.08, contactBlend: 0.29 }':'counter: { clip: "PF_Counter_L", style: "COUNTER", speedScale: 1.08, contactBlend: 0.29, plantFoot: "RIGHT" }',
}
for old, new in repls.items():
    if old not in text:
        raise SystemExit(f"missing motion mapping {old}")
    text = text.replace(old, new, 1)
text = text.replace('proceduralVersion: "PROCEDURAL_FIGHT_V2"', 'proceduralVersion: "PROCEDURAL_FIGHT_V3"', 1)
text = text.replace('rootMotionPolicy: "ADDITIVE_COM_RETURN_TO_BIND"', 'rootMotionPolicy: "POSE_GRAPH_COM_WITH_RUNTIME_FOOT_LOCK"', 1)
text = text.replace('timingPolicy: "ANTICIPATION_DRIVE_IMPACT_OVERTRAVEL_SETTLE"', 'timingPolicy: "MOVE_SPECIFIC_9_POSE_TIMING"', 1)
text = text.replace(
    '    contactBlend: 0.5,\n  };',
    '    contactBlend: 0.5,\n    plantFoot: move.animation === "kick" ? "LEFT" : "RIGHT",\n  };',
    1,
)
marker = '''export function motionRecoveryClipForMove(move: MoveDefinition): string | null {
  return motionSpecForMove(move).recoveryClip ?? null;
}
'''
addition = '''
export function motionTimingForMove(move: MoveDefinition): MotionTimingProfile {
  return MOVE_TIMINGS[move.id] ?? MOVE_TIMINGS.straight;
}

export function motionPlantFootForMove(move: MoveDefinition): MoveMotionSpec["plantFoot"] {
  return motionSpecForMove(move).plantFoot;
}

export function motionDnaForFighter(definition: FighterDefinition): MotionDna {
  return MOTION_DNA[definition.archetype];
}
'''
if marker not in text:
    raise SystemExit("missing motion profile export marker")
text = text.replace(marker, marker + addition, 1)
p.write_text(text)

# ---------------------------------------------------------------------------
# 3) Runtime: COM solver + foot lock + target-aware full-body IK + impact pair + DNA
# ---------------------------------------------------------------------------
r = Path("src/game/motion-expansion-runtime.ts")
text = r.read_text()
text = text.replace(
    '  motionRecoveryClipForMove,\n  motionSpecForMove,',
    '  motionRecoveryClipForMove,\n  motionSpecForMove,\n  motionTimingForMove,\n  motionPlantFootForMove,\n  motionDnaForFighter,',
    1,
)
text = text.replace(
    'type AttackWeights = { drive: number; impact: number; phase: "STARTUP" | "ACTIVE" | "RECOVERY"; progress: number };',
    'type AttackWeights = { drive: number; impact: number; phase: "STARTUP" | "ACTIVE" | "RECOVERY"; progress: number; poseU: number };\n\ntype FootLockState = { moveId: string; left: THREE.Vector3 | null; right: THREE.Vector3 | null };',
    1,
)
text = text.replace(
    '  tail: MotionTail | null;\n  ready: boolean;',
    '  tail: MotionTail | null;\n  footLock: FootLockState | null;\n  ready: boolean;',
    1,
)
text = text.replace(
    '    tail: null,\n    ready: false,',
    '    tail: null,\n    footLock: null,\n    ready: false,',
    1,
)
text = text.replace('fighter.visual.root.userData.motionExpansionVersion = "MOTION_READABILITY_V2";', 'fighter.visual.root.userData.motionExpansionVersion = "MOTION_QUALITY_V3";', 2)
text = text.replace('fighter.visual.root.userData.motionExpansionProceduralVersion = "PROCEDURAL_FIGHT_V2";', 'fighter.visual.root.userData.motionExpansionProceduralVersion = "PROCEDURAL_FIGHT_V3";', 1)
text = text.replace('fighter.visual.root.userData.motionExpansionRootMotionPolicy = "BOUNDED_PROCEDURAL_COM_XZ_PLUS_Y";', 'fighter.visual.root.userData.motionExpansionRootMotionPolicy = "V3_COM_FOOT_LOCK_FULL_BODY_IK";', 1)
old_weights = '''function attackWeights(fighter: FighterRuntime): AttackWeights {
  const move = fighter.currentMove;
  if (!move) return { drive: 0, impact: 0, phase: "RECOVERY", progress: 1 };
  const tick = Math.max(0, fighter.moveTick);
  if (tick < move.startup) {
    const progress = tick / Math.max(1, move.startup);
    return {
      drive: smooth01(progress),
      impact: smooth01((progress - 0.68) / 0.32) * 0.22,
      phase: "STARTUP",
      progress,
    };
  }
  if (tick < move.startup + move.active) {
    const progress = (tick - move.startup) / Math.max(1, move.active);
    return {
      drive: 1,
      impact: 0.76 + Math.sin(progress * Math.PI) * 0.24,
      phase: "ACTIVE",
      progress,
    };
  }
  const progress = (tick - move.startup - move.active) / Math.max(1, move.recovery);
  return {
    drive: 1 - smooth01(progress),
    impact: 0,
    phase: "RECOVERY",
    progress,
  };
}'''
new_weights = '''function attackWeights(fighter: FighterRuntime): AttackWeights {
  const move = fighter.currentMove;
  if (!move) return { drive: 0, impact: 0, phase: "RECOVERY", progress: 1, poseU: 1 };
  const tick = Math.max(0, fighter.moveTick);
  const total = Math.max(1, move.startup + move.active + move.recovery);
  const poseU = THREE.MathUtils.clamp(tick / total, 0, 1);
  const timing = motionTimingForMove(move);
  const launchDrive = smooth01((poseU - timing.launch) / Math.max(0.001, timing.impact - timing.launch));
  const recoilDrive = 1 - smooth01((poseU - timing.over) / Math.max(0.001, timing.settle - timing.over));
  const drive = THREE.MathUtils.clamp(launchDrive * recoilDrive, 0, 1);
  const impactIn = smooth01((poseU - timing.pre) / Math.max(0.001, timing.impact - timing.pre));
  const impactOut = 1 - smooth01((poseU - timing.impact) / Math.max(0.001, timing.recoil - timing.impact));
  const impact = THREE.MathUtils.clamp(impactIn * impactOut, 0, 1);
  if (tick < move.startup) {
    const progress = tick / Math.max(1, move.startup);
    return { drive, impact: Math.min(impact, 0.28), phase: "STARTUP", progress, poseU };
  }
  if (tick < move.startup + move.active) {
    const progress = (tick - move.startup) / Math.max(1, move.active);
    return { drive: Math.max(0.72, drive), impact: Math.max(0.68, impact), phase: "ACTIVE", progress, poseU };
  }
  const progress = (tick - move.startup - move.active) / Math.max(1, move.recovery);
  return { drive, impact: impact * 0.35, phase: "RECOVERY", progress, poseU };
}'''
if old_weights not in text:
    raise SystemExit("missing runtime attackWeights")
text = text.replace(old_weights, new_weights, 1)
# Insert V3 solvers immediately before reactionAccent.
marker = 'function reactionAccent(runtime: ExpansionRuntime, fighter: FighterRuntime): void {'
addition = r'''function captureFootLocks(runtime: ExpansionRuntime, fighter: FighterRuntime): void {
  const move = fighter.currentMove;
  if (fighter.state !== "ATTACK" || !move) {
    runtime.footLock = null;
    return;
  }
  const plant = motionPlantFootForMove(move);
  if (plant === "AIR") {
    runtime.footLock = null;
    return;
  }
  if (runtime.footLock?.moveId === move.id) return;
  runtime.model.updateMatrixWorld(true);
  const leftFoot = runtime.bones.get("foot_l");
  const rightFoot = runtime.bones.get("foot_r");
  runtime.footLock = {
    moveId: move.id,
    left: (plant === "LEFT" || plant === "BOTH") && leftFoot ? leftFoot.getWorldPosition(new THREE.Vector3()) : null,
    right: (plant === "RIGHT" || plant === "BOTH") && rightFoot ? rightFoot.getWorldPosition(new THREE.Vector3()) : null,
  };
}

function solveCenterOfMass(runtime: ExpansionRuntime, fighter: FighterRuntime, opponent: FighterRuntime): void {
  const move = fighter.currentMove;
  if (fighter.state !== "ATTACK" || !move) return;
  const pelvis = runtime.bones.get("pelvis");
  if (!pelvis) return;
  const weights = attackWeights(fighter);
  const dna = motionDnaForFighter(fighter.definition);
  const plant = motionPlantFootForMove(move);
  const support = plant === "LEFT" ? -1 : plant === "RIGHT" ? 1 : 0;
  const opponentLocal = runtime.model.worldToLocal(opponent.visual.root.getWorldPosition(new THREE.Vector3()).clone());
  const aimLateral = THREE.MathUtils.clamp(opponentLocal.x, -0.5, 0.5);
  const load = 1 - weights.drive;
  const forward = (0.008 + move.power * 0.006) * weights.drive;
  const lateral = support * 0.008 * dna.lateral * weights.drive + aimLateral * 0.010 * weights.drive;
  pelvis.position.x += THREE.MathUtils.clamp(lateral, -0.026, 0.026);
  pelvis.position.z += THREE.MathUtils.clamp(forward - load * 0.004, -0.012, 0.032);
  pelvis.position.y -= Math.min(0.016, (move.power * 0.003 + 0.002) * (0.4 + weights.drive));
}

function solveFootLock(runtime: ExpansionRuntime, fighter: FighterRuntime): number {
  const lock = runtime.footLock;
  const move = fighter.currentMove;
  if (!lock || fighter.state !== "ATTACK" || !move) return 0;
  const timing = motionTimingForMove(move);
  const weights = attackWeights(fighter);
  const release = smooth01((weights.poseU - timing.recoil) / Math.max(0.001, 1 - timing.recoil));
  let maxError = 0;
  const solve = (suffix: "l" | "r", target: THREE.Vector3 | null, side: number) => {
    if (!target) return;
    const thigh = runtime.bones.get(`thigh_${suffix}`);
    const calf = runtime.bones.get(`calf_${suffix}`);
    const foot = runtime.bones.get(`foot_${suffix}`);
    if (!thigh || !calf || !foot) return;
    const current = foot.getWorldPosition(new THREE.Vector3());
    const blended = target.clone().lerp(current, release);
    const pole = fighter.visual.root.localToWorld(new THREE.Vector3(side * 0.30, 0.50, 0.18));
    solveLimb(thigh, calf, foot, blended, pole);
    runtime.model.updateMatrixWorld(true);
    maxError = Math.max(maxError, foot.getWorldPosition(new THREE.Vector3()).distanceTo(blended));
  };
  solve("l", lock.left, -1);
  solve("r", lock.right, 1);
  return maxError;
}

function fullBodyStrikeSolve(runtime: ExpansionRuntime, fighter: FighterRuntime, opponent: FighterRuntime): void {
  const move = fighter.currentMove;
  if (fighter.state !== "ATTACK" || !move) return;
  const spec = motionSpecForMove(move);
  const weights = attackWeights(fighter);
  const dna = motionDnaForFighter(fighter.definition);
  const target = styleTarget(opponent, spec.style, strikeSide(fighter));
  const local = runtime.model.worldToLocal(target.clone());
  const aimYaw = THREE.MathUtils.clamp(Math.atan2(local.x, Math.max(0.05, Math.abs(local.z))), -0.34, 0.34);
  const aimPitch = THREE.MathUtils.clamp(Math.atan2(local.y - 0.85, Math.max(0.35, Math.abs(local.z))), -0.12, 0.12);
  const w = weights.drive;
  addRotation(runtime, "pelvis", aimPitch * 0.08, aimYaw * 0.34 * dna.hipLead, 0, w);
  addRotation(runtime, "spine_02", aimPitch * 0.18, aimYaw * 0.39 * dna.chestFollow, 0, w);
  addRotation(runtime, "spine_03", aimPitch * 0.28, aimYaw * 0.27 * dna.chestFollow, 0, w);
  // The non-striking hand stays home instead of drifting with the source clip.
  const strikeLeft = move.visualContact?.startsWith("LEFT") === true;
  const guard = strikeLeft ? "upperarm_r" : "upperarm_l";
  addRotation(runtime, guard, -0.025, strikeLeft ? -0.035 : 0.035, strikeLeft ? 0.045 : -0.045, dna.guardDiscipline * w);
}

function impactPairAccent(runtime: ExpansionRuntime, fighter: FighterRuntime, opponent: FighterRuntime): "ATTACKER" | "VICTIM" | null {
  const attacker = fighter.state === "ATTACK" && Boolean(fighter.currentMove) && opponent.state === "HIT" && (fighter.hitStop > 0 || opponent.hitStop > 0);
  const victim = fighter.state === "HIT" && opponent.state === "ATTACK" && Boolean(opponent.currentMove) && (fighter.hitStop > 0 || opponent.hitStop > 0);
  if (!attacker && !victim) return null;
  const side = attacker ? strikeSide(fighter) : -strikeSide(opponent);
  if (attacker) {
    const power = fighter.currentMove?.power ?? 1;
    addRotation(runtime, "pelvis", 0, side * 0.025 * power, 0, 1);
    addRotation(runtime, "spine_02", 0, side * 0.045 * power, side * 0.012, 1);
    addRotation(runtime, "spine_03", 0, side * 0.055 * power, side * 0.018, 1);
    return "ATTACKER";
  }
  addRotation(runtime, "pelvis", 0.018, -side * 0.035, side * 0.045, 1);
  addRotation(runtime, "spine_02", 0.045, -side * 0.055, side * 0.070, 1);
  addRotation(runtime, "spine_03", 0.060, -side * 0.070, side * 0.090, 1);
  addRotation(runtime, "head", 0.018, -side * 0.055, side * 0.080, 1);
  return "VICTIM";
}

function applyMotionDna(runtime: ExpansionRuntime, fighter: FighterRuntime): void {
  if (fighter.state !== "ATTACK" || !fighter.currentMove) return;
  const dna = motionDnaForFighter(fighter.definition);
  const weights = attackWeights(fighter);
  const side = strikeSide(fighter);
  if (dna.id === "KAIRO_POWER") {
    addRotation(runtime, "pelvis", 0, side * 0.035 * dna.hipLead, 0, weights.drive);
    addRotation(runtime, "spine_02", 0, side * 0.025 * dna.chestFollow, 0, weights.drive);
    if (weights.phase === "RECOVERY") addRotation(runtime, "spine_03", 0.020 * dna.recoil, -side * 0.020, 0, 1 - weights.drive);
  } else {
    addRotation(runtime, "pelvis", 0, side * 0.018, -side * 0.030 * dna.lateral, weights.drive);
    addRotation(runtime, "spine_03", -0.018, side * 0.018, -side * 0.025 * dna.lateral, weights.drive);
    if (weights.phase === "RECOVERY") addRotation(runtime, "pelvis", -0.012, -side * 0.025, side * 0.018, 1 - weights.drive);
  }
}

'''
if marker not in text:
    raise SystemExit("missing reactionAccent marker")
text = text.replace(marker, addition + marker, 1)
# Replace runtime application order so COM -> target-aware body -> strike limb -> planted feet.
old_order = '''  runtime.mixer.update(delta);
  runtime.model.updateMatrixWorld(true);
  attackSilhouette(runtime, fighter);
  reactionAccent(runtime, fighter);
  airborneAccent(runtime, fighter);
  runtime.model.updateMatrixWorld(true);
  strikeTrajectory(runtime, fighter, opponent);
  runtime.model.updateMatrixWorld(true);

  fighter.visual.root.userData.motionExpansionCurrentClip = runtime.currentClip;'''
new_order = '''  runtime.mixer.update(delta);
  runtime.model.updateMatrixWorld(true);
  captureFootLocks(runtime, fighter);
  solveCenterOfMass(runtime, fighter, opponent);
  attackSilhouette(runtime, fighter);
  fullBodyStrikeSolve(runtime, fighter, opponent);
  applyMotionDna(runtime, fighter);
  reactionAccent(runtime, fighter);
  airborneAccent(runtime, fighter);
  const impactPairRole = impactPairAccent(runtime, fighter, opponent);
  runtime.model.updateMatrixWorld(true);
  strikeTrajectory(runtime, fighter, opponent);
  runtime.model.updateMatrixWorld(true);
  const footLockError = solveFootLock(runtime, fighter);
  runtime.model.updateMatrixWorld(true);

  fighter.visual.root.userData.motionExpansionCurrentClip = runtime.currentClip;'''
if old_order not in text:
    raise SystemExit("missing runtime apply order")
text = text.replace(old_order, new_order, 1)
text = text.replace(
    '  fighter.visual.root.userData.motionExpansionContactMode = "OPPONENT_WEIGHTED_IK";\n  return true;',
    '''  fighter.visual.root.userData.motionExpansionContactMode = "V3_FULL_BODY_TARGET_IK";
  fighter.visual.root.userData.motionExpansionFootLockPolicy = "WORLD_SPACE_SUPPORT_FOOT_IK";
  fighter.visual.root.userData.motionExpansionFootLockError = footLockError;
  fighter.visual.root.userData.motionExpansionComPolicy = "PLANT_WEIGHTED_BOUNDED_COM";
  fighter.visual.root.userData.motionExpansionImpactPairRole = impactPairRole;
  fighter.visual.root.userData.motionExpansionMotionDna = motionDnaForFighter(fighter.definition).id;
  fighter.visual.root.userData.motionExpansionPoseGraph = "9_POSE_GRAPH";
  return true;''',
    1,
)
text = text.replace('const FULL_BODY_BALANCE_VERSION = "FULL_BODY_BALANCE_V3";', 'const FULL_BODY_BALANCE_VERSION = "FULL_BODY_SOLVER_V3";', 1)
r.write_text(text)

# ---------------------------------------------------------------------------
# 4) Tests: require all seven V3 systems, no placeholder-only upgrade
# ---------------------------------------------------------------------------
t = Path("tests/motion-expansion.test.ts")
text = t.read_text()
text = text.replace('test("Procedural Fight v2 maps every authored move to generated motion and reaction data"', 'test("Procedural Fight v3 maps every authored move to pose-graph motion and reaction data"', 1)
text = text.replace('assert.equal(MOTION_EXPANSION_PROFILE.version, "MOTION_READABILITY_V2");', 'assert.equal(MOTION_EXPANSION_PROFILE.version, "MOTION_READABILITY_V2");', 1)
text = text.replace('assert.equal(MOTION_EXPANSION_PROFILE.proceduralVersion, "PROCEDURAL_FIGHT_V2");', 'assert.equal(MOTION_EXPANSION_PROFILE.proceduralVersion, "PROCEDURAL_FIGHT_V3");', 1)
text = text.replace('assert.equal(MOTION_EXPANSION_PROFILE.rootMotionPolicy, "ADDITIVE_COM_RETURN_TO_BIND");', 'assert.equal(MOTION_EXPANSION_PROFILE.rootMotionPolicy, "POSE_GRAPH_COM_WITH_RUNTIME_FOOT_LOCK");\n  assert.equal(MOTION_EXPANSION_PROFILE.timingPolicy, "MOVE_SPECIFIC_9_POSE_TIMING");', 1)
start = 'test("procedural v2 generator artifact contains 23 clips, handed variants, root motion and deterministic timing metadata", async () => {'
if start not in text:
    raise SystemExit("missing v2 generator test start")
text = text.replace(start, 'test("procedural v3 generator contains pose graph, support-foot authoring, COM and move-specific timing", async () => {', 1)
text = text.replace('../scripts/generate-procedural-fight-motions-v2.mjs', '../scripts/generate-procedural-fight-motions-v3.mjs', 1)
text = text.replace('assert.match(source, /PROCEDURAL_FIGHT_V2/);', 'assert.match(source, /PROCEDURAL_FIGHT_V3/);\n  assert.match(source, /POSE_GRAPH_NODES/);\n  assert.match(source, /MOVE_TIMINGS/);\n  assert.match(source, /authorSupportLeg/);\n  assert.match(source, /MOTION_DNA/);', 1)
text = text.replace('assert.equal(metrics.version, "PROCEDURAL_FIGHT_V2");', 'assert.equal(metrics.version, "PROCEDURAL_FIGHT_V3");', 1)
text = text.replace('assert.equal(metrics.rootMotionPolicy, "ADDITIVE_COM_RETURN_TO_BIND");', 'assert.equal(metrics.rootMotionPolicy, "POSE_GRAPH_COM_WITH_RUNTIME_FOOT_LOCK");', 1)
text = text.replace('assert.equal(metrics.timingPolicy, "ANTICIPATION_DRIVE_IMPACT_OVERTRAVEL_SETTLE");', 'assert.equal(metrics.timingPolicy, "MOVE_SPECIFIC_9_POSE_TIMING");\n  assert.equal(metrics.poseGraph.length, 9);\n  assert.equal(metrics.motionDna.POWER.id, "KAIRO_POWER");\n  assert.equal(metrics.motionDna.SPEED.id, "SERA_SPEED");', 1)
text = text.replace('test("v2 readability mappings use generated recovery clips instead of generic library recovery"', 'test("v3 mappings retain generated recovery clips and authored support feet"', 1)
text = text.replace('  assert.equal(dash.contactBlend >= 0.65 && dash.contactBlend <= 0.8);' if False else '  assert.ok(dash.contactBlend >= 0.65 && dash.contactBlend <= 0.8);', '  assert.ok(dash.contactBlend >= 0.65 && dash.contactBlend <= 0.8);\n  assert.equal(jab.plantFoot, "RIGHT");\n  assert.equal(power.plantFoot, "LEFT");\n  assert.equal(dash.plantFoot, "AIR");', 1)
text = text.replace('assert.match(source, /FULL_BODY_BALANCE_VERSION = "FULL_BODY_BALANCE_V3"/);', 'assert.match(source, /FULL_BODY_BALANCE_VERSION = "FULL_BODY_SOLVER_V3"/);', 1)
text = text.replace('assert.match(source, /PROCEDURAL_FIGHT_V2/);', 'assert.match(source, /PROCEDURAL_FIGHT_V3/);', 1)
text = text.replace('assert.match(source, /motionExpansionContactMode = "OPPONENT_WEIGHTED_IK"/);', 'assert.match(source, /motionExpansionContactMode = "V3_FULL_BODY_TARGET_IK"/);\n  assert.match(source, /captureFootLocks/);\n  assert.match(source, /solveFootLock/);\n  assert.match(source, /solveCenterOfMass/);\n  assert.match(source, /fullBodyStrikeSolve/);\n  assert.match(source, /impactPairAccent/);\n  assert.match(source, /applyMotionDna/);\n  assert.match(source, /motionExpansionFootLockError/);', 1)
text = text.replace('assert.match(source, /motionExpansionRootMotionPolicy = "BOUNDED_PROCEDURAL_COM_XZ_PLUS_Y"/);', 'assert.match(source, /motionExpansionRootMotionPolicy = "V3_COM_FOOT_LOCK_FULL_BODY_IK"/);', 1)
t.write_text(text)

# ---------------------------------------------------------------------------
# 5) Real WebGL audit upgrades + V3 workflow
# ---------------------------------------------------------------------------
a = Path("scripts/capture-motion-readability-audit.mjs")
text = a.read_text().replace('"MOTION_READABILITY_V2"', '"MOTION_QUALITY_V3"').replace('"PROCEDURAL_FIGHT_V2"', '"PROCEDURAL_FIGHT_V3"')
a.write_text(text)

w = Path(".github/workflows/procedural-fight-motion-generator.yml")
text = w.read_text()
text = text.replace('      - scripts/generate-procedural-fight-motions-v2.mjs', '      - scripts/generate-procedural-fight-motions-v2.mjs\n      - scripts/generate-procedural-fight-motions-v3.mjs', 1)
text = text.replace('Generate deterministic fight motion pack v2', 'Generate deterministic fight motion pack v3', 1)
text = text.replace('node scripts/generate-procedural-fight-motions-v2.mjs', 'node scripts/generate-procedural-fight-motions-v3.mjs', 1)
text = text.replace('Verify generated v2 clip inventory and motion contract', 'Verify generated v3 clip inventory and motion contract', 1)
text = text.replace("metrics.version !== 'PROCEDURAL_FIGHT_V2'", "metrics.version !== 'PROCEDURAL_FIGHT_V3'", 1)
text = text.replace("metrics.rootMotionPolicy !== 'ADDITIVE_COM_RETURN_TO_BIND'", "metrics.rootMotionPolicy !== 'POSE_GRAPH_COM_WITH_RUNTIME_FOOT_LOCK'", 1)
text = text.replace("throw new Error('v2 expected planar center-of-mass movement on most clips')", "throw new Error('v3 expected planar center-of-mass movement on most clips')", 1)
text = text.replace('Generate procedural fight motion pack v2', 'Generate procedural fight motion pack v3', 1)
w.write_text(text)

print("Procedural Fight v3 source/runtime/audit migration applied")

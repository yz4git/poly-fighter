from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


runtime_path = Path("src/game/visual-quaternius-runtime.ts")
runtime = runtime_path.read_text()
runtime = replace_once(
    runtime,
    'export const QUATERNIUS_UAL_CORE_URL = `${BASE_PATH}/models/quaternius/ual-fight-core.glb`;\n',
    'export const QUATERNIUS_UAL_CORE_URL = `${BASE_PATH}/models/quaternius/ual-fight-core.glb`;\n'
    'export const QUATERNIUS_PROCEDURAL_CORE_URL = `${BASE_PATH}/models/quaternius/procedural-fight-core.glb`;\n',
    "procedural core constant",
)
runtime = replace_once(
    runtime,
    'motionPromise = new GLTFLoader().loadAsync(QUATERNIUS_UAL_CORE_URL).then((gltf) => ({',
    'motionPromise = new GLTFLoader().loadAsync(QUATERNIUS_PROCEDURAL_CORE_URL).then((gltf) => ({',
    "user-facing procedural motion source",
)
runtime = replace_once(
    runtime,
    'const IMPORTED_NEUTRAL_FORWARD_CLEARANCE = 1.55;\nconst IMPORTED_GUARD_FORWARD_CLEARANCE = 1.85;\n',
    'const IMPORTED_NEUTRAL_FORWARD_CLEARANCE = 1.72;\n'
    'const IMPORTED_GUARD_FORWARD_CLEARANCE = 1.98;\n'
    'const IMPORTED_NEUTRAL_HAND_LIFT = 0.035;\n'
    'const IMPORTED_GUARD_HAND_LIFT = 0.082;\n',
    "ready-pose constants",
)
runtime = replace_once(
    runtime,
    '''  // A little inward gives a fighting stance, but never enough to cross the torso.\n  targetLocal.x -= side * layout.shoulderWidth * (guard ? 0.10 : 0.14);\n  targetLocal.y += guard ? 0.055 : -0.035;\n  targetLocal.z += layout.chestDepth * (guard ? IMPORTED_GUARD_FORWARD_CLEARANCE : IMPORTED_NEUTRAL_FORWARD_CLEARANCE);\n\n  // Keep the elbow outside the rib cage and slightly behind the fist.\n  const poleLocal = shoulderLocal.clone();\n  poleLocal.x += side * layout.shoulderWidth * 0.72;\n  poleLocal.y += guard ? 0.015 : -0.075;\n  poleLocal.z += layout.chestDepth * (guard ? 1.25 : 1.05);\n''',
    '''  // Keep the fists in a compact forward guard. The previous neutral pole sat\n  // below the shoulder, which made the two-bone solver choose a hanging elbow\n  // plane and visibly folded the forearm downward.\n  targetLocal.x -= side * layout.shoulderWidth * (guard ? 0.07 : 0.11);\n  targetLocal.y += guard ? IMPORTED_GUARD_HAND_LIFT : IMPORTED_NEUTRAL_HAND_LIFT;\n  targetLocal.z += layout.chestDepth * (guard ? IMPORTED_GUARD_FORWARD_CLEARANCE : IMPORTED_NEUTRAL_FORWARD_CLEARANCE);\n\n  // The pole stays lateral and at shoulder height so the elbow bends outward,\n  // never underneath the upper arm. The fist target remains slightly above it.\n  const poleLocal = shoulderLocal.clone();\n  poleLocal.x += side * layout.shoulderWidth * (guard ? 0.86 : 0.82);\n  poleLocal.y += guard ? 0.010 : 0.0;\n  poleLocal.z += layout.chestDepth * (guard ? 1.12 : 0.94);\n''',
    "ready arm target/pole",
)
marker = 'function desiredClip(fighter: FighterRuntime): { name: string; loop: boolean; speed: number } {'
helper = '''const PROCEDURAL_ATTACK_CLIPS: Readonly<Record<string, string>> = {\n  jab: "PF_Jab_L",\n  straight: "PF_Cross_R",\n  backfist: "PF_Backfist_R",\n  bodyBlow: "PF_BodyBlow_L",\n  power: "PF_Power_R",\n  kick: "PF_FrontKick_R",\n  lowKick: "PF_LowKick_L",\n  risingKick: "PF_RisingKick_R",\n  dashKick: "PF_DashKick_R",\n  throw: "PF_Throw",\n  counter: "PF_Counter_R",\n};\n\nfunction proceduralAttackClip(moveId: string): string | null {\n  return PROCEDURAL_ATTACK_CLIPS[moveId] ?? null;\n}\n\n'''
if helper not in runtime:
    runtime = replace_once(runtime, marker, helper + marker, "procedural attack helper")
runtime = replace_once(
    runtime,
    '''  if (fighter.state === "ATTACK" && move) {\n    const seconds = Math.max(1 / 60, (move.startup + move.active + move.recovery) / 60);\n    if (move.animation === "punch") {\n      return { name: move.id === "jab" ? "Punch_Jab" : "Punch_Cross", loop: false, speed: 1 / seconds };\n    }\n    if (move.animation === "kick") {\n      return { name: move.id === "dashKick" ? "Roll" : "Jump_Start", loop: false, speed: 1 / seconds };\n    }\n    if (move.animation === "throw") return { name: "Punch_Cross", loop: false, speed: 1 / seconds };\n    return { name: "Punch_Cross", loop: false, speed: 1 / seconds };\n  }\n''',
    '''  if (fighter.state === "ATTACK" && move) {\n    const seconds = Math.max(1 / 60, (move.startup + move.active + move.recovery) / 60);\n    const proceduralClip = proceduralAttackClip(move.id);\n    if (proceduralClip) return { name: proceduralClip, loop: false, speed: 1 / seconds };\n    if (move.animation === "punch") return { name: "Punch_Cross", loop: false, speed: 1 / seconds };\n    if (move.animation === "kick") return { name: "Jump_Start", loop: false, speed: 1 / seconds };\n    if (move.animation === "throw") return { name: "PF_Throw", loop: false, speed: 1 / seconds };\n    return { name: "Punch_Cross", loop: false, speed: 1 / seconds };\n  }\n''',
    "procedural attack routing",
)
runtime = runtime.replace('case "BLOCK_STUN": return { name: "Hit_Chest", loop: false, speed: 1.35 };', 'case "BLOCK_STUN": return { name: "PF_GuardBreak", loop: false, speed: 1.35 };')
runtime = runtime.replace('case "HIT": return { name: "Hit_Chest", loop: false, speed: 1.35 };', 'case "HIT": return { name: "PF_HitHeavy", loop: false, speed: 1.35 };')
runtime = runtime.replace('case "RING_OUT": return { name: "Death01", loop: false, speed: 1 };', 'case "RING_OUT": return { name: "PF_DownBack", loop: false, speed: 1 };')
runtime = runtime.replace('case "THROW": return { name: "Punch_Cross", loop: false, speed: 1 };', 'case "THROW": return { name: "PF_Throw", loop: false, speed: 1 };')
runtime = runtime.replace('case "WAKEUP": return { name: "Jump_Land", loop: false, speed: 1.2 };', 'case "WAKEUP": return { name: "PF_Wakeup", loop: false, speed: 1.2 };')
runtime = replace_once(
    runtime,
    '  runtime.currentClip = name;\n  runtime.currentAction = action;\n',
    '  runtime.currentClip = name;\n  runtime.currentAction = action;\n  runtime.host.userData.quaterniusCurrentClip = clip.name;\n',
    "visible clip diagnostic",
)
runtime_path.write_text(runtime)

polish_path = Path("src/game/quaternius-graphics-polish.ts")
polish = polish_path.read_text()
insert_after = '''function panelGeometry(\n  width: number,\n  height: number,\n  depth: number,\n  topScale = 1,\n  bottomScale = 1,\n): THREE.BufferGeometry {'''
# Insert fist helper after the complete panelGeometry function, using the next material helper as the stable anchor.
material_anchor = 'function heroMaterial(color: THREE.ColorRepresentation, metalness: number, roughness: number): THREE.MeshStandardMaterial {'
fist_helper = '''/** Compact faceted glove volume that guarantees a readable fist silhouette. */\nfunction fistGeometry(width: number, height: number, depth: number): THREE.BufferGeometry {\n  const geometry = new THREE.DodecahedronGeometry(0.5, 0);\n  geometry.scale(width, height, depth);\n  return geometry;\n}\n\n'''
if fist_helper not in polish:
    polish = replace_once(polish, material_anchor, fist_helper + material_anchor, "fist geometry helper")

kairo_anchor = '''    {\n      name: "ubc-kairo-outfit-left-trouser",'''
kairo_fists = '''    {\n      name: "ubc-kairo-left-fist",\n      boneNames: ["hand_l"],\n      geometry: fistGeometry(0.062, 0.050, 0.072),\n      material: dark,\n      offset: [0, -0.012, 0.030],\n      rotation: [-0.05, 0.02, -0.03],\n    },\n    {\n      name: "ubc-kairo-right-fist",\n      boneNames: ["hand_r"],\n      geometry: fistGeometry(0.062, 0.050, 0.072),\n      material: dark,\n      offset: [0, -0.012, 0.030],\n      rotation: [-0.05, -0.02, 0.03],\n    },\n'''
if "ubc-kairo-left-fist" not in polish:
    polish = replace_once(polish, kairo_anchor, kairo_fists + kairo_anchor, "Kairo fists")

sera_anchor = '''    {\n      name: "ubc-sera-outfit-left-legging",'''
sera_fists = '''    {\n      name: "ubc-sera-left-fist",\n      boneNames: ["hand_l"],\n      geometry: fistGeometry(0.055, 0.045, 0.066),\n      material: clothDark,\n      offset: [0, -0.011, 0.027],\n      rotation: [-0.04, 0.02, -0.025],\n    },\n    {\n      name: "ubc-sera-right-fist",\n      boneNames: ["hand_r"],\n      geometry: fistGeometry(0.055, 0.045, 0.066),\n      material: clothDark,\n      offset: [0, -0.011, 0.027],\n      rotation: [-0.04, -0.02, 0.025],\n    },\n'''
if "ubc-sera-left-fist" not in polish:
    polish = replace_once(polish, sera_anchor, sera_fists + sera_anchor, "Sera fists")
polish_path.write_text(polish)

# Strengthen the runtime regression contract around the exact failure the user reported.
test_path = Path("tests/quaternius-model-skin.test.ts")
test = test_path.read_text()
test = replace_once(
    test,
    '  QUATERNIUS_UBC_FEMALE_MODEL_URL,\n  QUATERNIUS_UBC_MALE_MODEL_URL,\n  QUATERNIUS_UAL_CORE_URL,\n',
    '  QUATERNIUS_UBC_FEMALE_MODEL_URL,\n  QUATERNIUS_UBC_MALE_MODEL_URL,\n  QUATERNIUS_PROCEDURAL_CORE_URL,\n  QUATERNIUS_UAL_CORE_URL,\n',
    "test procedural import",
)
test = replace_once(
    test,
    '  assert.match(QUATERNIUS_UAL_CORE_URL, /ual-fight-core\\.glb$/);\n',
    '  assert.match(QUATERNIUS_UAL_CORE_URL, /ual-fight-core\\.glb$/);\n  assert.match(QUATERNIUS_PROCEDURAL_CORE_URL, /procedural-fight-core\\.glb$/);\n',
    "test procedural core URL",
)
test = replace_once(
    test,
    '  assert.match(runtime, /quaterniusAnimationRigCoverage = 1/);\n',
    '  assert.match(runtime, /quaterniusAnimationRigCoverage = 1/);\n  assert.match(runtime, /loadAsync\\(QUATERNIUS_PROCEDURAL_CORE_URL\\)/);\n  assert.match(runtime, /PF_Jab_L/);\n  assert.match(runtime, /PF_Power_R/);\n  assert.match(runtime, /IMPORTED_NEUTRAL_HAND_LIFT/);\n  assert.doesNotMatch(runtime, /poleLocal\\.y \\+= guard \\? 0\\.015 : -0\\.075/);\n',
    "runtime arm regression assertions",
)
test = replace_once(
    test,
    '  assert.match(polish, /ubc-kairo-left-gauntlet/);\n',
    '  assert.match(polish, /ubc-kairo-left-gauntlet/);\n  assert.match(polish, /function fistGeometry/);\n  assert.match(polish, /ubc-kairo-left-fist/);\n  assert.match(polish, /ubc-kairo-right-fist/);\n  assert.match(polish, /ubc-sera-left-fist/);\n  assert.match(polish, /ubc-sera-right-fist/);\n',
    "fist regression assertions",
)
test_path.write_text(test)

# Make the screenshot-driven motion audit verify the user-facing imported model,
# not only the hidden procedural rig.
audit_path = Path("scripts/capture-motion-readability-audit.mjs")
audit = audit_path.read_text()
audit = replace_once(
    audit,
    '''      handL: point(get('hand_l')),\n      handR: point(get('hand_r')),\n      footL: point(get('foot_l')),\n''',
    '''      upperArmL: point(get('upperarm_l')),\n      upperArmR: point(get('upperarm_r')),\n      elbowL: point(get('lowerarm_l')),\n      elbowR: point(get('lowerarm_r')),\n      handL: point(get('hand_l')),\n      handR: point(get('hand_r')),\n      footL: point(get('foot_l')),\n''',
    "audit arm points",
)
audit = replace_once(
    audit,
    '  const results = {};\n',
    '''  const neutral = await execute(sessionId, `${gameLookup}${resetAndPose}\n    const game = findGame();\n    resetFighter(game.p1);\n    resetFighter(game.p2);\n    resetTpsTransient(game);\n    game.p1.position.set(0, 0, 0.74);\n    game.p2.position.set(0, 0, -0.48);\n    game.p1.facing = 1;\n    game.p2.facing = -1;\n    let auditTime = performance.now() / 1000;\n    for (let step = 0; step < 8; step += 1) {\n      auditTime += 1 / 60;\n      game.updateVisual(game.p1, game.p2, auditTime);\n      game.updateVisual(game.p2, game.p1, auditTime + 0.007);\n    }\n    game.updateCamera(1 / 60);\n    game.updateLockOn();\n    game.renderer.render(game.scene, game.camera);\n    const host = game.p1.visual.root.children.find((child) => child.name?.startsWith('quaternius-ubc-'));\n    let fistMeshCount = 0;\n    game.p1.visual.root.traverse((object) => { if (object.name?.endsWith('-fist')) fistMeshCount += 1; });\n    return {\n      points: bonePoints(game.p1),\n      visibleClip: host?.userData?.quaterniusCurrentClip ?? null,\n      fistMeshCount,\n    };\n  `);\n  await screenshot(sessionId, `${outputDir}/tps-motion-neutral-arm.png`);\n  if (!neutral?.points) throw new Error(`Neutral imported arm points missing: ${JSON.stringify(neutral)}`);\n  for (const side of ['L', 'R']) {\n    const elbow = neutral.points[`elbow${side}`];\n    const hand = neutral.points[`hand${side}`];\n    if (!elbow || !hand) throw new Error(`Neutral ${side} arm chain missing: ${JSON.stringify(neutral)}`);\n    if (hand.y < elbow.y - 0.055) {\n      throw new Error(`Neutral ${side} forearm hangs below the elbow: ${JSON.stringify({ elbow, hand, neutral })}`);\n    }\n  }\n  if (neutral.fistMeshCount < 2) throw new Error(`Readable fist geometry missing: ${JSON.stringify(neutral)}`);\n\n  const results = {};\n''',
    "neutral arm screenshot audit",
)
audit = replace_once(
    audit,
    '''      const root = game.p1.visual.root;\n      const points = bonePoints(game.p1);\n''',
    '''      const root = game.p1.visual.root;\n      const importedHost = root.children.find((child) => child.name?.startsWith('quaternius-ubc-'));\n      let fistMeshCount = 0;\n      root.traverse((object) => { if (object.name?.endsWith('-fist')) fistMeshCount += 1; });\n      const points = bonePoints(game.p1);\n''',
    "active visible model diagnostics",
)
audit = replace_once(
    audit,
    '''        clip: root.userData.motionExpansionCurrentClip ?? null,\n        phase: root.userData.motionExpansionPhase ?? null,\n''',
    '''        clip: root.userData.motionExpansionCurrentClip ?? null,\n        visibleClip: importedHost?.userData?.quaterniusCurrentClip ?? null,\n        fistMeshCount,\n        phase: root.userData.motionExpansionPhase ?? null,\n''',
    "active visible clip result",
)
audit = replace_once(
    audit,
    '''    if (result.clip !== expected) {\n      throw new Error(`Motion ${moveId} resolved to ${result.clip}, expected ${expected}: ${JSON.stringify(result)}`);\n    }\n''',
    '''    if (result.clip !== expected) {\n      throw new Error(`Motion ${moveId} resolved to ${result.clip}, expected ${expected}: ${JSON.stringify(result)}`);\n    }\n    if (result.visibleClip !== expected) {\n      throw new Error(`User-facing Quaternius motion ${moveId} resolved to ${result.visibleClip}, expected ${expected}: ${JSON.stringify(result)}`);\n    }\n    if (result.fistMeshCount < 2) {\n      throw new Error(`User-facing fist silhouette missing during ${moveId}: ${JSON.stringify(result)}`);\n    }\n''',
    "visible clip/fist assertions",
)
audit = replace_once(
    audit,
    '    preload,\n    allMovesActive:',
    '    preload,\n    neutral,\n    allMovesActive:',
    "diagnostics neutral",
)
audit_path.write_text(audit)

print("Applied arm/fist playtest fix")

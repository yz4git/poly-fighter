import fs from "node:fs";

const runtimePath = "src/game/visual-quaternius-runtime.ts";
let source = fs.readFileSync(runtimePath, "utf8");

const startMarker = "// Neutral ready stances must keep an elbow bend.";
const endMarker = "function desiredClip(fighter: FighterRuntime):";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker);
if (start < 0 || end < 0 || end <= start) throw new Error("Ready-pose correction block not found");

const replacement = `// Imported UBC neutral/guard poses use UBC shoulder space, not the hidden\n// procedural fighter's fist end-effectors. Reusing those legacy targets pulled\n// the imported arms through the chest. Build a compact fighting guard from the\n// actual imported shoulder position and keep both hands explicitly in front of\n// the torso. Active attacks still use deterministic gameplay contact targets.\nconst IMPORTED_NEUTRAL_FORWARD_CLEARANCE = 1.55;\nconst IMPORTED_GUARD_FORWARD_CLEARANCE = 1.85;\n\nfunction importedReadyArmPose(\n  fighter: FighterRuntime,\n  suffix: \"l\" | \"r\",\n  upperArm: THREE.Object3D,\n  guard: boolean,\n): { target: THREE.Vector3; pole: THREE.Vector3 } {\n  upperArm.updateWorldMatrix(true, true);\n  const shoulderWorld = upperArm.getWorldPosition(new THREE.Vector3());\n  const shoulderLocal = fighter.visual.root.worldToLocal(shoulderWorld.clone());\n  const side = suffix === \"l\" ? 1 : -1;\n  const layout = fighter.visual.layout;\n\n  const targetLocal = shoulderLocal.clone();\n  // A little inward gives a fighting stance, but never enough to cross the torso.\n  targetLocal.x -= side * layout.shoulderWidth * (guard ? 0.10 : 0.14);\n  targetLocal.y += guard ? 0.055 : -0.035;\n  targetLocal.z += layout.chestDepth * (guard ? IMPORTED_GUARD_FORWARD_CLEARANCE : IMPORTED_NEUTRAL_FORWARD_CLEARANCE);\n\n  // Keep the elbow outside the rib cage and slightly behind the fist.\n  const poleLocal = shoulderLocal.clone();\n  poleLocal.x += side * layout.shoulderWidth * 0.72;\n  poleLocal.y += guard ? 0.015 : -0.075;\n  poleLocal.z += layout.chestDepth * (guard ? 1.25 : 1.05);\n\n  return {\n    target: fighter.visual.root.localToWorld(targetLocal),\n    pole: fighter.visual.root.localToWorld(poleLocal),\n  };\n}\n\nfunction neutralPoseCorrection(runtime: QuaterniusRuntime, fighter: FighterRuntime): void {\n  if (fighter.state !== \"IDLE\" && fighter.state !== \"WALK\" && fighter.state !== \"CROUCH\") return;\n  for (const suffix of [\"l\", \"r\"] as const) {\n    const root = runtime.bones.get(\`upperarm_\${suffix}\`);\n    const mid = runtime.bones.get(\`lowerarm_\${suffix}\`);\n    const end = runtime.bones.get(\`hand_\${suffix}\`);\n    if (!root || !mid || !end) continue;\n    const pose = importedReadyArmPose(fighter, suffix, root, false);\n    solveImportedArm(runtime, suffix, root, mid, end, pose.target, pose.pole, 0.18);\n  }\n}\n\nfunction guardPoseCorrection(runtime: QuaterniusRuntime, fighter: FighterRuntime): void {\n  if (fighter.state !== \"GUARD\") return;\n  for (const suffix of [\"l\", \"r\"] as const) {\n    const root = runtime.bones.get(\`upperarm_\${suffix}\`);\n    const mid = runtime.bones.get(\`lowerarm_\${suffix}\`);\n    const end = runtime.bones.get(\`hand_\${suffix}\`);\n    if (!root || !mid || !end) continue;\n    const pose = importedReadyArmPose(fighter, suffix, root, true);\n    solveImportedArm(runtime, suffix, root, mid, end, pose.target, pose.pole, 0.24);\n  }\n}\n\n`;

source = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(runtimePath, source);

const testPath = "tests/quaternius-shoulder.test.ts";
let tests = fs.readFileSync(testPath, "utf8");
const oldTestStart = 'test("neutral and guard elbow poles stay outside the torso"';
const oldIndex = tests.indexOf(oldTestStart);
if (oldIndex >= 0) tests = tests.slice(0, oldIndex);

tests += `test("imported neutral and guard hands stay in front of the torso", () => {\n  assert.ok(source.includes("function importedReadyArmPose("));\n  assert.ok(source.includes("IMPORTED_NEUTRAL_FORWARD_CLEARANCE = 1.55"));\n  assert.ok(source.includes("IMPORTED_GUARD_FORWARD_CLEARANCE = 1.85"));\n  assert.ok(source.includes("targetLocal.z += layout.chestDepth"));\n  assert.ok(source.includes("poleLocal.x += side * layout.shoulderWidth * 0.72"));\n});\n\ntest("neutral and guard corrections no longer reuse legacy fist targets", () => {\n  const neutralStart = source.indexOf("function neutralPoseCorrection");\n  const desiredStart = source.indexOf("function desiredClip", neutralStart);\n  const readyBlock = source.slice(neutralStart, desiredStart);\n  assert.equal(readyBlock.includes("getVisualContactPoint"), false);\n  assert.ok(readyBlock.includes("importedReadyArmPose(fighter, suffix, root, false)"));\n  assert.ok(readyBlock.includes("importedReadyArmPose(fighter, suffix, root, true)"));\n});\n`;
fs.writeFileSync(testPath, tests);
console.log("Applied imported UBC arm/body clearance fix");

import fs from "node:fs";

const runtimePath = "src/game/visual-quaternius-runtime.ts";
let source = fs.readFileSync(runtimePath, "utf8");

if (!source.includes("MAX_IMPORTED_NEUTRAL_REACH")) {
  const anchor = "\nfunction neutralPoseCorrection(runtime: QuaterniusRuntime, fighter: FighterRuntime): void {";
  if (!source.includes(anchor)) throw new Error("Neutral pose anchor missing");
  const helper = `

// Neutral ready stances must keep an elbow bend. The deterministic fist targets
// can sit near full arm extension (especially on KAIRO), which pulls the UBC
// shoulder skin inward even after clavicle distribution. Clamp only neutral/
// walk/crouch targets; guard and active attacks keep their authored contact reach.
const MAX_IMPORTED_NEUTRAL_REACH = 0.76;

function clampImportedArmTarget(
  upperArm: THREE.Object3D,
  forearm: THREE.Object3D,
  hand: THREE.Object3D,
  target: THREE.Vector3,
  reachFraction: number,
): THREE.Vector3 {
  upperArm.updateWorldMatrix(true, true);
  const rootPos = upperArm.getWorldPosition(new THREE.Vector3());
  const midPos = forearm.getWorldPosition(new THREE.Vector3());
  const endPos = hand.getWorldPosition(new THREE.Vector3());
  const armLength = rootPos.distanceTo(midPos) + midPos.distanceTo(endPos);
  const delta = target.clone().sub(rootPos);
  const maxReach = armLength * THREE.MathUtils.clamp(reachFraction, 0.55, 0.98);
  if (delta.length() > maxReach) delta.setLength(maxReach);
  return rootPos.add(delta);
}
`;
  source = source.replace(anchor, `${helper}${anchor}`);
}

const before = `    const target = getVisualContactPoint(fighter.visual, chain.contact);
    const pole = fighter.visual.root.localToWorld(new THREE.Vector3(chain.poleSide * 0.60, 0.72, 0.30));
    solveImportedArm(runtime, chain.suffix, root, mid, end, target, pole, 0.30);`;
const after = `    const rawTarget = getVisualContactPoint(fighter.visual, chain.contact);
    const target = clampImportedArmTarget(root, mid, end, rawTarget, MAX_IMPORTED_NEUTRAL_REACH);
    const pole = fighter.visual.root.localToWorld(new THREE.Vector3(chain.poleSide * 0.60, 0.72, 0.30));
    solveImportedArm(runtime, chain.suffix, root, mid, end, target, pole, 0.28);`;
if (source.includes(before)) source = source.replace(before, after);
else if (!source.includes(after)) throw new Error("Neutral target block missing");

fs.writeFileSync(runtimePath, source);

const testPath = "tests/quaternius-shoulder.test.ts";
let testSource = fs.readFileSync(testPath, "utf8");
if (!testSource.includes("neutral ready pose keeps an elbow bend")) {
  testSource += `\n\ntest("neutral ready pose keeps an elbow bend", () => {\n  assert.ok(source.includes("MAX_IMPORTED_NEUTRAL_REACH = 0.76"));\n  assert.ok(source.includes("clampImportedArmTarget(root, mid, end, rawTarget, MAX_IMPORTED_NEUTRAL_REACH)"));\n  assert.ok(source.includes("solveImportedArm(runtime, chain.suffix, root, mid, end, target, pole, 0.28)"));\n});\n`;
}
fs.writeFileSync(testPath, testSource);
console.log("Applied neutral arm reach clamp");

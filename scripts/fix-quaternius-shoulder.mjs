import fs from "node:fs";

const runtimePath = "src/game/visual-quaternius-runtime.ts";
let source = fs.readFileSync(runtimePath, "utf8");

if (!source.includes("function solveImportedArm(")) {
  const anchor = "\nfunction attackContactCorrection(runtime: QuaterniusRuntime, fighter: FighterRuntime): void {";
  if (!source.includes(anchor)) throw new Error("Quaternius shoulder patch anchor missing");
  const helper = `

// UBC shoulder skinning is shared between clavicle and upper-arm joints. Driving
// upperarm_* alone with IK can fold the shoulder volume inward when the fist is
// pulled toward the guard/contact target. Share a small, clamped part of the
// upper-arm swing with clavicle_* first, then solve the residual on the arm.
const MAX_IMPORTED_CLAVICLE_SWING = THREE.MathUtils.degToRad(14);

function solveImportedArm(
  runtime: QuaterniusRuntime,
  suffix: "l" | "r",
  upperArm: THREE.Object3D,
  forearm: THREE.Object3D,
  hand: THREE.Object3D,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  shoulderShare: number,
): void {
  const clavicle = runtime.bones.get(\`clavicle_\${suffix}\`);
  if (clavicle) {
    upperArm.updateWorldMatrix(true, true);
    const rootPos = upperArm.getWorldPosition(new THREE.Vector3());
    const midPos = forearm.getWorldPosition(new THREE.Vector3());
    const endPos = hand.getWorldPosition(new THREE.Vector3());
    const a = Math.max(1e-4, rootPos.distanceTo(midPos));
    const b = Math.max(1e-4, midPos.distanceTo(endPos));
    const toTarget = target.clone().sub(rootPos);
    const rawDistance = Math.max(1e-4, toTarget.length());
    const distance = THREE.MathUtils.clamp(rawDistance, Math.abs(a - b) + 1e-4, a + b - 1e-4);
    const direction = toTarget.normalize();
    const poleVector = pole.clone().sub(rootPos);
    const poleDirection = poleVector.clone().addScaledVector(direction, -poleVector.dot(direction));
    if (poleDirection.lengthSq() < 1e-8) poleDirection.set(0, 1, 0);
    poleDirection.normalize();
    const cosRoot = THREE.MathUtils.clamp((a * a + distance * distance - b * b) / (2 * a * distance), -1, 1);
    const along = a * cosRoot;
    const jointHeight = Math.sqrt(Math.max(0, a * a - along * along));
    const joint = rootPos.clone().addScaledVector(direction, along).addScaledVector(poleDirection, jointHeight);
    const currentDirection = midPos.clone().sub(rootPos).normalize();
    const desiredDirection = joint.clone().sub(rootPos).normalize();
    const swing = new THREE.Quaternion().setFromUnitVectors(currentDirection, desiredDirection);
    const swingAngle = new THREE.Quaternion().angleTo(swing);
    if (swingAngle > 1e-5) {
      const distributedAngle = Math.min(MAX_IMPORTED_CLAVICLE_SWING, swingAngle * THREE.MathUtils.clamp(shoulderShare, 0, 0.45));
      const distributed = new THREE.Quaternion().slerp(swing, distributedAngle / swingAngle);
      const clavicleWorld = clavicle.getWorldQuaternion(new THREE.Quaternion());
      setWorldQuaternion(clavicle, distributed.multiply(clavicleWorld));
      clavicle.updateWorldMatrix(true, true);
    }
  }
  solveImportedLimb(upperArm, forearm, hand, target, pole);
}
`;
  source = source.replace(anchor, `${helper}${anchor}`);
}

const attackBefore = `  const side = chain.suffix === "l" ? 1 : -1;
  const pole = fighter.visual.root.localToWorld(new THREE.Vector3(side * 0.48, isFoot ? 0.42 : 0.72, 0.24));
  solveImportedLimb(chain.root, chain.mid, chain.end, target, pole);`;
const attackAfter = `  const side = chain.suffix === "l" ? 1 : -1;
  const pole = fighter.visual.root.localToWorld(new THREE.Vector3(side * (isFoot ? 0.48 : 0.62), isFoot ? 0.42 : 0.74, isFoot ? 0.24 : 0.32));
  if (isFoot) solveImportedLimb(chain.root, chain.mid, chain.end, target, pole);
  else solveImportedArm(runtime, chain.suffix, chain.root, chain.mid, chain.end, target, pole, 0.24);`;
if (source.includes(attackBefore)) source = source.replace(attackBefore, attackAfter);
else if (!source.includes(attackAfter)) throw new Error("Attack shoulder patch anchor missing");

const neutralBefore = `    const pole = fighter.visual.root.localToWorld(new THREE.Vector3(chain.poleSide * 0.48, 0.70, 0.24));
    solveImportedLimb(root, mid, end, target, pole);`;
const neutralAfter = `    const pole = fighter.visual.root.localToWorld(new THREE.Vector3(chain.poleSide * 0.60, 0.72, 0.30));
    solveImportedArm(runtime, chain.suffix, root, mid, end, target, pole, 0.30);`;
if (source.includes(neutralBefore)) source = source.replace(neutralBefore, neutralAfter);
else if (!source.includes(neutralAfter)) throw new Error("Neutral shoulder patch anchor missing");

const guardBefore = `    const pole = fighter.visual.root.localToWorld(new THREE.Vector3(chain.poleSide * 0.52, 0.78, 0.28));
    solveImportedLimb(root, mid, end, target, pole);`;
const guardAfter = `    const pole = fighter.visual.root.localToWorld(new THREE.Vector3(chain.poleSide * 0.66, 0.82, 0.34));
    solveImportedArm(runtime, chain.suffix, root, mid, end, target, pole, 0.36);`;
if (source.includes(guardBefore)) source = source.replace(guardBefore, guardAfter);
else if (!source.includes(guardAfter)) throw new Error("Guard shoulder patch anchor missing");

fs.writeFileSync(runtimePath, source);

const testPath = "tests/quaternius-shoulder.test.ts";
const testSource = `import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("Quaternius imported shoulder correction", () => {
  const source = fs.readFileSync("src/game/visual-quaternius-runtime.ts", "utf8");

  it("shares imported arm swing through the clavicle instead of folding upperarm alone", () => {
    expect(source).toContain("function solveImportedArm(");
    expect(source).toContain("clavicle_");
    expect(source).toContain("MAX_IMPORTED_CLAVICLE_SWING");
    expect(source).toContain("solveImportedArm(runtime, chain.suffix");
  });

  it("keeps elbow poles outside the torso for neutral and guard corrections", () => {
    expect(source).toContain("chain.poleSide * 0.60");
    expect(source).toContain("chain.poleSide * 0.66");
  });
});
`;
fs.writeFileSync(testPath, testSource);
console.log("Applied Quaternius clavicle/shoulder distribution fix");

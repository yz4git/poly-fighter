import * as THREE from "three";
import { orientBoneForward, solveTwoBoneIK } from "./rig";
import type { FighterVisual, FootSide } from "./visual";

type V11Pose = "IDLE" | "GUARD" | "PUNCH" | "KICK";
function rootPoint(visual: FighterVisual, point: THREE.Vector3): THREE.Vector3 { visual.root.updateMatrixWorld(true); return visual.root.localToWorld(point.clone()); }
function endpointInRoot(visual: FighterVisual, object: THREE.Object3D): THREE.Vector3 { return visual.root.worldToLocal(object.getWorldPosition(new THREE.Vector3())); }
function classifyPose(visual: FighterVisual): V11Pose { const lf = endpointInRoot(visual, visual.leftArm.end); const rf = endpointInRoot(visual, visual.rightArm.end); const lfoot = endpointInRoot(visual, visual.leftLeg.end); const rfoot = endpointInRoot(visual, visual.rightLeg.end); if (Math.max(lfoot.y, rfoot.y) > 0.29) return "KICK"; if (Math.max(lf.z, rf.z) > 0.255) return "PUNCH"; if (lf.y > 0.72 && rf.y > 0.72) return "GUARD"; return "IDLE"; }
function solveArm(visual: FighterVisual, side: -1 | 1, targetLocal: THREE.Vector3, poleLocal: THREE.Vector3): void { const prefix = side < 0 ? "left" : "right"; const scale = visual.root.scale.x; const origin = rootPoint(visual, new THREE.Vector3()); const up = rootPoint(visual, new THREE.Vector3(0, 1, 0)).sub(origin).normalize(); const forward = rootPoint(visual, new THREE.Vector3(0, 0, 1)).sub(origin).normalize(); const target = rootPoint(visual, targetLocal).addScaledVector(up, visual.layout.handLength * 0.48 * scale).addScaledVector(forward, -0.030 * scale); solveTwoBoneIK({ root: visual.rig.bones[`${prefix}UpperArm`], mid: visual.rig.bones[`${prefix}Forearm`], end: visual.rig.bones[`${prefix}Hand`], target, pole: rootPoint(visual, poleLocal) }); orientBoneForward(visual.rig.bones[`${prefix}Hand`], forward); }
function solveSole(visual: FighterVisual, side: FootSide, targetLocal: THREE.Vector3): void { const prefix = side === "left" ? "left" : "right"; const sign = side === "left" ? -1 : 1; const scale = visual.root.scale.x; const origin = rootPoint(visual, new THREE.Vector3()); const up = rootPoint(visual, new THREE.Vector3(0, 1, 0)).sub(origin).normalize(); const forward = rootPoint(visual, new THREE.Vector3(0, 0, 1)).sub(origin).normalize(); const soleLocal = visual.footContacts[side].soleLocal; const soleTarget = rootPoint(visual, targetLocal); soleTarget.y = 0; const target = soleTarget.clone().addScaledVector(up, -soleLocal.y * scale).addScaledVector(forward, -soleLocal.z * scale); solveTwoBoneIK({ root: visual.rig.bones[`${prefix}Thigh`], mid: visual.rig.bones[`${prefix}Shin`], end: visual.rig.bones[`${prefix}Foot`], target, pole: rootPoint(visual, new THREE.Vector3(sign * 0.20, 0.36, sign * 0.12)) }); orientBoneForward(visual.rig.bones[`${prefix}Foot`], forward); }
function stanceFeet(visual: FighterVisual, depthScale = 1): void { const y = visual.layout.ankleY - 0.058; const width = visual.layout.pelvisWidth * 0.48; solveSole(visual, "left", new THREE.Vector3(-width, y, -0.135 * depthScale)); solveSole(visual, "right", new THREE.Vector3(width, y, 0.165 * depthScale)); }
function idlePose(visual: FighterVisual): void { const b = visual.rig.bones; visual.hips.position.y -= 0.026; b.spineLower.rotation.y += 0.085; b.spineUpper.rotation.y -= 0.125; b.chest.rotation.y += 0.090; b.head.rotation.y -= 0.045; solveArm(visual, -1, new THREE.Vector3(-0.100, 0.745, 0.145), new THREE.Vector3(-0.160, 0.665, 0.055)); solveArm(visual, 1, new THREE.Vector3(0.100, 0.725, 0.155), new THREE.Vector3(0.160, 0.650, 0.065)); stanceFeet(visual, 1); }
function guardPose(visual: FighterVisual): void { const b = visual.rig.bones; visual.hips.position.y -= 0.030; b.spineLower.rotation.y += 0.060; b.spineUpper.rotation.y -= 0.085; b.chest.rotation.y += 0.055; solveArm(visual, -1, new THREE.Vector3(-0.075, 0.815, 0.155), new THREE.Vector3(-0.165, 0.690, 0.065)); solveArm(visual, 1, new THREE.Vector3(0.080, 0.795, 0.170), new THREE.Vector3(0.170, 0.665, 0.085)); stanceFeet(visual, 0.94); }
function punchPose(visual: FighterVisual): void { const lf = endpointInRoot(visual, visual.leftArm.end); const rf = endpointInRoot(visual, visual.rightArm.end); const punchSide: -1 | 1 = lf.z > rf.z ? -1 : 1; const supportSide = (punchSide * -1) as -1 | 1; const b = visual.rig.bones; b.spineLower.rotation.y += punchSide * -0.045; b.spineUpper.rotation.y += punchSide * 0.070; b.chest.rotation.y += punchSide * 0.050; solveArm(visual, supportSide, new THREE.Vector3(supportSide * 0.100, 0.745, 0.145), new THREE.Vector3(supportSide * 0.170, 0.665, 0.060)); stanceFeet(visual, 0.86); }
function kickPose(visual: FighterVisual): void { const leftFoot = endpointInRoot(visual, visual.leftLeg.end); const rightFoot = endpointInRoot(visual, visual.rightLeg.end); const kickSide: -1 | 1 = leftFoot.y > rightFoot.y ? -1 : 1; const b = visual.rig.bones; b.spineLower.rotation.x -= 0.060; b.spineUpper.rotation.x -= 0.040; b.chest.rotation.y += kickSide * -0.065; solveArm(visual, -1, new THREE.Vector3(-0.100, 0.735, 0.145), new THREE.Vector3(-0.170, 0.660, 0.060)); solveArm(visual, 1, new THREE.Vector3(0.100, 0.715, 0.155), new THREE.Vector3(0.170, 0.640, 0.065)); }
function applyPose(visual: FighterVisual): void { visual.root.updateMatrixWorld(true); const pose = classifyPose(visual); if (pose === "IDLE") idlePose(visual); else if (pose === "GUARD") guardPose(visual); else if (pose === "PUNCH") punchPose(visual); else kickPose(visual); visual.root.userData.v11ReferencePose = pose; visual.root.updateMatrixWorld(true); }

export function applyV11ReferencePose(visual: FighterVisual): FighterVisual {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0.0001, 0, 0, 0, 0.0001, 0], 3));
  const material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false });
  const anchor = new THREE.Mesh(geometry, material);
  const tracked = [visual.hips, ...Object.values(visual.rig.bones)];
  const lastAppliedPoseState = new Float64Array(tracked.length * 7);
  let hasLastAppliedPoseState = false;

  const poseMatchesLastAppliedState = (): boolean => {
    if (!hasLastAppliedPoseState) return false;
    let offset = 0;
    for (const object of tracked) {
      if (
        object.position.x !== lastAppliedPoseState[offset]
        || object.position.y !== lastAppliedPoseState[offset + 1]
        || object.position.z !== lastAppliedPoseState[offset + 2]
        || object.quaternion.x !== lastAppliedPoseState[offset + 3]
        || object.quaternion.y !== lastAppliedPoseState[offset + 4]
        || object.quaternion.z !== lastAppliedPoseState[offset + 5]
        || object.quaternion.w !== lastAppliedPoseState[offset + 6]
      ) return false;
      offset += 7;
    }
    return true;
  };

  const captureAppliedPoseState = (): void => {
    let offset = 0;
    for (const object of tracked) {
      lastAppliedPoseState[offset] = object.position.x;
      lastAppliedPoseState[offset + 1] = object.position.y;
      lastAppliedPoseState[offset + 2] = object.position.z;
      lastAppliedPoseState[offset + 3] = object.quaternion.x;
      lastAppliedPoseState[offset + 4] = object.quaternion.y;
      lastAppliedPoseState[offset + 5] = object.quaternion.z;
      lastAppliedPoseState[offset + 6] = object.quaternion.w;
      offset += 7;
    }
    hasLastAppliedPoseState = true;
  };

  anchor.name = "v11-reference-pose-anchor";
  anchor.frustumCulled = false;
  anchor.renderOrder = -10000;
  anchor.onBeforeRender = () => {
    if (poseMatchesLastAppliedState()) return;
    applyPose(visual);
    captureAppliedPoseState();
  };
  visual.root.add(anchor);
  visual.root.userData.v11PoseController = "V16_COMPACT_CHIN_GUARD";
  visual.root.userData.v11PoseStabilityGuard = "SKIP_UNCHANGED_BONE_STATE_V1";
  return visual;
}

import * as THREE from "three";
import { FighterAnimationController, type FighterRuntime } from "./fighter";
import { fighterBasis, orientBoneForward, solveTwoBoneIK } from "./rig";

const KAIRO_READY_STATES = new Set(["IDLE", "WALK", "CROUCH", "SIDESTEP"]);

/**
 * Presentation-only animation layer applied after the deterministic gameplay
 * animation.  KAIRO V1 was reconstructed from scratch with a neutral authored
 * bind pose; without this pass his non-attacking frames read as a mannequin
 * beside SERA's compact fighting stance.  The gameplay state, hitboxes and
 * movement remain untouched: this only poses the existing canonical rig.
 */
export class PresentationAnimationController extends FighterAnimationController {
  override update(fighter: FighterRuntime, opponent: FighterRuntime, timeSeconds: number): void {
    super.update(fighter, opponent, timeSeconds);
    if (fighter.visual.root.userData.visualVersion !== "KAIRO_V1") return;
    if (!KAIRO_READY_STATES.has(fighter.state)) return;

    const visual = fighter.visual;
    const layout = visual.layout;
    const scale = visual.root.scale.x;
    const basis = fighterBasis(fighter.facing, opponent.position.clone().sub(fighter.position));
    const crouchDrop = fighter.state === "CROUCH" ? 0.055 : 0;
    const walkPulse = fighter.state === "WALK" ? Math.sin(timeSeconds * 9) * 0.012 : 0;

    // A compact asymmetrical guard: lead fist near the cheek, rear fist near
    // the sternum.  The two-bone solver preserves authored limb lengths and
    // produces a much stronger fighting silhouette than rotating whole arms.
    const leftTarget = visual.root.localToWorld(new THREE.Vector3(
      -0.105,
      layout.shoulderY - 0.035 - crouchDrop + walkPulse,
      layout.chestDepth * 1.52,
    ));
    const rightTarget = visual.root.localToWorld(new THREE.Vector3(
      0.095,
      layout.shoulderY + 0.025 - crouchDrop - walkPulse,
      layout.chestDepth * 1.68,
    ));

    const solveGuardArm = (side: -1 | 1, target: THREE.Vector3): void => {
      const prefix = side < 0 ? "left" : "right";
      const shoulder = visual.rig.bones[`${prefix}Shoulder`].getWorldPosition(new THREE.Vector3());
      const pole = shoulder.clone()
        .addScaledVector(basis.side, side * scale * 0.28)
        .addScaledVector(basis.forward, scale * 0.13)
        .addScaledVector(basis.up, -scale * 0.05);
      solveTwoBoneIK({
        root: visual.rig.bones[`${prefix}UpperArm`],
        mid: visual.rig.bones[`${prefix}Forearm`],
        end: visual.rig.bones[`${prefix}Hand`],
        target,
        pole,
      });
      orientBoneForward(visual.rig.bones[`${prefix}Hand`], basis.forward);
    };

    // Slight body compression keeps the tall power fighter from reading as a
    // rigid vertical column while retaining his heavier silhouette.
    visual.rig.bones.spineLower.rotation.y += 0.045;
    visual.rig.bones.spineUpper.rotation.y -= 0.075;
    visual.rig.bones.chest.rotation.x -= 0.035;
    visual.head.rotation.y += 0.025;
    solveGuardArm(-1, leftTarget);
    solveGuardArm(1, rightTarget);
    visual.root.updateMatrixWorld(true);
  }
}

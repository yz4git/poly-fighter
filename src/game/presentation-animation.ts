import * as THREE from "three";
import { FighterAnimationController, type FighterRuntime } from "./fighter";
import { updateMotionExpansionSkin } from "./motion-expansion-runtime";
import { motionCorrectionsEnabled } from "./motion-correction-state";
import { fighterBasis, orientBoneForward, solveTwoBoneIK } from "./rig";
import { updateQuaterniusModelSkin } from "./visual-quaternius-runtime";

const KAIRO_READY_STATES = new Set(["IDLE", "WALK", "CROUCH", "SIDESTEP"]);

/**
 * Presentation-only animation layer applied after the deterministic gameplay
 * animation. The canonical gameplay rig always runs first; optional visual
 * skins then mirror the resulting state without owning gameplay simulation.
 */
export class PresentationAnimationController extends FighterAnimationController {
  override update(fighter: FighterRuntime, opponent: FighterRuntime, timeSeconds: number): void {
    super.update(fighter, opponent, timeSeconds);
    const correctionsEnabled = motionCorrectionsEnabled();

    if (correctionsEnabled && fighter.visual.root.userData.visualVersion === "KAIRO_V1" && KAIRO_READY_STATES.has(fighter.state)) {
      const visual = fighter.visual;
      const layout = visual.layout;
      const scale = visual.root.scale.x;
      const basis = fighterBasis(fighter.facing, opponent.position.clone().sub(fighter.position));
      const crouchDrop = fighter.state === "CROUCH" ? 0.055 : 0;
      const walkPulse = fighter.state === "WALK" ? Math.sin(timeSeconds * 9) * 0.012 : 0;

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

      visual.rig.bones.spineLower.rotation.y += 0.045;
      visual.rig.bones.spineUpper.rotation.y -= 0.075;
      visual.rig.bones.chest.rotation.x -= 0.035;
      visual.head.rotation.y += 0.025;
      solveGuardArm(-1, leftTarget);
      solveGuardArm(1, rightTarget);
      visual.root.updateMatrixWorld(true);
    }

    // Motion Readability v2 owns attacks, hit reactions, launches, falls,
    // downs, wakeups and evasive movement. It also receives the opponent so
    // strike IK can bias toward a real head/body/leg target instead of copying
    // the older procedural rig's own fist/foot pose.
    if (correctionsEnabled) {
      if (!updateMotionExpansionSkin(fighter, opponent, timeSeconds)) {
        updateQuaterniusModelSkin(fighter, timeSeconds);
      }
    } else {
      // Raw-motion diagnostic mode: keep authored clip selection/playback, but
      // bypass every post-playback IK, pose, COM, foot-lock and contact correction.
      updateQuaterniusModelSkin(fighter, timeSeconds);
    }
    fighter.visual.root.userData.motionCorrectionsEnabled = correctionsEnabled;
  }
}

import * as THREE from "three";
import { FighterAnimationController, type FighterRuntime } from "./fighter";
import { motionCorrectionsEnabled } from "./motion-correction-state";
import { fighterBasis, fighterRootQuaternion, orientBoneForward, solveTwoBoneIK } from "./rig";
import { finalizeQuaterniusModelPose, updateQuaterniusModelSkin } from "./visual-quaternius-runtime";

const KAIRO_READY_STATES = new Set(["IDLE", "WALK", "CROUCH", "SIDESTEP"]);

// These moves already come from Blender Motion Foundry packs with authored COG,
// torso, pole-vector and support-foot work. Running the older procedural
// full-body correction stack over them was visibly re-solving a second motion on
// top of the authored one: body blows folded at the waist, backfists corkscrewed
// the torso and kicks lost their clean silhouette. Correction ON therefore keeps
// these clips authoritative and reserves Motion Expansion for procedural-only
// moves, reactions, falls and evasive states.
const BLENDER_AUTHORED_ATTACKS = new Set([
  "jab",
  "straight",
  "bodyBlow",
  "backfist",
  "power",
  "kick",
  "lowKick",
  "risingKick",
  "dashKick",
  "counter",
  "throw",
]);

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

    const authoredAttack = fighter.state === "ATTACK"
      && Boolean(fighter.currentMove)
      && BLENDER_AUTHORED_ATTACKS.has(fighter.currentMove?.id ?? "");

    if (fighter.visual.root.userData.quaterniusModelState === "ready") {
      // The imported down clip owns the fall. Do not rotate it a second time
      // using the legacy proxy skeleton's root tilt.
      fighter.visual.root.quaternion.copy(fighterRootQuaternion(fighter.facing));
      fighter.visual.root.updateMatrixWorld(true);
    }
    updateQuaterniusModelSkin(fighter, timeSeconds);
    if (!fighter.visual.root.userData.combatTps) finalizeQuaterniusModelPose(fighter, timeSeconds);
    fighter.visual.root.userData.motionCorrectionsEnabled = correctionsEnabled;
    fighter.visual.root.userData.motionCorrectionPolicy = correctionsEnabled
      ? authoredAttack
        ? "AUTHORED_ATTACK_PRESERVE"
        : "AUTHORED_COMBAT_PRESERVE"
      : "RAW_CLIP_PLAYBACK";
  }
}

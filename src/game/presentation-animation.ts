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

const TPS_HIT_SEPARATION = {
  LIGHT: 0.075,
  MID: 0.105,
  HEAVY: 0.145,
  COUNTER: 0.17,
} as const;

const TPS_HIT_RECOIL = {
  LIGHT: 0.055,
  MID: 0.085,
  HEAVY: 0.125,
  COUNTER: 0.15,
} as const;

function applyTpsImpactReadability(fighter: FighterRuntime, opponent: FighterRuntime): void {
  const root = fighter.visual.root;
  if (!root.userData.combatTps) return;

  const blocked = fighter.state === "BLOCK_STUN";
  const hit = fighter.state === "HIT";
  if (!hit && !blocked) {
    root.userData.tpsImpactReadability = 0;
    root.userData.tpsImpactSeparation = 0;
    root.userData.tpsImpactRecoil = 0;
    return;
  }

  // Hitstop owns the contact frame. Afterwards, ease the visual accent out over
  // the remaining stun so the defender does not snap back into the attacker.
  // This never changes FighterRuntime.position, velocity, hitboxes or spacing.
  const stunTicks = blocked ? fighter.blockStun : fighter.hitStun;
  const release = fighter.hitStop > 0
    ? 1
    : THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(stunTicks / 12, 0, 1), 0, 1);
  const kind = fighter.reactionKind;
  const separation = blocked ? 0.045 * release : TPS_HIT_SEPARATION[kind] * release;
  const recoil = blocked ? 0.035 * release : TPS_HIT_RECOIL[kind] * release;

  const away = fighter.position.clone().sub(opponent.position);
  away.y = 0;
  if (away.lengthSq() <= 1e-6) away.set(-fighter.facing, 0, 0);
  else away.normalize();
  root.position.addScaledVector(away, separation);

  const side = fighter.reactionSide === "LEFT" ? -1 : 1;
  const bones = fighter.visual.rig.bones;
  bones.spineLower.rotation.x += recoil * 0.42;
  bones.spineUpper.rotation.x += recoil * 0.72;
  bones.chest.rotation.x += recoil;
  bones.spineUpper.rotation.y += side * recoil * 0.42;
  bones.chest.rotation.z += side * recoil * 0.24;
  fighter.visual.head.rotation.x += recoil * 0.3;

  root.userData.tpsImpactReadability = release;
  root.userData.tpsImpactSeparation = separation;
  root.userData.tpsImpactRecoil = recoil;
  root.userData.tpsImpactReactionSerial = fighter.reactionSerial;
  root.updateMatrixWorld(true);
}

function applyTpsDashKickSilhouette(fighter: FighterRuntime, opponent: FighterRuntime): void {
  const visual = fighter.visual;
  const root = visual.root;
  const move = fighter.currentMove;
  if (!root.userData.combatTps || fighter.state !== "ATTACK" || move?.id !== "dashKick") {
    root.userData.tpsDashKickSilhouette = 0;
    root.userData.tpsDashKickLegExtension = 0;
    root.userData.tpsDashKickBodySeparation = 0;
    return;
  }

  // Preserve the Blender-authored jump and ankle pose, but make the striking
  // leg read as one long line from the close shoulder camera. The accent ramps
  // in just before active frames and releases early in recovery. This is a
  // presentation-only IK pass: gameplay position, reach and hitboxes stay put.
  const activeStart = move.startup;
  const activeEnd = move.startup + move.active;
  const extendIn = THREE.MathUtils.smoothstep(fighter.moveTick, Math.max(0, activeStart - 4), activeStart + 1);
  const extendOut = 1 - THREE.MathUtils.smoothstep(fighter.moveTick, activeEnd, activeEnd + 7);
  const accent = THREE.MathUtils.clamp(extendIn * extendOut, 0, 1);
  if (accent <= 1e-4) {
    root.userData.tpsDashKickSilhouette = 0;
    root.userData.tpsDashKickLegExtension = 0;
    root.userData.tpsDashKickBodySeparation = 0;
    return;
  }

  const scale = root.scale.x;
  const away = fighter.position.clone().sub(opponent.position);
  away.y = 0;
  if (away.lengthSq() <= 1e-6) away.set(-fighter.facing, 0, 0);
  else away.normalize();
  const bodySeparation = 0.075 * scale * accent;
  root.position.addScaledVector(away, bodySeparation);
  root.updateMatrixWorld(true);

  const bones = visual.rig.bones;
  const hip = bones.rightThigh.getWorldPosition(new THREE.Vector3());
  const knee = bones.rightShin.getWorldPosition(new THREE.Vector3());
  const foot = bones.rightFoot;
  const footPosition = foot.getWorldPosition(new THREE.Vector3());
  const legLine = footPosition.clone().sub(hip);
  let extension = 0;

  if (legLine.lengthSq() > 1e-6) {
    const basis = fighterBasis(fighter.facing, opponent.position.clone().sub(fighter.position));
    extension = 0.17 * scale * accent;
    const target = footPosition.clone().addScaledVector(legLine.normalize(), extension);
    const pole = knee.clone()
      .addScaledVector(basis.side, 0.065 * scale * accent)
      .addScaledVector(basis.up, 0.015 * scale * accent);
    const footWorld = foot.getWorldQuaternion(new THREE.Quaternion());

    solveTwoBoneIK({
      root: bones.rightThigh,
      mid: bones.rightShin,
      end: foot,
      target,
      pole,
    });

    // IK changes the parents of the boot, so restore the authored world-space
    // ankle orientation afterwards instead of introducing another foot twist.
    root.updateMatrixWorld(true);
    const parent = foot.parent;
    if (parent) {
      const parentWorld = parent.getWorldQuaternion(new THREE.Quaternion());
      foot.quaternion.copy(parentWorld.invert().multiply(footWorld)).normalize();
    }
  }

  // Small counter-rotation separates chest and hip without re-authoring the
  // mocap. It prevents the airborne pose from collapsing into one torso/leg blob.
  bones.spineLower.rotation.y -= 0.035 * accent;
  bones.spineUpper.rotation.y += 0.065 * accent;
  bones.chest.rotation.x -= 0.025 * accent;

  root.userData.tpsDashKickSilhouette = accent;
  root.userData.tpsDashKickLegExtension = extension;
  root.userData.tpsDashKickBodySeparation = bodySeparation;
  root.updateMatrixWorld(true);
}

function applyTpsThrowPairReadability(fighter: FighterRuntime, opponent: FighterRuntime): void {
  const visual = fighter.visual;
  const root = visual.root;
  if (!root.userData.combatTps) return;

  const move = fighter.currentMove;
  const attackingThrow = fighter.state === "ATTACK" && move?.id === "throw";
  const beingThrown = fighter.state === "THROW";
  if (!attackingThrow && !beingThrown) {
    root.userData.tpsThrowGrab = 0;
    root.userData.tpsThrowRelease = 0;
    root.userData.tpsThrowBodySeparation = 0;
    return;
  }

  const basis = fighterBasis(fighter.facing, opponent.position.clone().sub(fighter.position));
  const scale = root.scale.x;
  const bones = visual.rig.bones;

  if (attackingThrow && move) {
    const activeStart = move.startup;
    const activeEnd = move.startup + move.active;
    const grabIn = THREE.MathUtils.smoothstep(fighter.moveTick, Math.max(0, activeStart - 3), activeStart + 1);
    const grabOut = 1 - THREE.MathUtils.smoothstep(fighter.moveTick, activeEnd + 1, activeEnd + 9);
    const grab = THREE.MathUtils.clamp(grabIn * grabOut, 0, 1);
    const releaseIn = THREE.MathUtils.smoothstep(fighter.moveTick, activeEnd - 1, activeEnd + 5);
    const releaseOut = 1 - THREE.MathUtils.smoothstep(fighter.moveTick, activeEnd + 7, activeEnd + 16);
    const release = THREE.MathUtils.clamp(releaseIn * releaseOut, 0, 1);

    // Keep a small visible lane between the torsos and bridge it with the arms.
    // This turns the old overlap/hug silhouette into an explicit two-hand grip.
    const away = fighter.position.clone().sub(opponent.position);
    away.y = 0;
    if (away.lengthSq() <= 1e-6) away.set(-fighter.facing, 0, 0);
    else away.normalize();
    const bodySeparation = 0.045 * scale * grab;
    root.position.addScaledVector(away, bodySeparation);
    root.updateMatrixWorld(true);

    if (grab > 1e-4) {
      opponent.visual.root.updateMatrixWorld(true);
      const opponentLayout = opponent.visual.layout;
      const opponentScale = opponent.visual.root.scale.x;
      const shoulderX = opponentLayout.shoulderWidth * 0.34;
      const targetY = opponentLayout.shoulderY - 0.065;
      const targetZ = opponentLayout.chestDepth * 0.58;
      const leftTarget = opponent.visual.root.localToWorld(new THREE.Vector3(-shoulderX, targetY, targetZ));
      const rightTarget = opponent.visual.root.localToWorld(new THREE.Vector3(shoulderX, targetY - 0.035, targetZ * 1.08));

      const solveGripArm = (side: -1 | 1, target: THREE.Vector3): void => {
        const prefix = side < 0 ? "left" : "right";
        const shoulder = bones[`${prefix}Shoulder`].getWorldPosition(new THREE.Vector3());
        const hand = bones[`${prefix}Hand`];
        const handWorld = hand.getWorldQuaternion(new THREE.Quaternion());
        const pole = shoulder.clone()
          .addScaledVector(basis.side, side * 0.20 * scale)
          .addScaledVector(basis.forward, 0.12 * scale)
          .addScaledVector(basis.up, -0.025 * scale);
        solveTwoBoneIK({
          root: bones[`${prefix}UpperArm`],
          mid: bones[`${prefix}Forearm`],
          end: hand,
          target,
          pole,
        });
        root.updateMatrixWorld(true);
        const parent = hand.parent;
        if (parent) {
          const parentWorld = parent.getWorldQuaternion(new THREE.Quaternion());
          hand.quaternion.copy(parentWorld.invert().multiply(handWorld)).normalize();
        }
      };

      solveGripArm(-1, leftTarget);
      solveGripArm(1, rightTarget);
    }

    // A compact opposing chest/hip turn sells leverage during the release while
    // retaining the authored Blender throw as the base motion.
    bones.spineLower.rotation.y -= 0.045 * grab + 0.075 * release;
    bones.spineUpper.rotation.y += 0.075 * grab + 0.13 * release;
    bones.chest.rotation.x -= 0.035 * grab;
    bones.chest.rotation.z += fighter.facing * 0.055 * release;

    root.userData.tpsThrowGrab = grab;
    root.userData.tpsThrowRelease = release;
    root.userData.tpsThrowBodySeparation = bodySeparation;
    root.updateMatrixWorld(true);
    return;
  }

  // On the defender, emphasize only the first upward release. Physics still owns
  // the actual launch; this short visual break makes the shoulders/chest clearly
  // read as being displaced by the throw instead of instantly returning to guard.
  const launch = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(fighter.velocity.y / 3.2, 0, 1), 0, 1);
  const away = fighter.position.clone().sub(opponent.position);
  away.y = 0;
  if (away.lengthSq() <= 1e-6) away.set(-fighter.facing, 0, 0);
  else away.normalize();
  const bodySeparation = 0.06 * scale * launch;
  root.position.addScaledVector(away, bodySeparation);
  bones.spineLower.rotation.x += 0.08 * launch;
  bones.spineUpper.rotation.x += 0.15 * launch;
  bones.chest.rotation.x += 0.19 * launch;
  bones.chest.rotation.z += fighter.facing * 0.08 * launch;
  bones.leftShoulder.rotation.z += 0.14 * launch;
  bones.rightShoulder.rotation.z -= 0.14 * launch;
  visual.head.rotation.x += 0.055 * launch;

  root.userData.tpsThrowGrab = 0;
  root.userData.tpsThrowRelease = launch;
  root.userData.tpsThrowBodySeparation = bodySeparation;
  root.updateMatrixWorld(true);
}

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

    // CPU telegraphs are gameplay commitments, so make them readable on the body
    // as well as the lock ring. This pose is deliberately small enough to preserve
    // authored silhouettes but large enough to read from the iPhone shoulder camera.
    const telegraphProgress = Number(fighter.visual.root.userData.tpsEnemyTelegraphProgress ?? 0);
    const telegraphMove = String(fighter.visual.root.userData.tpsEnemyTelegraphMove ?? "");
    if (fighter.visual.root.userData.combatTps && telegraphProgress > 0 && telegraphMove) {
      const load = THREE.MathUtils.smoothstep(telegraphProgress, 0, 1);
      const kickLike = ["kick", "lowKick", "risingKick", "dashKick"].includes(telegraphMove);
      const heavy = ["power", "risingKick", "dashKick", "throw", "counter"].includes(telegraphMove);
      const twist = (kickLike ? -0.10 : 0.14) * load * (heavy ? 1.25 : 1);
      fighter.visual.rig.bones.spineLower.rotation.y += twist * 0.55;
      fighter.visual.rig.bones.spineUpper.rotation.y += twist;
      fighter.visual.rig.bones.chest.rotation.x += (kickLike ? 0.055 : -0.035) * load;
      fighter.visual.rig.bones.leftShoulder.rotation.z += 0.055 * load;
      fighter.visual.rig.bones.rightShoulder.rotation.z -= 0.075 * load;
      fighter.visual.root.userData.tpsEnemyTelegraphPoseApplied = load;
      fighter.visual.root.updateMatrixWorld(true);
    }

    // Keep the gameplay contact point untouched while giving the hit frame a
    // readable silhouette from the close TPS camera. The defender's rendered
    // root moves a few centimetres away and the torso recoils; the simulation
    // position remains exactly where combat resolution placed it.
    applyTpsImpactReadability(fighter, opponent);
    applyTpsDashKickSilhouette(fighter, opponent);
    applyTpsThrowPairReadability(fighter, opponent);

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

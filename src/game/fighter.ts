import * as THREE from "three";
import { CommandParser, InputBuffer } from "./input";
import {
  createFighterVisual,
  getSoleContactPoint,
  getVisualContactPoint,
  getWalkFootTarget,
  releaseFootPlants,
  updateFootPlants,
  visualGroundOffset,
  type FighterVisual,
  type FootPlantMode,
} from "./visual";
import { attackHitboxCenter, fighterBasis, fighterRootQuaternion, orientBoneForward, solveTwoBoneIK } from "./rig";
import type {
  FighterDefinition,
  FighterState,
  InputFrame,
  MoveDefinition,
} from "./types";
import { EMPTY_INPUT, cloneInput } from "./types";

export const FIGHTER_GROUND_Y = 0;
export const FIGHTER_GRAVITY = 18;
export const FIGHTER_MAX_HEIGHT = 12;
export const FIGHTER_MAX_VERTICAL_SPEED = 32;
const GROUND_EPSILON = 0.0001;

export class FighterStateMachine {
  state: FighterState = "IDLE";
  stateTicks = 0;

  transition(next: FighterState): void {
    this.state = next;
    this.stateTicks = 0;
  }

  tick(): void {
    this.stateTicks += 1;
  }
}

export class FighterRuntime {
  readonly id: string;
  readonly definition: FighterDefinition;
  readonly isCpu: boolean;
  readonly visual: FighterVisual;
  readonly stateMachine = new FighterStateMachine();
  readonly inputBuffer = new InputBuffer();
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  previousInput: InputFrame = cloneInput(EMPTY_INPUT);
  input: InputFrame = cloneInput(EMPTY_INPUT);
  facing = 1;
  health = 100;
  guardDamage = 0;
  wins = 0;
  hitStop = 0;
  hitStun = 0;
  blockStun = 0;
  knockdownTicks = 0;
  currentMove: MoveDefinition | null = null;
  moveTick = 0;
  readonly hitTargets = new Set<string>();
  readonly visualScale: number;
  grounded = true;
  invariantError: string | null = null;

  constructor(
    id: string,
    definition: FighterDefinition,
    isCpu = false,
    visual = createFighterVisual(definition),
  ) {
    this.id = id;
    this.definition = definition;
    this.isCpu = isCpu;
    this.visual = visual;
    this.visualScale = visual.root.scale.x;
  }

  get state(): FighterState {
    return this.stateMachine.state;
  }

  set state(next: FighterState) {
    this.stateMachine.transition(next);
  }

  setInput(next: InputFrame): void {
    this.previousInput = this.input;
    this.input = cloneInput(next);
    this.inputBuffer.push(this.input);
  }

  justPressed(action: keyof InputFrame): boolean {
    return this.input[action] && !this.previousInput[action];
  }

  canAct(): boolean {
    return ["IDLE", "WALK", "CROUCH", "GUARD", "JUMP", "SIDESTEP"].includes(
      this.state,
    );
  }

  get airborne(): boolean {
    return !this.grounded;
  }

  startJump(initialVelocity = 6.4): boolean {
    if (!this.grounded || !this.canAct()) return false;
    this.grounded = false;
    this.velocity.y = initialVelocity;
    this.state = "JUMP";
    return true;
  }

  beginMove(moveId: string): boolean {
    if (!this.canAct()) return false;
    const move = this.definition.moves[moveId];
    if (!move) return false;
    this.currentMove = move;
    this.moveTick = 0;
    this.hitTargets.clear();
    this.velocity.x *= 0.2;
    this.state = "ATTACK";
    return true;
  }

  isActive(): boolean {
    if (!this.currentMove) return false;
    return (
      this.moveTick >= this.currentMove.startup &&
      this.moveTick < this.currentMove.startup + this.currentMove.active
    );
  }

  advanceAttack(): void {
    if (!this.currentMove) return;
    if (this.hitStop > 0) return;
    this.moveTick += 1;
    const total =
      this.currentMove.startup +
      this.currentMove.active +
      this.currentMove.recovery;
    if (this.moveTick >= total) {
      this.currentMove = null;
      this.moveTick = 0;
      if (this.state === "ATTACK") this.state = this.grounded ? "IDLE" : "JUMP";
    }
  }

  updatePhysics(deltaSeconds: number): void {
    this.assertInvariants();
    if (this.hitStop > 0) {
      this.hitStop -= 1;
      return;
    }

    // Vertical physics is independent from the action state. A fighter can be
    // ATTACK, HIT, THROW, KO, or RING_OUT while still following the same
    // airborne trajectory.
    const wasAirborne = !this.grounded;
    if (!this.grounded || this.position.y > FIGHTER_GROUND_Y + GROUND_EPSILON || this.velocity.y > 0) {
      this.grounded = false;
      this.velocity.y -= FIGHTER_GRAVITY * deltaSeconds;
    }
    this.position.addScaledVector(this.velocity, deltaSeconds);
    this.velocity.x *= 0.82;
    this.velocity.z *= 0.78;

    if (this.position.y <= FIGHTER_GROUND_Y) {
      this.position.y = FIGHTER_GROUND_Y;
      this.velocity.y = 0;
      this.grounded = true;
      if (wasAirborne && this.state === "JUMP") this.state = "IDLE";
    } else {
      this.grounded = false;
    }

    if (this.hitStun > 0) {
      this.hitStun -= 1;
      if (this.hitStun <= 0 && this.state === "HIT") this.state = this.grounded ? "IDLE" : "JUMP";
    }
    if (this.blockStun > 0) {
      this.blockStun -= 1;
      if (this.blockStun <= 0 && this.state === "BLOCK_STUN") this.state = this.grounded ? "IDLE" : "JUMP";
    }
    if (this.knockdownTicks > 0) {
      this.knockdownTicks -= 1;
    }
    if (this.grounded && this.knockdownTicks <= 0 && (this.state === "KNOCKDOWN" || this.state === "THROW")) {
      this.state = "WAKEUP";
    } else if (this.state === "WAKEUP" && this.stateMachine.stateTicks > 22) {
      this.state = "IDLE";
    }
    this.stateMachine.tick();
    this.assertInvariants();
  }

  receiveDamage(
    damage: number,
    stun: number,
    knockback: number,
    attackerFacing: number,
    knockdown: boolean,
    hitStop: number,
  ): void {
    this.health = Math.max(0, this.health - damage);
    this.hitStop = Math.max(this.hitStop, hitStop);
    this.velocity.x = attackerFacing * knockback * 20;
    if (knockdown || this.health <= 0) {
      this.state = this.health <= 0 ? "KO" : "KNOCKDOWN";
      this.knockdownTicks = 72;
      this.velocity.y = this.health <= 0 ? 1.6 : 4.1;
      this.grounded = false;
      this.currentMove = null;
      this.moveTick = 0;
    } else {
      this.state = "HIT";
      this.hitStun = stun;
      this.currentMove = null;
      this.moveTick = 0;
    }
  }

  receiveBlock(guardDamage: number, stun: number, hitStop: number): void {
    this.guardDamage = Math.min(100, this.guardDamage + guardDamage);
    this.blockStun = stun;
    this.hitStop = Math.max(this.hitStop, hitStop);
    this.state = "BLOCK_STUN";
  }

  receiveThrow(damage: number, knockback: number, attackerFacing: number, hitStop: number): void {
    this.health = Math.max(0, this.health - damage);
    this.hitStop = Math.max(this.hitStop, hitStop);
    this.velocity.x = attackerFacing * knockback * 22;
    this.velocity.y = 3.2;
    this.grounded = false;
    this.state = this.health <= 0 ? "KO" : "THROW";
    this.knockdownTicks = 76;
    this.currentMove = null;
    this.moveTick = 0;
  }

  resetForRound(x: number, z: number, facing: number): void {
    this.position.set(x, 0, z);
    this.velocity.set(0, 0, 0);
    this.grounded = true;
    this.facing = facing;
    this.health = 100;
    this.guardDamage = 0;
    this.hitStop = 0;
    this.hitStun = 0;
    this.blockStun = 0;
    this.knockdownTicks = 0;
    this.currentMove = null;
    this.moveTick = 0;
    this.hitTargets.clear();
    this.input = cloneInput(EMPTY_INPUT);
    this.previousInput = cloneInput(EMPTY_INPUT);
    this.inputBuffer.clear();
    this.state = "IDLE";
    this.invariantError = null;
    releaseFootPlants(this.visual);
  }

  validateInvariants(): boolean {
    const values = [
      this.position.x,
      this.position.y,
      this.position.z,
      this.velocity.x,
      this.velocity.y,
      this.velocity.z,
    ];
    if (values.some((value) => !Number.isFinite(value))) {
      this.invariantError = `${this.id}: non-finite position or velocity`;
      return false;
    }
    if (this.position.y < FIGHTER_GROUND_Y - GROUND_EPSILON || this.position.y > FIGHTER_MAX_HEIGHT) {
      this.invariantError = `${this.id}: unreasonable height ${this.position.y}`;
      return false;
    }
    if (Math.abs(this.velocity.y) > FIGHTER_MAX_VERTICAL_SPEED) {
      this.invariantError = `${this.id}: unreasonable vertical speed ${this.velocity.y}`;
      return false;
    }
    this.invariantError = null;
    return true;
  }

  assertInvariants(): void {
    if (!this.validateInvariants()) throw new Error(this.invariantError ?? `${this.id}: fighter invariant failed`);
  }
}

function moveForCommand(command: string | null): string | null {
  switch (command) {
    case "POWER":
      return "power";
    case "COUNTER":
      return "counter";
    case "THROW":
      return "throw";
    case "DASH_KICK":
      return "dashKick";
    case "BACKFIST":
      return "backfist";
    case "STRAIGHT":
      return "straight";
    case "BODY_BLOW":
      return "bodyBlow";
    case "LOW_KICK":
      return "lowKick";
    case "RISING_KICK":
      return "risingKick";
    case "PUNCH":
      return "jab";
    case "KICK":
      return "kick";
    default:
      return null;
  }
}

export class FighterController {
  update(fighter: FighterRuntime, opponent: FighterRuntime, input: InputFrame, deltaSeconds: number): void {
    fighter.setInput(input);
    fighter.facing = opponent.position.x >= fighter.position.x ? 1 : -1;
    if (fighter.hitStop > 0) {
      fighter.updatePhysics(deltaSeconds);
      return;
    }

    if (fighter.state === "ATTACK") {
      fighter.advanceAttack();
      fighter.updatePhysics(deltaSeconds);
      return;
    }
    if (["HIT", "BLOCK_STUN", "KNOCKDOWN", "WAKEUP", "THROW", "KO", "RING_OUT"].includes(fighter.state)) {
      fighter.updatePhysics(deltaSeconds);
      return;
    }

    const horizontal = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const axis = (input.up ? 1 : 0) - (input.down ? 1 : 0);

    // Locomotion may move an airborne fighter, but it must never overwrite the
    // jump/action state just because a direction is held on a later tick.
    if (fighter.grounded) {
      if (input.guard && axis !== 0) {
        fighter.position.z += axis * deltaSeconds * 2.9;
        fighter.state = "SIDESTEP";
      } else if (fighter.justPressed("up") && !input.guard) {
        fighter.startJump();
      } else if (input.down && !input.guard) {
        fighter.state = "CROUCH";
      } else if (input.guard) {
        fighter.state = "GUARD";
      } else if (horizontal !== 0) {
        fighter.position.x += horizontal * deltaSeconds * (fighter.definition.archetype === "SPEED" ? 3.35 : 2.72);
        fighter.state = "WALK";
      } else {
        fighter.state = "IDLE";
      }
    } else {
      if (input.guard && axis !== 0) fighter.position.z += axis * deltaSeconds * 2.9;
      if (horizontal !== 0) {
        fighter.position.x += horizontal * deltaSeconds * (fighter.definition.archetype === "SPEED" ? 3.35 : 2.72);
      }
    }

    const buttonPressed = fighter.justPressed("punch") || fighter.justPressed("kick");
    if (buttonPressed) {
      const command = CommandParser.parse(fighter.input, fighter.inputBuffer, fighter.facing);
      fighter.beginMove(moveForCommand(command) ?? "jab");
    }

    fighter.updatePhysics(deltaSeconds);
  }

  /**
   * Advances only state-independent simulation.  ROUND_END still needs this
   * path so an already-launched fighter can finish its knockback arc and land,
   * while no new input, command, attack, or combat resolution is accepted.
   */
  updatePassive(fighter: FighterRuntime, deltaSeconds: number): void {
    fighter.updatePhysics(deltaSeconds);
  }
}

export class FighterAnimationController {
  update(fighter: FighterRuntime, opponent: FighterRuntime, timeSeconds: number): void {
    const visual = fighter.visual;
    const layout = visual.layout;
    const state = fighter.state;
    const move = fighter.currentMove;
    const activePulse = move && fighter.isActive() ? 1 : 0;
    const basis = fighterBasis(fighter.facing, opponent.position.clone().sub(fighter.position));
    const scale = visual.root.scale.x;

    // Gameplay Y is the ground-contact coordinate.  The visual root carries
    // the authored boot sole to that plane; this keeps the rig and the
    // deterministic fighter position in separate, explicit spaces.
    visual.root.position.set(
      fighter.position.x,
      fighter.position.y + visualGroundOffset(visual),
      fighter.position.z,
    );
    visual.root.quaternion.copy(fighterRootQuaternion(fighter.facing));
    visual.root.updateMatrixWorld(true);

    // Reset bind offsets before each solve.  The action state selects a pose;
    // it never owns vertical physics or the model's coordinate convention.
    visual.hips.position.set(0, layout.hipsY + Math.sin(timeSeconds * 7.5) * (state === "IDLE" ? 0.018 : 0.006), 0);
    visual.hips.rotation.set(0, 0, 0);
    visual.rig.bones.spineLower.position.y = layout.pelvisTopY - layout.hipsY;
    visual.rig.bones.spineUpper.position.y = layout.ribY - layout.pelvisTopY;
    visual.rig.bones.chest.position.y = layout.shoulderY - layout.ribY;
    visual.rig.bones.neck.position.y = layout.headBottom - layout.shoulderY;
    visual.torso.rotation.set(0, 0, 0);
    visual.head.rotation.set(0, 0, 0);
    visual.panels.rotation.set(0, 0, 0);
    visual.leftArm.root.rotation.set(0, 0, 0.06);
    visual.rightArm.root.rotation.set(0, 0, -0.06);
    visual.leftLeg.root.rotation.set(0, 0, 0.02);
    visual.rightLeg.root.rotation.set(0, 0, -0.02);
    visual.leftArm.lower.rotation.set(0, 0, 0);
    visual.rightArm.lower.rotation.set(0, 0, 0);
    visual.leftLeg.lower.rotation.set(0, 0, 0);
    visual.rightLeg.lower.rotation.set(0, 0, 0);
    for (const name of ["spineLower", "spineUpper", "chest", "head", "leftShoulder", "rightShoulder", "leftUpperArm", "rightUpperArm", "leftForearm", "rightForearm", "leftHand", "rightHand", "leftFoot", "rightFoot"]) visual.rig.bones[name].rotation.set(0, 0, 0);
    visual.aura.visible = false;
    if (visual.aura.material instanceof THREE.MeshBasicMaterial) visual.aura.material.opacity = 0.22;
    visual.root.updateMatrixWorld(true);

    const passivePose = ["KNOCKDOWN", "THROW", "KO", "RING_OUT"].includes(state);
    const footMode: FootPlantMode = !fighter.grounded || state === "JUMP" || state === "SIDESTEP" || passivePose
      ? "RELEASE"
      : state === "WALK" ? "WALK" : "LOCK_BOTH";
    const plantedFeet = updateFootPlants(visual, footMode, 0, fighter.grounded);

    const solveArm = (side: -1 | 1, target: THREE.Vector3, pole: THREE.Vector3): void => {
      const prefix = side < 0 ? "left" : "right";
      // The hand bone origin is at the wrist; the visible fist is offset
      // along local -Y and a small local +Z knuckle offset. Solve the wrist
      // for the visible contact point, not for an invisible joint center.
      const ikTarget = target.clone()
        .addScaledVector(basis.up, layout.handLength * 0.48 * scale)
        .addScaledVector(basis.forward, -0.030 * scale);
      solveTwoBoneIK({
        root: visual.rig.bones[`${prefix}UpperArm`],
        mid: visual.rig.bones[`${prefix}Forearm`],
        end: visual.rig.bones[`${prefix}Hand`],
        target: ikTarget,
        pole,
      });
      orientBoneForward(visual.rig.bones[`${prefix}Hand`], basis.forward);
    };
    const solveLeg = (side: -1 | 1, target: THREE.Vector3, pole: THREE.Vector3): void => {
      const prefix = side < 0 ? "left" : "right";
      const endLocal = visual.footContacts[side < 0 ? "left" : "right"].endLocal;
      const ikTarget = target.clone()
        .addScaledVector(basis.up, -endLocal.y * scale)
        .addScaledVector(basis.forward, -endLocal.z * scale);
      solveTwoBoneIK({
        root: visual.rig.bones[`${prefix}Thigh`],
        mid: visual.rig.bones[`${prefix}Shin`],
        end: visual.rig.bones[`${prefix}Foot`],
        target: ikTarget,
        pole,
      });
      orientBoneForward(visual.rig.bones[`${prefix}Foot`], basis.forward);
    };

    const solveLegToSole = (side: -1 | 1, target: THREE.Vector3, pole: THREE.Vector3): void => {
      const prefix = side < 0 ? "left" : "right";
      const soleLocal = visual.footContacts[side < 0 ? "left" : "right"].soleLocal;
      const ikTarget = target.clone()
        .addScaledVector(basis.up, -soleLocal.y * scale)
        .addScaledVector(basis.forward, -soleLocal.z * scale);
      solveTwoBoneIK({
        root: visual.rig.bones[`${prefix}Thigh`],
        mid: visual.rig.bones[`${prefix}Shin`],
        end: visual.rig.bones[`${prefix}Foot`],
        target: ikTarget,
        pole,
      });
      orientBoneForward(visual.rig.bones[`${prefix}Foot`], basis.forward);
    };

    const legPole = (side: -1 | 1): THREE.Vector3 => {
      const prefix = side < 0 ? "left" : "right";
      return visual.rig.bones[`${prefix}Thigh`].getWorldPosition(new THREE.Vector3())
        .addScaledVector(basis.forward, scale * 0.12)
        .addScaledVector(basis.side, side * scale * 0.12);
    };

    const solvePlantedFeet = (): void => {
      if (plantedFeet.left) solveLegToSole(-1, plantedFeet.left, legPole(-1));
      if (plantedFeet.right) solveLegToSole(1, plantedFeet.right, legPole(1));
    };

    if (state === "WALK") {
      const stride = Math.sin(timeSeconds * 12) * 0.24;
      visual.hips.rotation.y = -stride * 0.10;
      visual.hips.position.x = Math.sin(timeSeconds * 6) * 0.008;
      visual.leftArm.root.rotation.z = -stride * 0.7;
      visual.rightArm.root.rotation.z = stride * 0.7;
      visual.rig.bones.spineLower.rotation.y = -stride * 0.12;
      visual.rig.bones.spineUpper.rotation.y = stride * 0.16;
      solveLegToSole(-1, getWalkFootTarget(visual, "left", timeSeconds), legPole(-1));
      solveLegToSole(1, getWalkFootTarget(visual, "right", timeSeconds), legPole(1));
    } else if (state === "CROUCH") {
      visual.hips.position.y = layout.hipsY - 0.06;
      visual.rig.bones.spineLower.rotation.x = 0.10;
      visual.rig.bones.spineUpper.rotation.x = 0.12;
      solvePlantedFeet();
    } else if (state === "JUMP") {
      visual.hips.rotation.z = -fighter.facing * 0.08;
      visual.rig.bones.spineUpper.rotation.x = -0.16;
      visual.leftLeg.root.rotation.z = -0.30;
      visual.rightLeg.root.rotation.z = 0.30;
      visual.leftArm.root.rotation.z = -0.28;
      visual.rightArm.root.rotation.z = 0.28;
    } else if (state === "SIDESTEP") {
      visual.torso.rotation.y = Math.sin(timeSeconds * 16) * 0.12;
      visual.leftLeg.root.rotation.z = 0.24;
      visual.rightLeg.root.rotation.z = -0.24;
    } else if (state === "GUARD" || state === "BLOCK_STUN") {
      const head = visual.root.localToWorld(new THREE.Vector3(0, layout.headBottom + layout.headHeight * 0.52, layout.chestDepth * 0.42));
      solveArm(-1, head.clone().addScaledVector(basis.side, -scale * 0.16).addScaledVector(basis.forward, scale * 0.08), visual.rig.bones.leftShoulder.getWorldPosition(new THREE.Vector3()).addScaledVector(basis.side, -scale * 0.25));
      solveArm(1, head.clone().addScaledVector(basis.side, scale * 0.16).addScaledVector(basis.forward, scale * 0.08), visual.rig.bones.rightShoulder.getWorldPosition(new THREE.Vector3()).addScaledVector(basis.side, scale * 0.25));
      visual.rig.bones.spineUpper.rotation.x = state === "BLOCK_STUN" ? 0.08 : 0;
      solvePlantedFeet();
    } else if (state === "ATTACK" && move) {
      const windup = Math.min(1, fighter.moveTick / Math.max(1, move.startup));
      const snap = fighter.isActive() ? Math.sin(Math.min(1, (fighter.moveTick - move.startup + 1) / Math.max(1, move.active)) * Math.PI) : 0;
      const combatTarget = attackHitboxCenter(fighter.position, fighter.facing, move);
      const targetBlend = fighter.isActive() ? 1 : windup * 0.35;
      if (move.animation === "punch") {
        const punchSide: -1 | 1 = move.visualContact === "LEFT_FIST" ? -1 : 1;
        const punchPrefix = punchSide < 0 ? "left" : "right";
        const bindFist = getVisualContactPoint(visual, punchSide < 0 ? "LEFT_FIST" : "RIGHT_FIST");
        const target = bindFist.lerp(combatTarget, targetBlend);
        visual.hips.rotation.y = -snap * 0.12;
        visual.rig.bones.spineLower.rotation.y = -snap * 0.15;
        visual.rig.bones.spineUpper.rotation.y = snap * 0.22;
        visual.rig.bones.chest.rotation.z = -snap * 0.06;
        visual.leftLeg.root.rotation.z = 0.12;
        visual.rightLeg.root.rotation.z = -0.20;
        visual.root.updateMatrixWorld(true);
        const shoulder = visual.rig.bones[`${punchPrefix}Shoulder`].getWorldPosition(new THREE.Vector3());
        const pole = shoulder.clone().addScaledVector(basis.side, punchSide * scale * 0.22).addScaledVector(basis.up, -scale * 0.08).addScaledVector(basis.forward, scale * 0.08);
        solveArm(punchSide, target, pole);
        const recoverySide = (punchSide * -1) as -1 | 1;
        const recoveryX = recoverySide * 0.16;
        const recoveryPrefix = recoverySide < 0 ? "left" : "right";
        solveArm(recoverySide, visual.root.localToWorld(new THREE.Vector3(recoveryX, layout.shoulderY - 0.07, 0.18)), visual.rig.bones[`${recoveryPrefix}Shoulder`].getWorldPosition(new THREE.Vector3()).addScaledVector(basis.side, recoverySide * scale * 0.20));
      } else if (move.animation === "kick") {
        const kickSide: -1 | 1 = move.visualContact === "LEFT_FOOT" ? -1 : 1;
        const kickPrefix = kickSide < 0 ? "left" : "right";
        const bindFoot = getVisualContactPoint(visual, kickSide < 0 ? "LEFT_FOOT" : "RIGHT_FOOT");
        const target = bindFoot.lerp(combatTarget, targetBlend);
        visual.hips.rotation.y = snap * 0.16;
        visual.rig.bones.spineLower.rotation.y = snap * 0.16;
        visual.rig.bones.spineUpper.rotation.y = -snap * 0.20;
        visual.rig.bones.chest.rotation.z = snap * 0.08;
        visual.root.updateMatrixWorld(true);
        const hip = visual.rig.bones[`${kickPrefix}Thigh`].getWorldPosition(new THREE.Vector3());
        const pole = hip.clone().addScaledVector(basis.side, kickSide * scale * 0.18).addScaledVector(basis.forward, scale * 0.14).addScaledVector(basis.up, scale * 0.02);
        solveLeg(kickSide, target, pole);
        const supportSide = (kickSide * -1) as -1 | 1;
        const supportPrefix = supportSide < 0 ? "left" : "right";
        const support = plantedFeet[supportSide < 0 ? "left" : "right"] ?? getSoleContactPoint(visual, supportSide < 0 ? "left" : "right");
        solveLegToSole(supportSide, support, visual.rig.bones[`${supportPrefix}Thigh`].getWorldPosition(new THREE.Vector3()).addScaledVector(basis.side, supportSide * scale * 0.12));
        solveArm(-1, visual.root.localToWorld(new THREE.Vector3(-0.15, layout.shoulderY - 0.08, 0.16)), visual.rig.bones.leftShoulder.getWorldPosition(new THREE.Vector3()).addScaledVector(basis.side, -scale * 0.20));
        solveArm(1, visual.root.localToWorld(new THREE.Vector3(0.15, layout.shoulderY - 0.10, 0.15)), visual.rig.bones.rightShoulder.getWorldPosition(new THREE.Vector3()).addScaledVector(basis.side, scale * 0.20));
        if (supportSide === -1 && plantedFeet.left) solveLegToSole(-1, plantedFeet.left, legPole(-1));
        if (supportSide === 1 && plantedFeet.right) solveLegToSole(1, plantedFeet.right, legPole(1));
      } else {
        solveArm(-1, combatTarget, visual.rig.bones.leftShoulder.getWorldPosition(new THREE.Vector3()).addScaledVector(basis.side, -scale * 0.20));
        solveArm(1, combatTarget, visual.rig.bones.rightShoulder.getWorldPosition(new THREE.Vector3()).addScaledVector(basis.side, scale * 0.20));
      }
      if (move.power > 1.35 || activePulse > 0) {
        visual.aura.visible = true;
        visual.aura.scale.set(0.95 + snap * 0.15, 1.6 + snap * 0.2, 0.62 + snap * 0.1);
        if (visual.aura.material instanceof THREE.MeshBasicMaterial) visual.aura.material.opacity = 0.12 + snap * 0.18;
      }
      visual.head.rotation.z = (windup - 0.5) * 0.12;
    } else if (state === "HIT") {
      visual.rig.bones.spineUpper.rotation.z = -0.18;
      visual.head.rotation.z = 0.18;
      visual.leftArm.root.rotation.z = -0.42;
      visual.rightArm.root.rotation.z = 0.42;
    } else if (state === "KNOCKDOWN" || state === "THROW" || state === "KO" || state === "RING_OUT") {
      visual.root.quaternion.copy(fighterRootQuaternion(fighter.facing));
      visual.root.rotateZ(fighter.facing * THREE.MathUtils.lerp(0, 1.35, Math.min(1, fighter.stateMachine.stateTicks / 22)));
      visual.rig.bones.spineUpper.rotation.z = 0.20;
      visual.head.rotation.z = 0.16;
      visual.leftLeg.root.rotation.z = -0.5;
      visual.rightLeg.root.rotation.z = 0.5;
      visual.leftArm.root.rotation.z = -0.65;
      visual.rightArm.root.rotation.z = 0.65;
    } else if (state === "WAKEUP") {
      visual.root.quaternion.copy(fighterRootQuaternion(fighter.facing));
      visual.root.rotateZ(fighter.facing * 1.35 * (1 - Math.min(1, fighter.stateMachine.stateTicks / 22)));
      solvePlantedFeet();
    } else {
      visual.torso.rotation.y = Math.sin(timeSeconds * 2.4) * 0.018;
      solvePlantedFeet();
    }
    for (const [index, hair] of visual.ponytailMasses.entries()) {
      hair.rotation.z += Math.sin(timeSeconds * 5.5 + index * 0.65) * 0.006;
      hair.rotation.x += Math.cos(timeSeconds * 4.2 + index * 0.4) * 0.004;
    }
    visual.root.updateMatrixWorld(true);
  }
}

export type CpuDifficulty = "EASY" | "NORMAL" | "HARD";

export class CpuController {
  private decisionTicks = 0;
  private current: InputFrame = cloneInput(EMPTY_INPUT);
  private seed = 17;

  constructor(private readonly difficulty: CpuDifficulty = "NORMAL") {}

  update(fighter: FighterRuntime, opponent: FighterRuntime): InputFrame {
    this.decisionTicks -= 1;
    if (this.decisionTicks > 0) {
      const output = cloneInput(this.current);
      // A CPU jump is a one-tick edge, while approach/retreat remains held.
      if (output.up) {
        output.up = false;
        this.current.up = false;
      }
      return output;
    }
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    const random = this.seed / 0x7fffffff;
    const distance = opponent.position.distanceTo(fighter.position);
    const towardRight = opponent.position.x > fighter.position.x;
    const toward = towardRight ? "right" : "left";
    const away = towardRight ? "left" : "right";
    const next: InputFrame = cloneInput(EMPTY_INPUT);
    const reaction = this.difficulty === "HARD" ? 0.82 : this.difficulty === "NORMAL" ? 0.58 : 0.32;
    const threat = opponent.state === "ATTACK" && opponent.isActive();
    if (threat && random < reaction && distance < 2.55) {
      next.guard = true;
      if (random > 0.76) next.down = true;
      this.decisionTicks = this.difficulty === "HARD" ? 10 : 16;
    } else if (distance > 2.35) {
      next[toward] = true;
      if (random > 0.72) next.up = true;
      this.decisionTicks = this.difficulty === "HARD" ? 12 : 18;
    } else if (random < 0.14 && this.difficulty !== "EASY") {
      next[away] = true;
      next.guard = true;
      this.decisionTicks = 13;
    } else if (random < 0.22) {
      next.kick = true;
      if (random > 0.16) next.down = true;
      this.decisionTicks = 8;
    } else if (random < 0.39) {
      next.punch = true;
      this.decisionTicks = 7;
    } else if (random < 0.48) {
      next.kick = true;
      next.guard = true;
      this.decisionTicks = 8;
    } else {
      next.guard = random > 0.55;
      this.decisionTicks = 9;
    }
    this.current = next;
    return next;
  }
}

import * as THREE from "three";
import { TpsFightGame as CoreTpsFightGame } from "./tps-game-base";
import type { FighterRuntime } from "./fighter";
import type { HitEvent, InputFrame } from "./types";
import {
  TPS_HYPE_PROFILE,
  TpsHypeDirector,
  tpsHypeHitStopForTier,
  tpsHypeImpactTier,
  tpsHypeKnockbackScaleForTier,
} from "./tps-hype";

export type { TpsFightGameOptions } from "./tps-game-base";

export const TPS_STEP_DISTANCE_SCALE = 2;
const FIXED_STEP = 1 / 60;
const ENEMY_TRACK_RATE = 0.16;
const ENEMY_SIDE_STEP_TRACK_RATE = 0.06;
const ENEMY_SPACING_DEAD_ZONE = 0.30;
const ENEMY_ORBIT_ACTIVE_TICKS = 28;
const ENEMY_TACTIC_INTERVAL = 72;
const ENEMY_ATTACK_ALIGNMENT = 0.82;
const MODEL_FORWARD = new THREE.Vector3(0, 0, 1);

type ExtendedTpsRuntime = CoreTpsFightGame & {
  playerEvadeTicks: number;
  playerStepDirection: THREE.Vector3;
  playerStepForwardWeight: number;
  playerStepSideWeight: number;
  playerComboStage: number;
  playerComboGraceTicks: number;
  playerAttackQueued: boolean;
  playerFlankWindowTicks: number;
  playerFlankAttackTicks: number;
  playerPerfectEvadeTicks: number;
  enemyCooldown: number;
  enemyTactic: "PRESSURE" | "ORBIT" | "BAIT";
  enemyOrbitSign: number;
  simulationTicks: number;
  difficulty: "EASY" | "NORMAL" | "HARD";
  __enemyVisualForward?: THREE.Vector3;
  __hypeDirector?: TpsHypeDirector;
};

function horizontalDirection(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3 {
  const result = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);
  return result.lengthSq() > 1e-8 ? result.normalize() : new THREE.Vector3(1, 0, 0);
}

function extended(game: TpsFightGame): ExtendedTpsRuntime {
  return game as unknown as ExtendedTpsRuntime;
}

function hype(game: ExtendedTpsRuntime): TpsHypeDirector {
  game.__hypeDirector ??= new TpsHypeDirector(game.scene);
  return game.__hypeDirector;
}

function enemyVisualForward(game: ExtendedTpsRuntime): THREE.Vector3 {
  if (!game.__enemyVisualForward) {
    game.__enemyVisualForward = horizontalDirection(game.p2.position, game.p1.position);
  }
  return game.__enemyVisualForward;
}

const corePrototype = CoreTpsFightGame.prototype as unknown as {
  updatePlayer(input: InputFrame): void;
  updateEnemy(): void;
  updateVisual(fighter: FighterRuntime, opponent: FighterRuntime, time: number): void;
  updateCamera(delta: number): void;
  resolveAttack(attacker: FighterRuntime, defender: FighterRuntime, defenderGuarding: boolean): void;
  resetRound(): void;
  beginContextAttack(): boolean;
  destroy(): void;
};
const coreUpdatePlayer = corePrototype.updatePlayer;
const coreUpdateEnemy = corePrototype.updateEnemy;
const coreUpdateVisual = corePrototype.updateVisual;
const coreUpdateCamera = corePrototype.updateCamera;
const coreResolveAttack = corePrototype.resolveAttack;
const coreResetRound = corePrototype.resetRound;
const coreBeginContextAttack = corePrototype.beginContextAttack;
const coreDestroy = corePrototype.destroy;

/**
 * TPS gameplay extension over the battle-tested core runtime.
 *
 * This layer owns the high-energy presentation and hit-confirm pacing while the
 * base runtime keeps the already-audited combat rules, AI, input, arena and HUD.
 */
export class TpsFightGame extends CoreTpsFightGame {}

const prototype = TpsFightGame.prototype as unknown as {
  updatePlayer(input: InputFrame): void;
  updateEnemy(): void;
  updateVisual(fighter: FighterRuntime, opponent: FighterRuntime, time: number): void;
  updateCamera(delta: number): void;
  resolveAttack(attacker: FighterRuntime, defender: FighterRuntime, defenderGuarding: boolean): void;
  resetRound(): void;
  destroy(): void;
};

prototype.updatePlayer = function updatePlayer(input: InputFrame): void {
  const game = extended(this as unknown as TpsFightGame);
  const beforeState = game.p1.state;
  const beforeMoveId = game.p1.currentMove?.id ?? null;
  const rawAttackPressed = input.punch && !game.p1.input.punch;
  const activeMove = game.p1.currentMove;

  // Confirmed hits can cancel most of recovery after a tiny authored beat. This
  // turns the old "tap, wait, tap" rhythm into an arcade-style rush while still
  // refusing to chain whiffs. Early taps remain buffered by the core runtime.
  if (
    game.p1.state === "ATTACK"
    && activeMove
    && game.p1.hitTargets.has(game.p2.id)
    && game.playerComboStage < 3
  ) {
    if (rawAttackPressed) game.playerAttackQueued = true;
    const cancelTick = activeMove.startup + activeMove.active + TPS_HYPE_PROFILE.hitConfirmCancelLagTicks;
    if (game.playerAttackQueued && game.p1.moveTick >= cancelTick) {
      game.p1.setInput(input);
      game.p1.currentMove = null;
      game.p1.moveTick = 0;
      game.p1.state = "IDLE";
      game.p1.hitTargets.clear();
      game.playerAttackQueued = false;
      if (coreBeginContextAttack.call(this)) {
        game.p1.updatePhysics(FIXED_STEP);
        hype(game).comboShift(game.playerComboStage);
        game.audio.comboShift(game.playerComboStage);
      }
      return;
    }
  }

  coreUpdatePlayer.call(this, input);

  // The core already moved one STEP distance this tick. Add the same authored
  // displacement once more so forward/back/left/right/diagonal STEP all travel
  // exactly 2x without changing duration, cooldown, or dodge timing.
  if (game.p1.state === "SIDESTEP" && game.playerStepDirection.lengthSq() > 1e-6) {
    const moveSpeed = game.p1.definition.archetype === "SPEED" ? 4.0 : 3.35;
    const baseStepMultiplier = game.p1.definition.archetype === "SPEED" ? 2.55 : 2.45;
    const directionalStepBonus = game.playerStepForwardWeight < -0.45
      ? 0.48
      : game.playerStepForwardWeight > 0.45
        ? -0.16
        : 0.08;
    const stepMultiplier = baseStepMultiplier + directionalStepBonus;
    game.p1.position.addScaledVector(
      game.playerStepDirection,
      FIXED_STEP * moveSpeed * stepMultiplier * (TPS_STEP_DISTANCE_SCALE - 1),
    );
  }

  const startedStep = beforeState !== "SIDESTEP" && game.p1.state === "SIDESTEP";
  if (startedStep) {
    const perfect = game.playerPerfectEvadeTicks > 0;
    hype(game).step(game.p1, game.p2, perfect);
    game.audio.rush(perfect);
  }

  const startedDash = beforeMoveId !== "dashKick" && game.p1.currentMove?.id === "dashKick";
  if (startedDash) {
    hype(game).dash();
    game.audio.rush(false, true);
  }
};

prototype.updateEnemy = function updateEnemy(): void {
  const game = extended(this as unknown as TpsFightGame);
  const beforePosition = game.p2.position.clone();
  const beforeState = game.p2.state;
  const beforeCooldown = game.enemyCooldown;
  const towardPlayer = horizontalDirection(beforePosition, game.p1.position);
  const facing = enemyVisualForward(game);

  // A lateral STEP now earns a visible angle. The CPU still reacquires the
  // player, but it does so progressively instead of snapping to face them every
  // fixed tick. Outside a side STEP the tracking remains responsive.
  const sideStepTracking = game.playerEvadeTicks > 0 && game.playerStepSideWeight > 0.45;
  const trackingRate = sideStepTracking ? ENEMY_SIDE_STEP_TRACK_RATE : ENEMY_TRACK_RATE;
  facing.lerp(towardPlayer, trackingRate);
  if (facing.lengthSq() <= 1e-8) facing.copy(towardPlayer);
  else facing.normalize();
  const enemyFacingAlignment = THREE.MathUtils.clamp(facing.dot(towardPlayer), -1, 1);

  coreUpdateEnemy.call(this);

  // Do not allow a newly selected strike to fire while the visible body is
  // still catching up to a side STEP. Existing attacks continue normally.
  const startedAttack = beforeState !== "ATTACK" && game.p2.state === "ATTACK";
  if (startedAttack && enemyFacingAlignment < ENEMY_ATTACK_ALIGNMENT) {
    game.p2.currentMove = null;
    game.p2.moveTick = 0;
    game.p2.hitTargets.clear();
    game.p2.state = "IDLE";
    game.enemyCooldown = Math.max(8, beforeCooldown > 0 ? beforeCooldown - 1 : 0);
    return;
  }

  // The core AI decides when to attack/guard. When it chooses locomotion, replace
  // only that locomotion with a spacing model that has a real neutral band.
  // This removes the old perpetual WALK while preserving all tactical decisions.
  if (game.p2.state !== "WALK") return;

  const currentToward = horizontalDirection(beforePosition, game.p1.position);
  const distance = Math.hypot(
    game.p1.position.x - beforePosition.x,
    game.p1.position.z - beforePosition.z,
  );
  const tangent = new THREE.Vector3(-currentToward.z, 0, currentToward.x);
  const desiredDistance = game.enemyTactic === "PRESSURE"
    ? 1.72
    : game.enemyTactic === "BAIT"
      ? 2.55
      : 2.08;
  const distanceError = distance - desiredDistance;
  const movement = new THREE.Vector3();

  if (distanceError > ENEMY_SPACING_DEAD_ZONE) movement.add(currentToward);
  else if (distanceError < -ENEMY_SPACING_DEAD_ZONE) movement.addScaledVector(currentToward, -1);

  const orbitActive = game.enemyTactic === "ORBIT"
    && Math.abs(distanceError) <= 0.82
    && game.simulationTicks % ENEMY_TACTIC_INTERVAL < ENEMY_ORBIT_ACTIVE_TICKS;
  if (orbitActive) movement.addScaledVector(tangent, game.enemyOrbitSign * 0.58);

  game.p2.position.copy(beforePosition);
  if (movement.lengthSq() <= 1e-6) {
    game.p2.state = "IDLE";
    return;
  }

  movement.normalize();
  const baseSpeed = game.p2.definition.archetype === "SPEED" ? 3.45 : 2.95;
  const difficultySpeed = game.difficulty === "HARD" ? 1.08 : game.difficulty === "EASY" ? 0.9 : 1;
  game.p2.position.addScaledVector(movement, FIXED_STEP * baseSpeed * difficultySpeed);
  game.p2.state = "WALK";
};

prototype.resolveAttack = function resolveAttack(
  attacker: FighterRuntime,
  defender: FighterRuntime,
  defenderGuarding: boolean,
): void {
  const game = extended(this as unknown as TpsFightGame);
  const move = attacker.currentMove;
  const alreadyResolved = !move || attacker.hitTargets.has(defender.id);
  const beforeHealth = defender.health;
  const beforeBlockStun = defender.blockStun;
  const beforeHitStop = defender.hitStop;
  const beforeState = defender.state;

  coreResolveAttack.call(this, attacker, defender, defenderGuarding);
  if (!move || alreadyResolved || !attacker.hitTargets.has(defender.id)) return;

  const blocked = defender.blockStun > beforeBlockStun || defender.state === "BLOCK_STUN";
  const madeContact = defender.health < beforeHealth || blocked || defender.hitStop > beforeHitStop;
  if (!madeContact) return;

  const tier = tpsHypeImpactTier(move.id, move.power);
  const sharedHitStop = tpsHypeHitStopForTier(tier, blocked);
  attacker.hitStop = Math.max(attacker.hitStop, sharedHitStop);
  defender.hitStop = Math.max(defender.hitStop, sharedHitStop);

  if (!blocked) {
    const knockbackScale = tpsHypeKnockbackScaleForTier(tier);
    defender.velocity.x *= knockbackScale;
    defender.velocity.z *= knockbackScale;
    if (move.launcher) {
      defender.velocity.y = Math.max(defender.velocity.y, TPS_HYPE_PROFILE.launcherVerticalSpeed);
      defender.grounded = false;
    } else if (tier === 3 && defender.state !== "KO" && ["KNOCKDOWN", "THROW"].includes(defender.state)) {
      defender.velocity.y = Math.max(defender.velocity.y, TPS_HYPE_PROFILE.heavyKnockdownVerticalSpeed);
      defender.grounded = false;
    }
  }

  const impactPosition = attacker.position.clone().lerp(defender.position, 0.55);
  impactPosition.y = move.hitLevel === "LOW" ? 0.55 : 1.35;
  const event: HitEvent = {
    attacker: attacker.id,
    defender: defender.id,
    move,
    blocked,
    counter: !blocked && beforeState === "ATTACK",
    throwEscape: false,
    damage: Math.max(0, beforeHealth - defender.health),
    position: { x: impactPosition.x, y: impactPosition.y, z: impactPosition.z },
  };
  hype(game).hit(event, game.camera);
  game.audio.hypeImpact(event);
};

prototype.updateVisual = function updateVisual(
  fighter: FighterRuntime,
  opponent: FighterRuntime,
  time: number,
): void {
  coreUpdateVisual.call(this, fighter, opponent, time);
  const game = extended(this as unknown as TpsFightGame);
  if (fighter !== game.p2) return;

  // The core animation still supplies the pose. Replace only its final root yaw
  // so the enemy visibly turns toward a lateral STEP over several ticks. A new
  // round/rematch is the one exception: it always starts correctly squared up.
  const forward = enemyVisualForward(game);
  if (game.simulationTicks === 0) {
    forward.copy(horizontalDirection(game.p2.position, game.p1.position));
  }
  fighter.visual.root.quaternion.setFromUnitVectors(MODEL_FORWARD, forward);
  fighter.visual.root.updateMatrixWorld(true);
};

prototype.updateCamera = function updateCamera(delta: number): void {
  coreUpdateCamera.call(this, delta);
  const game = extended(this as unknown as TpsFightGame);
  hype(game).update(game.camera, delta);
};

prototype.resetRound = function resetRound(): void {
  coreResetRound.call(this);
  const game = extended(this as unknown as TpsFightGame);
  hype(game).reset(game.camera);
};

prototype.destroy = function destroy(): void {
  const game = extended(this as unknown as TpsFightGame);
  game.__hypeDirector?.dispose();
  game.__hypeDirector = undefined;
  coreDestroy.call(this);
};

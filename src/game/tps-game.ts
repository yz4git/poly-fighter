import * as THREE from "three";
import { TpsFightGame as CoreTpsFightGame } from "./tps-game-base";
import type { FighterRuntime } from "./fighter";
import { finalizeQuaterniusModelPose } from "./visual-quaternius-runtime";
import {
  chooseTpsComboContinuationRoute,
  chooseTpsComboRoute,
  tpsComboLinkWindow,
  tpsComboMoveForRoute,
  type TpsComboRoute,
} from "./motion-profile";
import { trackMotionFighter } from "./motion-reaction";
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
const PERFECT_COUNTER_TARGET_DISTANCE = 1.08;
const PERFECT_COUNTER_MAX_LUNGE = 0.78;
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
  __comboRoute?: TpsComboRoute;
  __comboRouteSeed?: number;
  __comboLinkSerial?: number;
  __comboQueuedBranch?: "FORWARD" | "BACK" | "SIDE" | "NEUTRAL";
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
const coreDestroy = corePrototype.destroy;

/**
 * TPS gameplay extension over the battle-tested core runtime.
 *
 * This layer owns the high-energy presentation, the context-sensitive combo
 * graph and hit-confirm pacing while the base runtime keeps the audited input,
 * arena, lock-on, collision and round rules.
 */
export class TpsFightGame extends CoreTpsFightGame {}

const prototype = TpsFightGame.prototype as unknown as {
  updatePlayer(input: InputFrame): void;
  updateEnemy(): void;
  updateVisual(fighter: FighterRuntime, opponent: FighterRuntime, time: number): void;
  updateCamera(delta: number): void;
  resolveAttack(attacker: FighterRuntime, defender: FighterRuntime, defenderGuarding: boolean): void;
  resetRound(): void;
  beginContextAttack(): boolean;
  destroy(): void;
};

prototype.beginContextAttack = function beginContextAttack(): boolean {
  const game = extended(this as unknown as TpsFightGame);
  if (!game.p1.canAct()) return false;
  const distance = Math.hypot(
    game.p2.position.x - game.p1.position.x,
    game.p2.position.z - game.p1.position.z,
  );
  const stage = Math.min(2, game.playerComboStage);
  const flank = game.playerFlankWindowTicks > 0 && game.playerStepSideWeight > 0.45;
  const perfect = game.playerPerfectEvadeTicks > 0 && flank;

  if (stage === 0 || !game.__comboRoute) {
    game.__comboRouteSeed = (game.__comboRouteSeed ?? 0) + 1;
    game.__comboRoute = chooseTpsComboRoute({
      distance,
      flank,
      perfect,
      variationSeed: game.__comboRouteSeed + Math.floor(game.simulationTicks / 45),
    });
  }

  const moveId = tpsComboMoveForRoute(game.__comboRoute, stage, game.p1.definition);
  if (!game.p1.beginMove(moveId)) return false;

  // A successful lateral PERFECT STEP creates a large side gap by design. The
  // first counter therefore gets a short authored pursuit lunge so the reward
  // still reaches the opponent instead of whiffing because STEP distance was
  // doubled. The lunge stops at close striking distance and never teleports on
  // ordinary/flank-only routes.
  if (game.__comboRoute === "PERFECT" && stage === 0) {
    const towardTarget = horizontalDirection(game.p1.position, game.p2.position);
    const currentDistance = Math.hypot(
      game.p2.position.x - game.p1.position.x,
      game.p2.position.z - game.p1.position.z,
    );
    const lunge = THREE.MathUtils.clamp(
      currentDistance - PERFECT_COUNTER_TARGET_DISTANCE,
      0,
      PERFECT_COUNTER_MAX_LUNGE,
    );
    game.p1.position.addScaledVector(towardTarget, lunge);
    game.p1.visual.root.userData.tpsPerfectCounterLunge = lunge;
  }

  game.playerComboStage = stage + 1;
  game.playerComboGraceTicks = 34;
  game.p1.visual.root.userData.tpsComboRoute = game.__comboRoute;
  game.p1.visual.root.userData.tpsComboMove = moveId;
  game.p1.visual.root.userData.tpsComboStage = game.playerComboStage;

  if (flank) {
    game.playerFlankAttackTicks = 28;
    game.playerFlankWindowTicks = 0;
  }
  return true;
};

prototype.updatePlayer = function updatePlayer(input: InputFrame): void {
  const game = extended(this as unknown as TpsFightGame);
  const beforeState = game.p1.state;
  const beforeMoveId = game.p1.currentMove?.id ?? null;
  const rawAttackPressed = input.punch && !game.p1.input.punch;
  const activeMove = game.p1.currentMove;

  // Capture direction together with the ATTACK tap. Early taps are allowed to
  // buffer, but the continuation only fires inside the move's authored
  // cancelWindow. This preserves a visible follow-through beat before the next
  // startup and makes direction-based branches deterministic even if the player
  // releases the stick before the link point arrives.
  if (game.p1.state === "ATTACK" && rawAttackPressed && game.playerComboStage < 3) {
    game.__comboQueuedBranch = input.up
      ? "FORWARD"
      : input.down
        ? "BACK"
        : input.left || input.right
          ? "SIDE"
          : "NEUTRAL";
  }

  if (
    game.p1.state === "ATTACK"
    && activeMove
    && game.p1.hitTargets.has(game.p2.id)
    && game.playerComboStage < 3
  ) {
    const linkWindow = tpsComboLinkWindow(activeMove);
    if (rawAttackPressed && game.p1.moveTick >= linkWindow.queueStart && game.p1.moveTick <= linkWindow.linkEnd) {
      game.playerAttackQueued = true;
    }

    const inLinkWindow = game.p1.moveTick >= linkWindow.linkStart && game.p1.moveTick <= linkWindow.linkEnd;
    if (game.playerAttackQueued && inLinkWindow) {
      const linkTick = game.p1.moveTick;
      const distance = Math.hypot(
        game.p2.position.x - game.p1.position.x,
        game.p2.position.z - game.p1.position.z,
      );
      const routeFrom = game.__comboRoute ?? chooseTpsComboRoute({
        distance,
        flank: false,
        perfect: false,
        variationSeed: game.__comboRouteSeed ?? 0,
      });
      const branch = game.__comboQueuedBranch ?? "NEUTRAL";
      const routeTo = chooseTpsComboContinuationRoute({
        currentRoute: routeFrom,
        distance,
        forward: branch === "FORWARD",
        back: branch === "BACK",
        side: branch === "SIDE",
      });
      game.__comboRoute = routeTo;
      game.__comboLinkSerial = (game.__comboLinkSerial ?? 0) + 1;
      game.p1.visual.root.userData.tpsComboLinkSerial = game.__comboLinkSerial;
      game.p1.visual.root.userData.tpsComboLinkState = "LINKED";
      game.p1.visual.root.userData.tpsComboLinkFromMove = activeMove.id;
      game.p1.visual.root.userData.tpsComboLinkTick = linkTick;
      game.p1.visual.root.userData.tpsComboLinkStart = linkWindow.linkStart;
      game.p1.visual.root.userData.tpsComboLinkEnd = linkWindow.linkEnd;
      game.p1.visual.root.userData.tpsComboLinkRouteFrom = routeFrom;
      game.p1.visual.root.userData.tpsComboLinkRouteTo = routeTo;
      game.p1.visual.root.userData.tpsComboLinkBranch = branch;
      game.p1.visual.root.userData.tpsComboLinkBlendSeconds = 0.075;

      game.p1.setInput(input);
      game.p1.currentMove = null;
      game.p1.moveTick = 0;
      game.p1.state = "IDLE";
      game.p1.hitTargets.clear();
      game.playerAttackQueued = false;
      game.__comboQueuedBranch = undefined;
      if (prototype.beginContextAttack.call(this)) {
        game.p1.updatePhysics(FIXED_STEP);
        hype(game).comboShift(game.playerComboStage);
        game.audio.comboShift(game.playerComboStage);
      }
      return;
    }

    if (game.p1.moveTick > linkWindow.linkEnd) {
      game.playerAttackQueued = false;
      game.__comboQueuedBranch = undefined;
      game.p1.visual.root.userData.tpsComboLinkState = "MISSED";
    } else if (game.playerAttackQueued) {
      game.p1.visual.root.userData.tpsComboLinkState = "BUFFERED";
      game.p1.visual.root.userData.tpsComboLinkStart = linkWindow.linkStart;
      game.p1.visual.root.userData.tpsComboLinkEnd = linkWindow.linkEnd;
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
    game.__comboRoute = undefined;
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

  // Broaden the CPU's visible vocabulary without changing its tactical timing.
  // Core still decides *when* and whether the choice was a light punch/kick;
  // this layer deterministically chooses a related body motion for that slot.
  const directorMove = game.p2.visual.root.userData.tpsCpuDirectorMove as string | null | undefined;
  if (startedAttack && game.p2.currentMove && game.p2.currentMove.id !== directorMove && ["jab", "straight", "kick"].includes(game.p2.currentMove.id)) {
    const distance = Math.hypot(
      game.p1.position.x - game.p2.position.x,
      game.p1.position.z - game.p2.position.z,
    );
    const selector = Math.floor(game.simulationTicks / 19);
    const closeChoices = ["jab", "straight", "bodyBlow", "backfist"] as const;
    const farChoices = ["kick", "lowKick", "risingKick"] as const;
    const choices = distance <= 1.62 ? closeChoices : farChoices;
    const nextId = choices[selector % choices.length];
    const nextMove = game.p2.definition.moves[nextId];
    if (nextMove) {
      game.p2.currentMove = nextMove;
      game.p2.moveTick = 0;
      game.p2.hitTargets.clear();
      game.p2.visual.root.userData.tpsCpuMotionMove = nextId;
    }
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
  const directorIntent = game.p2.visual.root.userData.tpsCpuDirectorIntent as string | undefined;

  if (directorIntent === "APPROACH") movement.add(currentToward);
  else if (directorIntent === "RETREAT") movement.addScaledVector(currentToward, -1);
  else if (directorIntent === "SIDESTEP" || directorIntent === "JUMP") movement.addScaledVector(tangent, game.enemyOrbitSign);
  else {
    if (distanceError > ENEMY_SPACING_DEAD_ZONE) movement.add(currentToward);
    else if (distanceError < -ENEMY_SPACING_DEAD_ZONE) movement.addScaledVector(currentToward, -1);

    const orbitActive = game.enemyTactic === "ORBIT"
      && Math.abs(distanceError) <= 0.82
      && game.simulationTicks % ENEMY_TACTIC_INTERVAL < ENEMY_ORBIT_ACTIVE_TICKS;
    if (orbitActive) movement.addScaledVector(tangent, game.enemyOrbitSign * 0.58);
  }

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

  // Register both runtimes before the shared effect callback records the hit.
  trackMotionFighter(attacker);
  trackMotionFighter(defender);
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
  impactPosition.y = move.hitLevel === "LOW" ? 0.55 : move.reactionTarget === "HEAD" ? 1.85 : 1.35;
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
  if (fighter !== game.p2) {
    finalizeQuaterniusModelPose(fighter, time);
    return;
  }

  // The core animation still supplies the pose. Replace only its final root yaw
  // so the enemy visibly turns toward a lateral STEP over several ticks. A new
  // round/rematch is the one exception: it always starts correctly squared up.
  const forward = enemyVisualForward(game);
  if (game.simulationTicks === 0) {
    forward.copy(horizontalDirection(game.p2.position, game.p1.position));
  }
  fighter.visual.root.quaternion.setFromUnitVectors(MODEL_FORWARD, forward);
  fighter.visual.root.updateMatrixWorld(true);
  finalizeQuaterniusModelPose(fighter, time);
};

prototype.updateCamera = function updateCamera(delta: number): void {
  coreUpdateCamera.call(this, delta);
  const game = extended(this as unknown as TpsFightGame);
  hype(game).update(game.camera, delta);
};

prototype.resetRound = function resetRound(): void {
  coreResetRound.call(this);
  const game = extended(this as unknown as TpsFightGame);
  game.__comboRoute = undefined;
  game.__comboRouteSeed = 0;
  game.__comboLinkSerial = 0;
  game.__comboQueuedBranch = undefined;
  game.p1.visual.root.userData.tpsComboRoute = null;
  game.p1.visual.root.userData.tpsComboLinkSerial = 0;
  game.p1.visual.root.userData.tpsComboLinkState = null;
  game.p1.visual.root.userData.tpsComboLinkFromMove = null;
  game.p1.visual.root.userData.tpsComboLinkRouteFrom = null;
  game.p1.visual.root.userData.tpsComboLinkRouteTo = null;
  game.p1.visual.root.userData.tpsComboLinkBranch = null;
  game.p1.visual.root.userData.tpsComboMove = null;
  game.p1.visual.root.userData.tpsComboStage = 0;
  game.p1.visual.root.userData.tpsPerfectCounterLunge = 0;
  hype(game).reset(game.camera);
};

prototype.destroy = function destroy(): void {
  const game = extended(this as unknown as TpsFightGame);
  game.__hypeDirector?.dispose();
  game.__hypeDirector = undefined;
  coreDestroy.call(this);
};

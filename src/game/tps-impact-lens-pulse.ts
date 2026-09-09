import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { TpsFightGame } from "./tps-game";

const LIGHT_FOV_PUNCH = 0.85;
const MEDIUM_FOV_PUNCH = 1.35;
const HEAVY_FOV_PUNCH = 1.95;
const COUNTER_FOV_PUNCH = 2.20;
const BLOCK_FOV_PUNCH = 0.70;
const LIGHT_PULSE_SECONDS = 0.105;
const MEDIUM_PULSE_SECONDS = 0.125;
const HEAVY_PULSE_SECONDS = 0.155;
const COUNTER_PULSE_SECONDS = 0.175;

type ImpactLensRuntime = TpsFightGame & {
  __impactLensSeconds?: number;
  __impactLensDuration?: number;
  __impactLensFovPunch?: number;
};

type TpsPrototype = {
  resolveAttack(attacker: FighterRuntime, defender: FighterRuntime, defenderGuarding: boolean): void;
  updateCamera(delta: number): void;
  resetRound(): void;
};

let installed = false;

function runtime(game: TpsFightGame): ImpactLensRuntime {
  return game as unknown as ImpactLensRuntime;
}

function startImpactLensPulse(game: ImpactLensRuntime, fovPunch: number, duration: number): void {
  // Never compete with the dedicated lethal FINAL IMPACT lens hold.
  if (game.camera.userData.tpsFinalImpactStage === "HOLD") return;

  const remaining = game.__impactLensSeconds ?? 0;
  const existingPunch = game.__impactLensFovPunch ?? 0;
  if (remaining > 0 && existingPunch > fovPunch) return;

  game.__impactLensSeconds = duration;
  game.__impactLensDuration = duration;
  game.__impactLensFovPunch = fovPunch;
  game.camera.userData.tpsImpactLensPulse = 1;
  game.camera.userData.tpsImpactLensFovPunch = fovPunch;
}

export function installTpsImpactLensPulsePresentation(): void {
  if (installed) return;
  installed = true;

  const prototype = TpsFightGame.prototype as unknown as TpsPrototype;
  const baseResolveAttack = prototype.resolveAttack;
  const baseUpdateCamera = prototype.updateCamera;
  const baseResetRound = prototype.resetRound;

  prototype.resolveAttack = function resolveAttackWithImpactLens(
    attacker: FighterRuntime,
    defender: FighterRuntime,
    defenderGuarding: boolean,
  ): void {
    const game = runtime(this as unknown as TpsFightGame);
    const move = attacker.currentMove;
    const alreadyResolved = !move || attacker.hitTargets.has(defender.id);
    const beforeHealth = defender.health;
    const beforeBlockStun = defender.blockStun;
    const beforeHitStop = defender.hitStop;
    const beforeState = defender.state;

    baseResolveAttack.call(this, attacker, defender, defenderGuarding);
    if (!move || alreadyResolved || !attacker.hitTargets.has(defender.id)) return;

    const blocked = defender.blockStun > beforeBlockStun || defender.state === "BLOCK_STUN";
    const madeContact = defender.health < beforeHealth || blocked || defender.hitStop > beforeHitStop;
    if (!madeContact) return;

    // FINAL IMPACT already owns the stronger 3.2-degree hold in tps-game.
    const lethal = !blocked && beforeHealth > 0 && defender.health <= 0;
    if (lethal) return;

    const counter = !blocked && beforeState === "ATTACK";
    const heavy = move.power >= 1.45 || Boolean(move.knockdown) || Boolean(move.launcher);
    const medium = move.power >= 1.12;
    const fovPunch = blocked
      ? BLOCK_FOV_PUNCH
      : counter
        ? COUNTER_FOV_PUNCH
        : heavy
          ? HEAVY_FOV_PUNCH
          : medium
            ? MEDIUM_FOV_PUNCH
            : LIGHT_FOV_PUNCH;
    const duration = counter
      ? COUNTER_PULSE_SECONDS
      : heavy
        ? HEAVY_PULSE_SECONDS
        : medium
          ? MEDIUM_PULSE_SECONDS
          : LIGHT_PULSE_SECONDS;

    startImpactLensPulse(game, fovPunch, duration);
    game.camera.userData.tpsImpactLensMove = move.id;
    game.camera.userData.tpsImpactLensBlocked = blocked;
    game.camera.userData.tpsImpactLensCounter = counter;
  };

  prototype.updateCamera = function updateCameraWithImpactLens(delta: number): void {
    baseUpdateCamera.call(this, delta);
    const game = runtime(this as unknown as TpsFightGame);
    const seconds = game.__impactLensSeconds ?? 0;
    const duration = Math.max(0.001, game.__impactLensDuration ?? 0.001);
    const fovPunch = game.__impactLensFovPunch ?? 0;

    if (seconds <= 0 || fovPunch <= 0 || game.camera.userData.tpsFinalImpactStage === "HOLD") {
      game.__impactLensSeconds = 0;
      game.camera.userData.tpsImpactLensPulse = 0;
      return;
    }

    game.__impactLensSeconds = Math.max(0, seconds - delta);
    const normalized = THREE.MathUtils.clamp(game.__impactLensSeconds / duration, 0, 1);
    // Fast attack, softer release: contact reads immediately without leaving a
    // lingering zoom that would fight the shoulder-camera tracking after hit-stop.
    const envelope = Math.pow(normalized, 0.58);
    const baseFov = game.camera.aspect < 2.4 ? 49 : 47;
    const targetFov = baseFov - fovPunch * envelope;
    const response = 1 - Math.exp(-28 * delta);
    game.camera.fov = THREE.MathUtils.lerp(game.camera.fov, targetFov, response);
    game.camera.updateProjectionMatrix();
    game.camera.userData.tpsImpactLensPulse = envelope;

    if (game.__impactLensSeconds <= 0) {
      game.__impactLensFovPunch = 0;
      game.__impactLensDuration = 0;
    }
  };

  prototype.resetRound = function resetRoundWithImpactLens(): void {
    baseResetRound.call(this);
    const game = runtime(this as unknown as TpsFightGame);
    game.__impactLensSeconds = 0;
    game.__impactLensDuration = 0;
    game.__impactLensFovPunch = 0;
    game.camera.userData.tpsImpactLensPulse = 0;
    game.camera.userData.tpsImpactLensFovPunch = 0;
    game.camera.userData.tpsImpactLensMove = null;
    game.camera.userData.tpsImpactLensBlocked = false;
    game.camera.userData.tpsImpactLensCounter = false;
  };
}

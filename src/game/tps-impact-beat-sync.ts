import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { TpsFightGame } from "./tps-game";
import {
  TpsHypeDirector,
  tpsHypeHitStopForTier,
  tpsHypeImpactTier,
} from "./tps-hype";
import type { HitEvent } from "./types";

const FIXED_HZ = 60;
const LIGHT_RELEASE_SECONDS = 0.10;
const MEDIUM_RELEASE_SECONDS = 0.14;
const HEAVY_RELEASE_SECONDS = 0.18;
const COUNTER_RELEASE_SECONDS = 0.21;

type HypeBeatState = {
  holdSeconds: number;
  holdDuration: number;
  releaseSeconds: number;
  releaseDuration: number;
  serial: number;
};

type ImpactBeatGameRuntime = TpsFightGame & {
  __impactLensSeconds?: number;
  __impactBeatLensHoldSeconds?: number;
  __impactBeatLensHoldDuration?: number;
};

type TpsPrototype = {
  resolveAttack(attacker: FighterRuntime, defender: FighterRuntime, defenderGuarding: boolean): void;
  updateCamera(delta: number): void;
  resetRound(): void;
};

const hypeStates = new WeakMap<TpsHypeDirector, HypeBeatState>();
let installed = false;

function ensureHypeState(director: TpsHypeDirector): HypeBeatState {
  let state = hypeStates.get(director);
  if (state) return state;
  state = {
    holdSeconds: 0,
    holdDuration: 0,
    releaseSeconds: 0,
    releaseDuration: 0,
    serial: 0,
  };
  hypeStates.set(director, state);
  return state;
}

function releaseDurationFor(event: HitEvent, tier: 1 | 2 | 3): number {
  if (event.counter && !event.blocked) return COUNTER_RELEASE_SECONDS;
  if (tier === 3) return HEAVY_RELEASE_SECONDS;
  if (tier === 2) return MEDIUM_RELEASE_SECONDS;
  return LIGHT_RELEASE_SECONDS;
}

function gameRuntime(game: TpsFightGame): ImpactBeatGameRuntime {
  return game as unknown as ImpactBeatGameRuntime;
}

export function installTpsImpactBeatSyncPresentation(): void {
  if (installed) return;
  installed = true;

  const baseHypeHit = TpsHypeDirector.prototype.hit;
  const baseHypeUpdate = TpsHypeDirector.prototype.update;
  const baseHypeReset = TpsHypeDirector.prototype.reset;
  const baseHypeDispose = TpsHypeDirector.prototype.dispose;

  TpsHypeDirector.prototype.hit = function hitWithImpactBeatSync(
    event: HitEvent,
    camera: THREE.PerspectiveCamera,
  ): void {
    baseHypeHit.call(this, event, camera);

    const state = ensureHypeState(this);
    const tier = event.blocked ? 1 : tpsHypeImpactTier(event.move.id, event.move.power);
    const holdSeconds = tpsHypeHitStopForTier(tier, event.blocked) / FIXED_HZ;
    const releaseSeconds = releaseDurationFor(event, tier);

    state.holdSeconds = Math.max(state.holdSeconds, holdSeconds);
    state.holdDuration = Math.max(state.holdDuration, holdSeconds);
    state.releaseSeconds = releaseSeconds;
    state.releaseDuration = releaseSeconds;
    state.serial += 1;

    this.group.userData.tpsImpactBeatSerial = state.serial;
    this.group.userData.tpsImpactBeatStage = holdSeconds > 0 ? "HITSTOP_HOLD" : "IMPACT_RELEASE";
    this.group.userData.tpsImpactBeatHoldSeconds = holdSeconds;
    this.group.userData.tpsImpactBeatReleaseSeconds = releaseSeconds;
    this.group.userData.tpsImpactBeatTier = tier;
    this.group.userData.tpsImpactBeatCounter = event.counter;
    this.group.userData.tpsImpactBeatMove = event.move.id;
  };

  TpsHypeDirector.prototype.update = function updateWithImpactBeatSync(
    camera: THREE.PerspectiveCamera,
    delta: number,
  ): void {
    const state = ensureHypeState(this);

    if (state.holdSeconds > 0) {
      // Keep the authored contact frame, shock ring, burst spokes, impact focus,
      // FOV punch and camera offset coherent for exactly the gameplay hit-stop.
      // Passing delta=0 freezes only the hype presentation timers. The normal
      // game simulation already owns the actual hit-stop and remains untouched.
      baseHypeUpdate.call(this, camera, 0);
      state.holdSeconds = Math.max(0, state.holdSeconds - delta);
      const holdProgress = state.holdDuration > 0
        ? THREE.MathUtils.clamp(state.holdSeconds / state.holdDuration, 0, 1)
        : 0;
      this.group.userData.tpsImpactBeatStage = state.holdSeconds > 0
        ? "HITSTOP_HOLD"
        : "IMPACT_RELEASE";
      this.group.userData.tpsImpactBeatHoldProgress = holdProgress;
      return;
    }

    baseHypeUpdate.call(this, camera, delta);

    if (state.releaseSeconds > 0) {
      state.releaseSeconds = Math.max(0, state.releaseSeconds - delta);
      const releaseProgress = state.releaseDuration > 0
        ? THREE.MathUtils.clamp(state.releaseSeconds / state.releaseDuration, 0, 1)
        : 0;
      this.group.userData.tpsImpactBeatStage = state.releaseSeconds > 0
        ? "IMPACT_RELEASE"
        : "SETTLED";
      this.group.userData.tpsImpactBeatReleaseProgress = releaseProgress;
    }
  };

  TpsHypeDirector.prototype.reset = function resetWithImpactBeatSync(
    camera: THREE.PerspectiveCamera,
  ): void {
    baseHypeReset.call(this, camera);
    const state = ensureHypeState(this);
    state.holdSeconds = 0;
    state.holdDuration = 0;
    state.releaseSeconds = 0;
    state.releaseDuration = 0;
    this.group.userData.tpsImpactBeatStage = null;
    this.group.userData.tpsImpactBeatHoldProgress = 0;
    this.group.userData.tpsImpactBeatReleaseProgress = 0;
  };

  TpsHypeDirector.prototype.dispose = function disposeWithImpactBeatSync(): void {
    hypeStates.delete(this);
    baseHypeDispose.call(this);
  };

  const prototype = TpsFightGame.prototype as unknown as TpsPrototype;
  const baseResolveAttack = prototype.resolveAttack;
  const baseUpdateCamera = prototype.updateCamera;
  const baseResetRound = prototype.resetRound;

  prototype.resolveAttack = function resolveAttackWithImpactBeatSync(
    attacker: FighterRuntime,
    defender: FighterRuntime,
    defenderGuarding: boolean,
  ): void {
    const game = gameRuntime(this as unknown as TpsFightGame);
    const move = attacker.currentMove;
    const alreadyResolved = !move || attacker.hitTargets.has(defender.id);
    const beforeHealth = defender.health;
    const beforeBlockStun = defender.blockStun;
    const beforeHitStop = defender.hitStop;

    baseResolveAttack.call(this, attacker, defender, defenderGuarding);
    if (!move || alreadyResolved || !attacker.hitTargets.has(defender.id)) return;

    const blocked = defender.blockStun > beforeBlockStun || defender.state === "BLOCK_STUN";
    const madeContact = defender.health < beforeHealth || blocked || defender.hitStop > beforeHitStop;
    if (!madeContact) return;

    // The lens pulse installer runs immediately inside baseResolveAttack because
    // this synchronizer is installed last. Preserve its full-strength lens-in
    // for the same shared hit-stop, then let the existing envelope perform the
    // release. FINAL IMPACT deliberately owns its separate lethal camera hold.
    const lethal = !blocked && beforeHealth > 0 && defender.health <= 0;
    if (lethal || (game.__impactLensSeconds ?? 0) <= 0) return;

    const holdSeconds = Math.max(0, defender.hitStop) / FIXED_HZ;
    game.__impactBeatLensHoldSeconds = holdSeconds;
    game.__impactBeatLensHoldDuration = holdSeconds;
    game.camera.userData.tpsImpactBeatLensStage = holdSeconds > 0 ? "HITSTOP_HOLD" : "IMPACT_RELEASE";
    game.camera.userData.tpsImpactBeatLensHoldSeconds = holdSeconds;
  };

  prototype.updateCamera = function updateCameraWithImpactBeatSync(delta: number): void {
    const game = gameRuntime(this as unknown as TpsFightGame);
    const lensSecondsBeforeUpdate = game.__impactLensSeconds ?? 0;

    baseUpdateCamera.call(this, delta);

    const holdSeconds = game.__impactBeatLensHoldSeconds ?? 0;
    if (
      holdSeconds > 0
      && lensSecondsBeforeUpdate > 0
      && game.camera.userData.tpsFinalImpactStage !== "HOLD"
    ) {
      // Let the lens physically converge toward its punched FOV, but restore its
      // envelope timer so recovery cannot begin until gameplay hit-stop releases.
      game.__impactLensSeconds = lensSecondsBeforeUpdate;
      game.__impactBeatLensHoldSeconds = Math.max(0, holdSeconds - delta);
      const duration = Math.max(0.001, game.__impactBeatLensHoldDuration ?? 0.001);
      game.camera.userData.tpsImpactBeatLensStage = (game.__impactBeatLensHoldSeconds ?? 0) > 0
        ? "HITSTOP_HOLD"
        : "IMPACT_RELEASE";
      game.camera.userData.tpsImpactBeatLensHoldProgress = THREE.MathUtils.clamp(
        (game.__impactBeatLensHoldSeconds ?? 0) / duration,
        0,
        1,
      );
    } else if (holdSeconds <= 0 && lensSecondsBeforeUpdate <= 0) {
      game.camera.userData.tpsImpactBeatLensStage = null;
      game.camera.userData.tpsImpactBeatLensHoldProgress = 0;
    }
  };

  prototype.resetRound = function resetRoundWithImpactBeatSync(): void {
    baseResetRound.call(this);
    const game = gameRuntime(this as unknown as TpsFightGame);
    game.__impactBeatLensHoldSeconds = 0;
    game.__impactBeatLensHoldDuration = 0;
    game.camera.userData.tpsImpactBeatLensStage = null;
    game.camera.userData.tpsImpactBeatLensHoldSeconds = 0;
    game.camera.userData.tpsImpactBeatLensHoldProgress = 0;
  };
}

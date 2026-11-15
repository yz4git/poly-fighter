import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { PresentationAnimationController } from "./presentation-animation";

export const TPS_COMBO_LANE_BRIDGE_VERSION = "CONFIRMED_COMBO_HOST_CONTINUITY_V1";

type ComboLaneBridgeState = {
  lastHost: THREE.Object3D | null;
  lastHostWorld: THREE.Vector3 | null;
  lastGamePosition: THREE.Vector3 | null;
  lastMove: string | null;
  lastState: string;
  appliedHost: THREE.Object3D | null;
  appliedLocal: THREE.Vector3;
  sourceLocal: THREE.Vector3;
  targetMove: string | null;
  sourceMove: string | null;
  lastLinkTick: number;
};

const states = new WeakMap<FighterRuntime, ComboLaneBridgeState>();
const CLOSE_PUNCH_BASES = new Set(["jab", "straight", "bodyBlow"]);
let installed = false;

function importedHost(fighter: FighterRuntime): THREE.Object3D | null {
  return fighter.visual.root.children.find((node) =>
    node.name.startsWith("quaternius-ubc-") && node.name.endsWith("-runtime")) ?? null;
}

function smooth01(t: number): number {
  const a = THREE.MathUtils.clamp(t, 0, 1);
  return a * a * (3 - 2 * a);
}

/** Preserve the incoming strike's true contact frame: all carried offsets
 * are gone before ACTIVE starts, including fast three-tick SNAP variants. */
export function tpsConfirmedComboLaneCarry(tick: number, startup: number): number {
  if (!Number.isFinite(tick) || !Number.isFinite(startup) || startup <= 0) return 0;
  return 1 - smooth01(tick / Math.max(1, startup));
}

/** A fresh, actual TPS clean-contact link is required. Do not interpolate a
 * whiff, idle->attack, throw, kick, guard or fresh unrelated engagement. */
export function tpsShouldBridgeConfirmedCombo(input: {
  lastState: string;
  currentState: string;
  lastMove: string | null;
  newMove: string | null;
  previousFamily: string | null;
  linkState: unknown;
  linkFromMove: unknown;
}): boolean {
  return input.lastState === "ATTACK"
    && input.currentState === "ATTACK"
    && !!input.lastMove
    && !!input.newMove
    && input.lastMove !== input.newMove
    && !!input.previousFamily
    && CLOSE_PUNCH_BASES.has(input.previousFamily)
    && input.linkState === "LINKED"
    && input.linkFromMove === input.lastMove;
}

function ensureState(fighter: FighterRuntime): ComboLaneBridgeState {
  let state = states.get(fighter);
  if (state) return state;
  state = {
    lastHost: null, lastHostWorld: null, lastGamePosition: null,
    lastMove: null, lastState: "", appliedHost: null,
    appliedLocal: new THREE.Vector3(), sourceLocal: new THREE.Vector3(),
    targetMove: null, sourceMove: null, lastLinkTick: -1,
  };
  states.set(fighter, state);
  return state;
}

/**
 * A clean jab link replaces the authored clip and drops its close-punch lane
 * on the same 60 Hz frame. That can displace the whole imported mesh by nearly
 * half a world unit although gameplay root is still exactly stationary.
 * Bridge only that presentation-host discontinuity and ease it back into the
 * new clip's authored position by ACTIVE contact. Never freeze/carry feet IK.
 */
export function installTpsComboLaneBridgePresentation(): void {
  if (installed) return;
  installed = true;

  const baseUpdate = PresentationAnimationController.prototype.update;
  PresentationAnimationController.prototype.update = function updateWithTpsComboLaneBridge(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    timeSeconds: number,
  ): void {
    const state = ensureState(fighter);
    const root = fighter.visual.root;
    const previousHost = state.lastHost;
    const lastWorld = state.lastHostWorld?.clone() ?? null;
    const lastPosition = state.lastGamePosition?.clone() ?? null;
    const beforeMove = state.lastMove;
    const beforeState = state.lastState;

    // Never accumulate the prior frame's presentation offset, including
    // when the gameplay moveTick is held steady during hitstop or camera shots.
    if (state.appliedHost) state.appliedHost.position.sub(state.appliedLocal);
    state.appliedHost = null;
    state.appliedLocal.set(0, 0, 0);

    baseUpdate.call(this, fighter, opponent, timeSeconds);

    const host = importedHost(fighter);
    const move = fighter.currentMove;
    const moveId = fighter.state === "ATTACK" ? move?.id ?? null : null;
    const data = root.userData;

    const previousFamily = beforeMove
      ? beforeMove.replace(/(?:Snap|Drive|Pivot|Crush)$/, "")
      : null;
    const linked = host && host === previousHost && lastWorld && lastPosition
      && tpsShouldBridgeConfirmedCombo({
        lastState: beforeState,
        currentState: fighter.state,
        lastMove: beforeMove,
        newMove: moveId,
        previousFamily,
        linkState: data.tpsComboLinkState,
        linkFromMove: data.tpsComboLinkFromMove,
      });

    if (linked && moveId && move) {
      // The old host was sampled *after* its outgoing punch lane. The new
      // host has the new clip plus all inner authored presentation layers.
      // Keep horizontal continuity in world space; preserve real actor travel.
      root.updateMatrixWorld(true);
      const currentWorld = host.getWorldPosition(new THREE.Vector3());
      const intendedWorld = lastWorld.add(fighter.position.clone().sub(lastPosition));
      const difference = intendedWorld.sub(currentWorld);
      difference.y = 0;
      const length = difference.length();
      // A very large discontinuity may be a genuine teleport or a changing
      // model. Never try to mask one with an exaggerated limb translation.
      if (Number.isFinite(length) && length < 0.65) {
        const localFrom = root.worldToLocal(currentWorld.clone());
        const localTo = root.worldToLocal(currentWorld.clone().add(difference));
        state.sourceLocal.copy(localTo.sub(localFrom));
        state.targetMove = moveId;
        state.sourceMove = beforeMove;
        state.lastLinkTick = Number(data.tpsComboLinkTick ?? -1);
      } else {
        state.targetMove = null;
        state.sourceMove = null;
      }
    }

    const carry = host && moveId && fighter.grounded && state.targetMove === moveId
      && move && data.combatTps && data.quaterniusModelState === "ready"
      ? tpsConfirmedComboLaneCarry(fighter.moveTick, move.startup)
      : 0;
    if (carry > 1e-4 && host) {
      state.appliedHost = host;
      state.appliedLocal.copy(state.sourceLocal).multiplyScalar(carry);
      host.position.add(state.appliedLocal);
      root.updateMatrixWorld(true);
    } else if (!moveId || !move || fighter.moveTick >= move.startup || !fighter.grounded) {
      state.targetMove = null;
      state.sourceMove = null;
      state.sourceLocal.set(0, 0, 0);
    }

    data.tpsComboLaneBridgeVersion = TPS_COMBO_LANE_BRIDGE_VERSION;
    data.tpsComboLaneBridgeFactor = carry;
    data.tpsComboLaneBridgeLocalX = state.appliedLocal.x;
    data.tpsComboLaneBridgeLocalZ = state.appliedLocal.z;
    data.tpsComboLaneBridgeSourceMove = state.sourceMove;
    data.tpsComboLaneBridgeTargetMove = state.targetMove;
    data.tpsComboLaneBridgeLinkTick = state.lastLinkTick;

    state.lastHost = host;
    state.lastHostWorld = host?.getWorldPosition(new THREE.Vector3()) ?? null;
    state.lastGamePosition = fighter.position.clone();
    state.lastMove = moveId;
    state.lastState = fighter.state;
  };
}

import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { PresentationAnimationController } from "./presentation-animation";

type CloseNeutralLaneState = {
  host: THREE.Object3D | null;
  positionX: number;
  rotationY: number;
};

const states = new WeakMap<FighterRuntime, CloseNeutralLaneState>();
let installed = false;

const CLOSE_NEUTRAL_STATES = new Set<FighterRuntime["state"]>([
  "IDLE",
  "WALK",
  "CROUCH",
  "GUARD",
]);
const CLOSE_NEUTRAL_MAX_LANE = 0.062;
const CLOSE_NEUTRAL_MAX_YAW = 0.044;

function ensureState(fighter: FighterRuntime): CloseNeutralLaneState {
  let state = states.get(fighter);
  if (state) return state;
  state = { host: null, positionX: 0, rotationY: 0 };
  states.set(fighter, state);
  return state;
}

function importedRuntimeHost(fighter: FighterRuntime): THREE.Object3D | null {
  return fighter.visual.root.children.find(
    (child) => child.name.startsWith("quaternius-ubc-") && child.name.endsWith("-runtime"),
  ) ?? null;
}

function residueActive(fighter: FighterRuntime): boolean {
  const data = fighter.visual.root.userData;
  return Math.max(
    Number(data.tpsAttackAfterfeel ?? 0),
    Number(data.tpsDamageAfterfeel ?? 0),
    Number(data.tpsPunishReadyPose ?? 0),
  ) > 1e-4;
}

function smooth01(value: number): number {
  const clamped = THREE.MathUtils.clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function enemyStartupLaneFactor(fighter: FighterRuntime, opponent: FighterRuntime): number {
  for (const candidate of [fighter, opponent]) {
    const root = candidate.visual.root;
    const move = candidate.currentMove;
    if (
      candidate.state !== "ATTACK"
      || !move
      || root.userData.tpsEnemyTelegraphPhase !== "STRIKE"
      || String(root.userData.tpsCpuDirectorMove ?? "") !== move.id
      || ["throw", "dashKick"].includes(move.id)
    ) continue;

    // Match the short WINDUP -> STRIKE body-pose handoff. Keep the neutral
    // screen-lane separation only through the earliest startup frames, then
    // release it before active contact so hit spacing and impact staging remain
    // visually authoritative.
    const handoffTicks = Math.max(3, Math.min(5, Math.floor(move.startup * 0.5)));
    return 1 - smooth01(candidate.moveTick / Math.max(1, handoffTicks));
  }
  return 0;
}

function removeCloseNeutralLane(fighter: FighterRuntime, state: CloseNeutralLaneState): void {
  if (state.host) {
    state.host.position.x -= state.positionX;
    state.host.rotation.y -= state.rotationY;
  }
  state.host = null;
  state.positionX = 0;
  state.rotationY = 0;
  fighter.visual.root.userData.tpsCloseNeutralLane = 0;
  fighter.visual.root.userData.tpsCloseNeutralLaneMode = "NONE";
}

function applyCloseNeutralLane(
  fighter: FighterRuntime,
  opponent: FighterRuntime,
  state: CloseNeutralLaneState,
): void {
  const root = fighter.visual.root;
  const opponentRoot = opponent.visual.root;
  if (
    !root.userData.combatTps
    || root.userData.quaterniusModelState !== "ready"
    || opponentRoot.userData.quaterniusModelState !== "ready"
    || residueActive(fighter)
    || residueActive(opponent)
  ) return;

  const neutralEligible = CLOSE_NEUTRAL_STATES.has(fighter.state)
    && CLOSE_NEUTRAL_STATES.has(opponent.state)
    && !fighter.currentMove
    && !opponent.currentMove;
  const startupHandoff = enemyStartupLaneFactor(fighter, opponent);
  if (!neutralEligible && startupHandoff <= 1e-4) return;

  const dx = opponent.position.x - fighter.position.x;
  const dz = opponent.position.z - fighter.position.z;
  const distance = Math.hypot(dx, dz);
  if (!Number.isFinite(distance) || distance >= 1.95) return;

  // The camera-continuity path ends in close neutral locomotion rather than a
  // strike. At that range the two production meshes can occupy the same screen
  // lane even though gameplay spacing is valid. Open only the imported render
  // hosts as distance closes. Because the fighters face each other, the same
  // local-X offset moves them into opposite world-space lanes. Runtime position,
  // collision, targeting, ground rings and camera math stay authoritative.
  // When the CPU commits to a telegraphed strike, briefly carry that same lane
  // into startup instead of snapping both meshes back onto one screen axis.
  const proximity = 1 - THREE.MathUtils.smoothstep(distance, 1.30, 1.95);
  const phaseFactor = neutralEligible ? 1 : startupHandoff;
  const factor = THREE.MathUtils.clamp(proximity * phaseFactor, 0, 1);
  if (factor <= 1e-4) return;

  const host = importedRuntimeHost(fighter);
  if (!host) return;

  const scale = root.scale.x;
  state.host = host;
  // Keep the audited lateral lane fixed so feet stay visually married to their
  // authoritative floor markers. Use a slightly stronger facing angle instead:
  // at the closest neutral spacing this exposes more chest/shoulder silhouette
  // without increasing visual root travel or changing gameplay/camera math.
  state.positionX = CLOSE_NEUTRAL_MAX_LANE * scale * factor;
  state.rotationY = CLOSE_NEUTRAL_MAX_YAW * factor;
  host.position.x += state.positionX;
  host.rotation.y += state.rotationY;

  root.userData.tpsCloseNeutralLane = factor;
  root.userData.tpsCloseNeutralLaneMode = neutralEligible ? "NEUTRAL" : "ATTACK_HANDOFF";
  root.userData.tpsCloseNeutralLaneX = state.positionX;
  root.userData.tpsCloseNeutralLaneYaw = state.rotationY;
  root.userData.tpsCloseNeutralLaneDistance = distance;
  root.userData.tpsCloseNeutralLaneStartup = startupHandoff;
  root.updateMatrixWorld(true);
}

export function installTpsCloseNeutralLanePresentation(): void {
  if (installed) return;
  installed = true;

  const baseUpdate = PresentationAnimationController.prototype.update;
  PresentationAnimationController.prototype.update = function updateWithTpsCloseNeutralLane(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    timeSeconds: number,
  ): void {
    const state = ensureState(fighter);
    removeCloseNeutralLane(fighter, state);
    baseUpdate.call(this, fighter, opponent, timeSeconds);
    applyCloseNeutralLane(fighter, opponent, state);
  };
}

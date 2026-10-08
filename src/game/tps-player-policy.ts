import * as THREE from "three";
import { resolveContextAttack, type ContextAttackChoice } from "./fighter-dna";
import type { FighterState, MoveDefinition, InputFrame } from "./types";

export const TPS_CLOSE_ORBIT_SPEED_SCALE = 0.65;

export type TpsInputAxes = {
  forwardAxis: number;
  sideAxis: number;
};

export type TpsStepPlan = {
  stepVector: THREE.Vector3;
  forwardWeight: number;
  sideWeight: number;
  evadeSign: number;
};

export type TpsContextAttackPlan = {
  choice: ContextAttackChoice;
  reversalStrike: boolean;
  flankStrike: boolean;
  interceptStrike: boolean;
  nextComboStage: number;
};

export function planTpsContextAttack(input: {
  fighterName: string;
  distance: number;
  comboStage: number;
  playerReversalTicks: number;
  playerStepSideWeight: number;
  playerFlankWindowTicks: number;
  playerInterceptTicks: number;
  defenderState: FighterState;
  defenderNearWall: boolean;
  selfHealth: number;
  defenderHealth: number;
}): TpsContextAttackPlan {
  const stage = Math.min(2, input.comboStage);
  const reversalStrike = input.playerReversalTicks > 0
    && input.playerStepSideWeight > 0.45;
  const flankStrike = input.playerFlankWindowTicks > 0
    && input.playerStepSideWeight > 0.45;
  const interceptStrike = input.playerInterceptTicks > 0;
  const choice = resolveContextAttack({
    fighterName: input.fighterName,
    distance: input.distance,
    comboStage: stage,
    flankOpen: flankStrike,
    reversalOpen: reversalStrike,
    interceptOpen: interceptStrike,
    defenderAttacking: input.defenderState === "ATTACK",
    defenderNearWall: input.defenderNearWall,
    selfHealth: input.selfHealth,
    defenderHealth: input.defenderHealth,
  });
  return {
    choice,
    reversalStrike,
    flankStrike,
    interceptStrike,
    nextComboStage: reversalStrike ? 1 : stage + 1,
  };
}

export function tpsInputAxes(input: InputFrame): TpsInputAxes {
  return {
    forwardAxis: (input.up ? 1 : 0) - (input.down ? 1 : 0),
    sideAxis: (input.right ? 1 : 0) - (input.left ? 1 : 0),
  };
}

export function composeTpsMoveVector(
  toEnemy: THREE.Vector3,
  right: THREE.Vector3,
  axes: TpsInputAxes,
): THREE.Vector3 {
  return toEnemy.clone()
    .multiplyScalar(axes.forwardAxis)
    .addScaledVector(right, axes.sideAxis);
}

export function planTpsStep(
  move: THREE.Vector3,
  toEnemy: THREE.Vector3,
  right: THREE.Vector3,
  sideAxis: number,
): TpsStepPlan {
  const stepVector = move.lengthSq() > 0.001
    ? move.clone().normalize()
    : toEnemy.clone().multiplyScalar(-1);
  return {
    stepVector,
    forwardWeight: stepVector.dot(toEnemy),
    sideWeight: Math.abs(stepVector.dot(right)),
    evadeSign: sideAxis === 0 ? 0 : sideAxis > 0 ? 1 : -1,
  };
}

export function tpsPlayerMoveSpeed(
  archetype: "POWER" | "SPEED",
  moveSpeedScale: number,
): number {
  return (archetype === "SPEED" ? 4.0 : 3.35) * moveSpeedScale;
}

export function tpsStepSpeedMultiplier(
  archetype: "POWER" | "SPEED",
  forwardWeight: number,
  stepSpeedScale: number,
): number {
  const baseStepMultiplier = archetype === "SPEED" ? 2.55 : 2.45;
  const directionalStepBonus = forwardWeight < -0.45
    ? 0.48
    : forwardWeight > 0.45
      ? -0.16
      : 0.08;
  return (baseStepMultiplier + directionalStepBonus) * stepSpeedScale;
}

export function tpsCloseLocomotionSpeedScale(
  fightDistance: number,
  forwardAxis: number,
  sideAxis: number,
): number {
  const closeOrbitFactor = THREE.MathUtils.clamp((2.6 - fightDistance) / 1.7, 0, 1);
  const lateralInputWeight = Math.abs(sideAxis)
    / Math.max(1, Math.abs(forwardAxis) + Math.abs(sideAxis));
  const closeOrbitScale = THREE.MathUtils.lerp(
    1,
    TPS_CLOSE_ORBIT_SPEED_SCALE,
    closeOrbitFactor,
  );
  return THREE.MathUtils.lerp(1, closeOrbitScale, lateralInputWeight);
}

export function tpsReactiveStepThreat(input: {
  sideWeight: number;
  activeIncomingMove: MoveDefinition | null;
  pendingMove: MoveDefinition | null;
  pendingMoveId: string | null;
  pendingReaction: boolean;
  pendingTelegraphTicks: number;
  enemyMoveTick: number;
  incomingDistance: number;
  stepTicks: number;
}): { ticks: number; moveId: string | null } {
  const incomingMove = input.activeIncomingMove
    ?? (input.pendingReaction ? input.pendingMove : null);
  const incomingThreatReach = incomingMove
    ? incomingMove.reach + (input.pendingMoveId === "dashKick" ? 1.8 : 0.9)
    : 0;
  const incomingFrames = input.activeIncomingMove
    ? input.activeIncomingMove.startup + input.activeIncomingMove.active - input.enemyMoveTick
    : input.pendingReaction && incomingMove
      ? input.pendingTelegraphTicks + incomingMove.startup + incomingMove.active
      : 0;
  const reactiveSideStep = Boolean(
    input.sideWeight > 0.45
    && incomingMove
    && incomingMove.hitLevel !== "THROW"
    && incomingFrames > 0
    && input.incomingDistance <= incomingThreatReach
  );
  return {
    ticks: reactiveSideStep
      // The physical sidestep must occur near contact. A STEP triggered long
      // before startup cannot bank an automatic perfect evade for the future.
      ? Math.min(input.stepTicks + 6, Math.max(input.stepTicks, incomingFrames + 1))
      : 0,
    moveId: reactiveSideStep ? incomingMove?.id ?? null : null,
  };
}

export function tpsLegacyThrowPressed(
  input: InputFrame,
  stepPressed: boolean,
  legacyKickPressed: boolean,
): boolean {
  return input.guard && input.kick && (stepPressed || legacyKickPressed);
}

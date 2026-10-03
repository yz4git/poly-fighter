import type { FighterRuntime } from "./fighter";

export type TpsWinner = "p1" | "p2" | "draw";

export const TPS_KO_MIN_SHOW_TICKS = 72;
export const TPS_KO_SETTLED_HOLD_TICKS = 30;
export const TPS_KO_MAX_SHOW_TICKS = 150;

export function tpsWinnerForHealth(p1Health: number, p2Health: number): TpsWinner {
  return p1Health === p2Health ? "draw" : p1Health > p2Health ? "p1" : "p2";
}

export function defeatedFighterForWinner(
  winner: TpsWinner | null,
  p1: FighterRuntime,
  p2: FighterRuntime,
): FighterRuntime | null {
  return winner === "p1" ? p2 : winner === "p2" ? p1 : null;
}

export function isTpsDefeatedSettled(defeated: FighterRuntime | null): boolean {
  return !defeated
    || (defeated.grounded && defeated.position.y <= 0.001 && Math.abs(defeated.velocity.y) <= 0.001);
}

export function advanceTpsFinishWindow(
  ticks: number,
  settledTicks: number,
  settled: boolean,
): { ticks: number; settledTicks: number; complete: boolean } {
  const nextTicks = ticks + 1;
  const nextSettledTicks = settled ? settledTicks + 1 : 0;
  const landingShown = nextTicks >= TPS_KO_MIN_SHOW_TICKS
    && nextSettledTicks >= TPS_KO_SETTLED_HOLD_TICKS;
  return {
    ticks: nextTicks,
    settledTicks: nextSettledTicks,
    complete: landingShown || nextTicks >= TPS_KO_MAX_SHOW_TICKS,
  };
}

import { FighterRuntime } from "./fighter";

export type RoundPhase = "INTRO" | "FIGHT" | "ROUND_END" | "RESULT";

export class RoundManager {
  round = 1;
  timerTicks = 60 * 60;
  phase: RoundPhase = "INTRO";
  message = "ROUND 1";
  phaseTicks = 0;

  start(): void {
    this.round = 1;
    this.timerTicks = 60 * 60;
    this.phase = "INTRO";
    this.phaseTicks = 0;
    this.message = "ROUND 1";
  }

  canSimulateCombat(): boolean {
    return this.phase === "FIGHT";
  }

  tick(p1: FighterRuntime, p2: FighterRuntime): { winner: FighterRuntime | null; ringOut: boolean } | null {
    this.phaseTicks += 1;
    if (this.phase === "INTRO") {
      if (this.phaseTicks > 90) {
        this.phase = "FIGHT";
        this.phaseTicks = 0;
        this.message = "FIGHT";
      }
      return null;
    }
    if (this.phase !== "FIGHT") return null;
    this.timerTicks = Math.max(0, this.timerTicks - 1);
    const p1Out = p1.state === "RING_OUT";
    const p2Out = p2.state === "RING_OUT";
    if (p1.health <= 0 || p2.health <= 0 || p1Out || p2Out || this.timerTicks <= 0) {
      const winner = p1Out ? p2 : p2Out ? p1 : p1.health === p2.health ? null : p1.health > p2.health ? p1 : p2;
      this.phase = "ROUND_END";
      this.phaseTicks = 0;
      this.message = p1Out || p2Out ? "RING OUT" : winner ? "KO" : "TIME UP";
      return { winner, ringOut: p1Out || p2Out };
    }
    return null;
  }

  finishRound(winner: FighterRuntime | null): "NEXT_ROUND" | "MATCH_RESULT" {
    if (winner) winner.wins += 1;
    if (winner && winner.wins >= 2) {
      this.phase = "RESULT";
      this.message = winner.id === "p1" ? "PLAYER 1 WINS" : "PLAYER 2 WINS";
      this.phaseTicks = 0;
      return "MATCH_RESULT";
    }
    this.round += 1;
    this.timerTicks = 60 * 60;
    this.phase = "INTRO";
    this.phaseTicks = 0;
    this.message = `ROUND ${this.round}`;
    return "NEXT_ROUND";
  }
}

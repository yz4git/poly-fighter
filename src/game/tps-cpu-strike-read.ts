import type { HitLevel } from "./types";

/** A CPU only learns a move after its actual visible windup has progressed.
 * One strike contributes ONE sample, regardless of its active/recovery ticks
 * or hitstop. This is observed animation, never the player's live button input.
 */
export const TPS_CPU_VISIBLE_STRIKE_TICKS = 5;
export const TPS_CPU_STRIKE_WINDOW = 8;
export const TPS_CPU_MIN_STRIKE_SAMPLES = 5;
export type TpsCpuStrikeReadMode = "UNSEEN" | "MIXED" | "LOW_PATTERN" | "UPPER_PATTERN";

export type TpsCpuStrikeReadout = Readonly<{
  mode: TpsCpuStrikeReadMode;
  samples: number;
  lowRatio: number;
  upperRatio: number;
  confidence: number;
}>;

type ObservedAttack = {
  state: string;
  moveId: string | null;
  moveTick?: number;
  hitLevel?: HitLevel | null;
};

export class TpsCpuStrikeReader {
  private readonly samples: Array<"LOW" | "UPPER"> = [];
  private lastId: string | null = null;
  private lastTick = -1;
  private counted = false;

  observe(attack: ObservedAttack): void {
    if (attack.state !== "ATTACK" || !attack.moveId) {
      this.lastId = null;
      this.lastTick = -1;
      this.counted = false;
      return;
    }
    const tick = Number.isFinite(attack.moveTick) ? Number(attack.moveTick) : -1;
    if (attack.moveId !== this.lastId || tick < this.lastTick) {
      this.lastId = attack.moveId;
      this.counted = false;
    }
    this.lastTick = tick;
    if (this.counted || tick < TPS_CPU_VISIBLE_STRIKE_TICKS) return;
    if (!["LOW", "MID", "HIGH"].includes(attack.hitLevel ?? "")) return;

    this.samples.push(attack.hitLevel === "LOW" ? "LOW" : "UPPER");
    if (this.samples.length > TPS_CPU_STRIKE_WINDOW) this.samples.shift();
    this.counted = true;
  }

  readout(): TpsCpuStrikeReadout {
    const samples = this.samples.length;
    const lows = this.samples.filter(level => level === "LOW").length;
    const lowRatio = samples ? lows / samples : 0;
    const upperRatio = samples ? 1 - lowRatio : 0;
    const mode: TpsCpuStrikeReadMode = samples < TPS_CPU_MIN_STRIKE_SAMPLES
      ? "UNSEEN" : lowRatio >= .625
        ? "LOW_PATTERN" : upperRatio >= .625
          ? "UPPER_PATTERN" : "MIXED";
    // Confidence rises with independent, visible strikes; one attack held for
    // 50 frames must never count like 8 separate observations.
    return { mode, samples, lowRatio, upperRatio,
      confidence: samples < TPS_CPU_MIN_STRIKE_SAMPLES ? 0
        : Math.min(1, samples / TPS_CPU_STRIKE_WINDOW) * Math.max(lowRatio, upperRatio) };
  }
}

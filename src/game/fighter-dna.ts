export type FighterDnaId = "KAIRO" | "SERA";

export interface FighterDna {
  id: FighterDnaId;
  moveSpeedScale: number;
  stepSpeedScale: number;
  stepCooldownScale: number;
  perfectEvadeBonusTicks: number;
  interceptDamageScale: number;
  reversalDamageScale: number;
  comboPressureScale: number;
  signature: {
    intercept: string;
    reversal: string;
    flank: string;
    desperation: string;
  };
}

export interface ContextAttackSituation {
  fighterName: string;
  distance: number;
  comboStage: number;
  flankOpen: boolean;
  reversalOpen: boolean;
  interceptOpen: boolean;
  defenderAttacking: boolean;
  defenderNearWall: boolean;
  selfHealth: number;
  defenderHealth: number;
}

export interface ContextAttackChoice {
  moveId: string;
  beat: string | null;
  signature: string | null;
}

const DEFAULT_DNA: FighterDna = {
  id: "KAIRO",
  moveSpeedScale: 1,
  stepSpeedScale: 1,
  stepCooldownScale: 1,
  perfectEvadeBonusTicks: 0,
  interceptDamageScale: 1,
  reversalDamageScale: 1,
  comboPressureScale: 1,
  signature: {
    intercept: "INTERCEPT",
    reversal: "REVERSAL",
    flank: "FLANK STRIKE",
    desperation: "FINAL DRIVE",
  },
};

export const FIGHTER_DNA: Readonly<Record<FighterDnaId, FighterDna>> = Object.freeze({
  KAIRO: Object.freeze({
    id: "KAIRO",
    moveSpeedScale: 0.98,
    stepSpeedScale: 0.96,
    stepCooldownScale: 1.08,
    perfectEvadeBonusTicks: 0,
    interceptDamageScale: 1.14,
    reversalDamageScale: 1.16,
    comboPressureScale: 1.08,
    signature: {
      intercept: "BREAK LINE",
      reversal: "RED REVERSAL",
      flank: "FORGE ANGLE",
      desperation: "TERMINAL DRIVE",
    },
  }),
  SERA: Object.freeze({
    id: "SERA",
    moveSpeedScale: 1.08,
    stepSpeedScale: 1.16,
    stepCooldownScale: 0.88,
    perfectEvadeBonusTicks: 5,
    interceptDamageScale: 1.02,
    reversalDamageScale: 1.08,
    comboPressureScale: 0.96,
    signature: {
      intercept: "BLUE SHIFT",
      reversal: "PHANTOM COUNTER",
      flank: "ZERO ANGLE",
      desperation: "PRISM BREAK",
    },
  }),
});

export function fighterDnaForName(name: string): FighterDna {
  const key = name.toUpperCase() as FighterDnaId;
  return FIGHTER_DNA[key] ?? DEFAULT_DNA;
}

export function resolveContextAttack(situation: ContextAttackSituation): ContextAttackChoice {
  const dna = fighterDnaForName(situation.fighterName);
  const kairo = dna.id === "KAIRO";
  const stage = Math.max(0, Math.min(2, situation.comboStage));

  if (situation.reversalOpen) {
    return { moveId: "counter", beat: dna.signature.reversal, signature: dna.signature.reversal };
  }

  if (situation.interceptOpen) {
    return kairo
      ? { moveId: "straight", beat: dna.signature.intercept, signature: dna.signature.intercept }
      : { moveId: "backfist", beat: dna.signature.intercept, signature: dna.signature.intercept };
  }

  if (situation.selfHealth <= 24 && situation.defenderHealth <= 34 && situation.distance <= 1.82) {
    return kairo
      ? { moveId: "power", beat: dna.signature.desperation, signature: dna.signature.desperation }
      : { moveId: "risingKick", beat: dna.signature.desperation, signature: dna.signature.desperation };
  }

  if (situation.flankOpen) {
    return kairo
      ? { moveId: "backfist", beat: dna.signature.flank, signature: dna.signature.flank }
      : { moveId: "bodyBlow", beat: dna.signature.flank, signature: dna.signature.flank };
  }

  if (situation.defenderNearWall && situation.distance <= 1.62) {
    return kairo
      ? { moveId: stage >= 1 ? "power" : "bodyBlow", beat: "WALL PRESSURE", signature: null }
      : { moveId: stage >= 1 ? "lowKick" : "bodyBlow", beat: "ANGLE PRESSURE", signature: null };
  }

  if (situation.defenderAttacking && situation.distance <= 1.48) {
    return { moveId: "counter", beat: "COUNTER READ", signature: null };
  }

  if (situation.distance <= 1.58) {
    const closeMoves = kairo ? ["jab", "straight", "power"] : ["jab", "bodyBlow", "straight"];
    return { moveId: closeMoves[stage], beat: null, signature: null };
  }

  const farMoves = kairo ? ["kick", "straight", "risingKick"] : ["kick", "lowKick", "risingKick"];
  return { moveId: farMoves[stage], beat: null, signature: null };
}

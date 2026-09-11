import { registerBrontFighter, BRONT_FIGHTER_ID } from "./fighter-bront";
import { RIVAL_CIRCUIT_ENCOUNTERS, type RivalCircuitEncounter } from "./rival-circuit";

let registered = false;

function mutableEncounter(encounter: RivalCircuitEncounter): {
  fighterId: string;
  description: string;
  rule: string;
} {
  return encounter as unknown as {
    fighterId: string;
    description: string;
    rule: string;
  };
}

export function registerBrontCircuitRival(): RivalCircuitEncounter {
  registerBrontFighter();
  const encounter = RIVAL_CIRCUIT_ENCOUNTERS[3];
  if (!encounter) throw new Error("Rival Circuit Stage 4 is missing");
  if (!registered) {
    const mutable = mutableEncounter(encounter);
    mutable.fighterId = BRONT_FIGHTER_ID;
    mutable.rule = "GRAVITY LOCK // STEP LATE AND GET PINNED";
    mutable.description = "BRONT turns REDLINE into a heavyweight compression test. His slower attacks hit harder, chew guard, and push farther, so predictable STEP timing gets trapped against the contracting boundary.";
    registered = true;
  }
  return encounter;
}

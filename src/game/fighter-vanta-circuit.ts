import { registerVantaFighter, VANTA_FIGHTER_ID } from "./fighter-vanta";
import { RIVAL_CIRCUIT_ENCOUNTERS, type RivalCircuitEncounter } from "./rival-circuit";

let registered = false;

export function registerVantaCircuitRival(): RivalCircuitEncounter {
  registerVantaFighter();
  const encounter = RIVAL_CIRCUIT_ENCOUNTERS[2];
  if (!encounter) throw new Error("Rival Circuit Stage 3 is missing");
  if (!registered) {
    const mutable = encounter as unknown as {
      fighterId: string;
      description: string;
      rule: string;
    };
    mutable.fighterId = VANTA_FIGHTER_ID;
    mutable.rule = "NULL MIRROR // ATTACK ONLY WHEN THE READ IS REAL";
    mutable.description = "VANTA turns Stage 3 into a deliberate counter-control duel. Feints and empty pressure give her the answer she wants; clean spacing, delayed ATTACK timing, and disciplined STEP break the mirror.";
    registered = true;
  }
  return encounter;
}

import { registerVantaFighter, VANTA_FIGHTER_ID } from "./fighter-vanta";
import { RIVAL_CIRCUIT_ENCOUNTERS, type RivalCircuitEncounter } from "./rival-circuit";

let registered = false;
let auditConfigured = false;

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

export function configureVantaAuditEncounterFromLocation(): boolean {
  if (typeof window === "undefined" || auditConfigured) return false;
  const requested = new URLSearchParams(window.location.search).get("vantaAudit") === "1";
  if (!requested) return false;
  registerVantaFighter();
  const first = RIVAL_CIRCUIT_ENCOUNTERS[0];
  if (!first) return false;
  mutableEncounter(first).fighterId = VANTA_FIGHTER_ID;
  auditConfigured = true;
  document.body.dataset.vantaAuditEntry = "STAGE_1_VISUAL_ONLY";
  return true;
}

export function registerVantaCircuitRival(): RivalCircuitEncounter {
  registerVantaFighter();
  const encounter = RIVAL_CIRCUIT_ENCOUNTERS[2];
  if (!encounter) throw new Error("Rival Circuit Stage 3 is missing");
  if (!registered) {
    const mutable = mutableEncounter(encounter);
    mutable.fighterId = VANTA_FIGHTER_ID;
    mutable.rule = "NULL MIRROR // ATTACK ONLY WHEN THE READ IS REAL";
    mutable.description = "VANTA turns Stage 3 into a deliberate counter-control duel. Feints and empty pressure give her the answer she wants; clean spacing, delayed ATTACK timing, and disciplined STEP break the mirror.";
    registered = true;
  }
  configureVantaAuditEncounterFromLocation();
  return encounter;
}

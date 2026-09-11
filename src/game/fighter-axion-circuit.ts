import { registerAxionFighter, AXION_FIGHTER_ID } from "./fighter-axion";
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

export function configureAxionAuditEncounterFromLocation(): boolean {
  if (typeof window === "undefined" || auditConfigured) return false;
  const requested = new URLSearchParams(window.location.search).get("axionAudit") === "1";
  if (!requested) return false;
  registerAxionFighter();
  const first = RIVAL_CIRCUIT_ENCOUNTERS[0];
  if (!first) return false;
  mutableEncounter(first).fighterId = AXION_FIGHTER_ID;
  auditConfigured = true;
  document.body.dataset.axionAuditEntry = "STAGE_1_VISUAL_ONLY";
  return true;
}

export function registerAxionCircuitRival(): RivalCircuitEncounter {
  registerAxionFighter();
  const encounter = RIVAL_CIRCUIT_ENCOUNTERS[3];
  if (!encounter) throw new Error("Rival Circuit Stage 4 is missing");
  if (!registered) {
    const mutable = mutableEncounter(encounter);
    mutable.fighterId = AXION_FIGHTER_ID;
    mutable.rule = "GRAVITY WARDEN // STEP BEFORE THE WALL CLOSES";
    mutable.description = "AXION turns REDLINE into a heavy spacing trial. His long-range pressure and guard strain punish passive defense, while his slower movement gives clean STEP angles and whiff punishes a visible answer.";
    registered = true;
  }
  configureAxionAuditEncounterFromLocation();
  return encounter;
}

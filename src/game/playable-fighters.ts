import { FIGHTER_DEFINITIONS } from "./definitions";
import {
  registerBrontFighter,
  BRONT_FIGHTER_DEFINITION,
  BRONT_FIGHTER_ID,
} from "./fighter-bront";
import {
  registerVantaFighter,
  VANTA_FIGHTER_DEFINITION,
  VANTA_FIGHTER_ID,
} from "./fighter-vanta";
import type { FighterDefinition } from "./types";

export type PlayableFighterId = "red" | "blue" | typeof VANTA_FIGHTER_ID | typeof BRONT_FIGHTER_ID;

// Register once at module load so every UI/runtime lookup sees the same objects.
registerVantaFighter();
registerBrontFighter();

export const PLAYABLE_FIGHTERS: readonly FighterDefinition[] = Object.freeze([
  FIGHTER_DEFINITIONS.red,
  FIGHTER_DEFINITIONS.blue,
  VANTA_FIGHTER_DEFINITION,
  BRONT_FIGHTER_DEFINITION,
]);

export function playableFighterDefinition(
  id: string,
  fallback: "red" | "blue" = "red",
): FighterDefinition {
  if (id === VANTA_FIGHTER_ID) return VANTA_FIGHTER_DEFINITION;
  if (id === BRONT_FIGHTER_ID) return BRONT_FIGHTER_DEFINITION;
  return FIGHTER_DEFINITIONS[id] ?? FIGHTER_DEFINITIONS[fallback];
}

export function playableFighterSelectedClass(
  fighterId: string,
  selected: boolean,
  slot: "P1" | "P2",
): string {
  if (!selected) return "";
  if (fighterId === VANTA_FIGHTER_ID) return "selected-violet";
  if (fighterId === BRONT_FIGHTER_ID) return "selected-amber";
  return slot === "P1" ? "selected-red" : "selected-blue";
}

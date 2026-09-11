import { FIGHTER_DEFINITIONS } from "./definitions";
import {
  registerRookFighter,
  ROOK_FIGHTER_DEFINITION,
  ROOK_FIGHTER_ID,
} from "./fighter-rook";
import {
  registerVantaFighter,
  VANTA_FIGHTER_DEFINITION,
  VANTA_FIGHTER_ID,
} from "./fighter-vanta";
import type { FighterDefinition } from "./types";

export type PlayableFighterId = "red" | "blue" | typeof VANTA_FIGHTER_ID | typeof ROOK_FIGHTER_ID;

// Register once at module load so every UI/runtime lookup sees the same objects.
registerVantaFighter();
registerRookFighter();

export const PLAYABLE_FIGHTERS: readonly FighterDefinition[] = Object.freeze([
  FIGHTER_DEFINITIONS.red,
  FIGHTER_DEFINITIONS.blue,
  VANTA_FIGHTER_DEFINITION,
  ROOK_FIGHTER_DEFINITION,
]);

export function playableFighterDefinition(
  id: string,
  fallback: "red" | "blue" = "red",
): FighterDefinition {
  if (id === VANTA_FIGHTER_ID) return VANTA_FIGHTER_DEFINITION;
  if (id === ROOK_FIGHTER_ID) return ROOK_FIGHTER_DEFINITION;
  return FIGHTER_DEFINITIONS[id] ?? FIGHTER_DEFINITIONS[fallback];
}

export function playableFighterSelectedClass(
  fighterId: string,
  selected: boolean,
  slot: "P1" | "P2",
): string {
  if (!selected) return "";
  if (fighterId === VANTA_FIGHTER_ID) return "selected-violet";
  if (fighterId === ROOK_FIGHTER_ID) return "selected-amber";
  return slot === "P1" ? "selected-red" : "selected-blue";
}

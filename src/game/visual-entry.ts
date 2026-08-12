import type { FighterDefinition } from "./types";
import { createFemaleV8Visual } from "./visual-v8";
import { createFighterVisual as createLegacyFighterVisual, disposeFighterVisual } from "./visual";
import type { FighterVisualQuality } from "./visual";

/** Runtime visual selector. SERA uses the single-mesh V8 model; KAIRO stays on the proven legacy model. */
export function createFighterVisual(definition: FighterDefinition, quality: FighterVisualQuality = "NORMAL") {
  if (definition.archetype === "SPEED") return createFemaleV8Visual(definition, quality);
  return createLegacyFighterVisual(definition, quality);
}

export { disposeFighterVisual };

import type { FighterDefinition } from "./types";
import { createFemaleV8Visual } from "./visual-v8";
import {
  createFighterVisual as createLegacyFighterVisual,
  disposeFighterVisual,
  getSoleContactPoint,
  getVisualContactPoint,
  getWalkFootTarget,
  releaseFootPlants,
  updateFootPlants,
  visualGroundOffset,
} from "./visual";
import type { FighterVisual, FighterVisualQuality, FootPlantMode } from "./visual";

/** Runtime visual selector. SERA uses the single-mesh V8 model; KAIRO stays on the proven legacy model. */
export function createFighterVisual(definition: FighterDefinition, quality: FighterVisualQuality = "NORMAL"): FighterVisual {
  if (definition.archetype === "SPEED") return createFemaleV8Visual(definition, quality) as FighterVisual;
  return createLegacyFighterVisual(definition, quality);
}

export {
  disposeFighterVisual,
  getSoleContactPoint,
  getVisualContactPoint,
  getWalkFootTarget,
  releaseFootPlants,
  updateFootPlants,
  visualGroundOffset,
};
export type { FighterVisual, FighterVisualQuality, FootPlantMode };

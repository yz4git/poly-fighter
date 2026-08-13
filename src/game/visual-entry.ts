import type { FighterDefinition } from "./types";
import { applyV9AuthoredStance } from "./visual-v9-stance";
import { createFemaleV10Visual } from "./visual-v10";
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

/** Runtime visual selector. SERA uses the four-view reconstructed V10 GLB; KAIRO stays on the legacy model. */
export function createFighterVisual(definition: FighterDefinition, quality: FighterVisualQuality = "NORMAL"): FighterVisual {
  if (definition.archetype === "SPEED") return applyV9AuthoredStance(createFemaleV10Visual(definition, quality));
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

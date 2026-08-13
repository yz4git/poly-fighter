import type { FighterDefinition } from "./types";
import { applyV10RuntimePolish } from "./visual-v10-polish";
import { applyV10SafeStance } from "./visual-v10-stance";
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

/**
 * Runtime visual selector. SERA uses the shared four-view V10 GLB plus the
 * V10.3 bind-correct anatomical fragment presentation. The selector does not
 * alter combat rules, coordinate conventions, IK targets, or KAIRO.
 */
export function createFighterVisual(definition: FighterDefinition, quality: FighterVisualQuality = "NORMAL"): FighterVisual {
  if (definition.archetype === "SPEED") {
    return applyV10RuntimePolish(applyV10SafeStance(createFemaleV10Visual(definition, quality)));
  }
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

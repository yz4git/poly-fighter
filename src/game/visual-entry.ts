import type { FighterDefinition } from "./types";
import { applyV104GroundedReferenceFeet } from "./visual-v10-reference-feet";
import { applyV10SafeStance } from "./visual-v10-stance";
import { createFemaleV11Visual } from "./visual-v11";
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
 * SERA V11 keeps the V9.1 continuous authored character and only reuses the
 * bind-safe V10 reference-pose/grounded-feet rig passes. V10.4 fragment,
 * replacement-head and coherent-shell presentation geometry stays disabled.
 */
export function createFighterVisual(definition: FighterDefinition, quality: FighterVisualQuality = "NORMAL"): FighterVisual {
  if (definition.archetype === "SPEED") {
    return applyV104GroundedReferenceFeet(applyV10SafeStance(createFemaleV11Visual(definition, quality)));
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

import type { FighterDefinition } from "./types";
import { applyV104CoherentLimbs } from "./visual-v10-coherent-limbs";
import { applyV104GroundedReferenceFeet } from "./visual-v10-reference-feet";
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
 * Runtime visual selector. SERA uses the shared four-view V10 torso/hips plus
 * V10.4 reference head, costume, grounded stance and coherent bone-owned limb
 * shells. Combat rules, contact targets and KAIRO remain unchanged.
 */
export function createFighterVisual(definition: FighterDefinition, quality: FighterVisualQuality = "NORMAL"): FighterVisual {
  if (definition.archetype === "SPEED") {
    const visual = createFemaleV10Visual(definition, quality);
    return applyV104CoherentLimbs(
      applyV10RuntimePolish(applyV104GroundedReferenceFeet(applyV10SafeStance(visual))),
    );
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

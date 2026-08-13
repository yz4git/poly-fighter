import type { FighterDefinition } from "./types";
import { applyV11ReferencePose } from "./visual-v11-pose";
import { createFemaleV11Visual } from "./visual-v11";
import { repairV11GroupWinding } from "./visual-v11-winding";
import { createFighterVisual as createLegacyFighterVisual, disposeFighterVisual, getSoleContactPoint, getVisualContactPoint, getWalkFootTarget, releaseFootPlants, updateFootPlants, visualGroundOffset } from "./visual";
import type { FighterVisual, FighterVisualQuality, FootPlantMode } from "./visual";

export function createFighterVisual(definition: FighterDefinition, quality: FighterVisualQuality = "NORMAL"): FighterVisual {
  if (definition.archetype === "SPEED") {
    const visual = createFemaleV11Visual(definition, quality);
    visual.root.userData.v11WindingRepair = repairV11GroupWinding(visual.bodyMesh.geometry);
    return applyV11ReferencePose(visual);
  }
  return createLegacyFighterVisual(definition, quality);
}

export { disposeFighterVisual, getSoleContactPoint, getVisualContactPoint, getWalkFootTarget, releaseFootPlants, updateFootPlants, visualGroundOffset };
export type { FighterVisual, FighterVisualQuality, FootPlantMode };

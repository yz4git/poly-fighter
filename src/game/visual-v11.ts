import type { FighterDefinition } from "./types";
import type { FighterVisual, FighterVisualQuality } from "./visual";
import { createFemaleV9Visual } from "./visual-v9";

/** V11 restores V9.1 character readability while keeping the canonical rig used by V10 combat IK. */
export function createFemaleV11Visual(
  definition: FighterDefinition,
  quality: FighterVisualQuality = "NORMAL",
): FighterVisual {
  const visual = createFemaleV9Visual(definition, quality);
  visual.root.name = `fighter-v11-${definition.id}`;
  visual.root.userData.visualPipeline = "V11_V91_CHARACTER_V10_COMPATIBLE_RIG";
  visual.root.userData.visualVersion = "V11";
  visual.root.userData.v11CharacterSource = "V9.1_AUTHORED_CONTINUOUS_MESH";
  visual.root.userData.v11RigSource = "V10_CANONICAL_V4_RIG_AND_IK";
  visual.root.userData.v10ReferenceAsset = "/models/sera-v10.glb";
  visual.bodyMesh.userData.v11PresentationMode = "V9.1_CONTINUOUS_SKINNED_CHARACTER";
  visual.visualVersion = "V11" as unknown as FighterVisual["visualVersion"];
  visual.stats.visualVersion = "V11" as unknown as FighterVisual["stats"]["visualVersion"];
  return visual;
}

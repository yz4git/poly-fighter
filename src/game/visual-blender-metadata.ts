import type { SeraWeightAudit } from "./visual-blender-diagnostics";
import type { SeraSkinningDiagnostics } from "./visual-blender-skinning";

export interface SeraRuntimeMetadata {
  skinningVersion: string;
  regionCounts: SeraSkinningDiagnostics["regionCounts"];
  semanticCounts: SeraSkinningDiagnostics["semanticCounts"];
  headLockedVertices: number;
  dominantBoneCounts: SeraWeightAudit["dominantBoneCounts"];
  maxInfluenceCount: number;
}

export function createSeraRuntimeMetadata(
  diagnostics: SeraSkinningDiagnostics,
  weightAudit: SeraWeightAudit,
): SeraRuntimeMetadata {
  return {
    skinningVersion: "SERA_BLENDER_SKIN_V2",
    regionCounts: diagnostics.regionCounts,
    semanticCounts: diagnostics.semanticCounts,
    headLockedVertices: diagnostics.headLockedVertices,
    dominantBoneCounts: weightAudit.dominantBoneCounts,
    maxInfluenceCount: weightAudit.maxInfluenceCount,
  };
}

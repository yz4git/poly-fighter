import type { SeraWeightAudit } from "./visual-blender-diagnostics";
import type { SeraSkinningDiagnostics } from "./visual-blender-skinning";

export interface SeraRuntimeMetadata {
  skinningVersion: string;
  regionCounts: SeraSkinningDiagnostics["regionCounts"];
  semanticCounts: SeraSkinningDiagnostics["semanticCounts"];
  authoredPartCounts: SeraSkinningDiagnostics["authoredPartCounts"];
  rigidAuthoredVertices: number;
  headLockedVertices: number;
  dominantBoneCounts: SeraWeightAudit["dominantBoneCounts"];
  maxInfluenceCount: number;
}

export function createSeraRuntimeMetadata(
  diagnostics: SeraSkinningDiagnostics,
  weightAudit: SeraWeightAudit,
): SeraRuntimeMetadata {
  return {
    skinningVersion: "SERA_BLENDER_SKIN_V3_PART_AWARE",
    regionCounts: diagnostics.regionCounts,
    semanticCounts: diagnostics.semanticCounts,
    authoredPartCounts: diagnostics.authoredPartCounts,
    rigidAuthoredVertices: diagnostics.rigidAuthoredVertices,
    headLockedVertices: diagnostics.headLockedVertices,
    dominantBoneCounts: weightAudit.dominantBoneCounts,
    maxInfluenceCount: weightAudit.maxInfluenceCount,
  };
}

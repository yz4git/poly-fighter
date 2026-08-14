import type { SeraSkinningDiagnostics } from "./visual-blender-skinning";

export interface SeraRuntimeMetadata {
  skinningVersion: string;
  regionCounts: SeraSkinningDiagnostics["regionCounts"];
  semanticCounts: SeraSkinningDiagnostics["semanticCounts"];
  headLockedVertices: number;
}

export function createSeraRuntimeMetadata(diagnostics: SeraSkinningDiagnostics): SeraRuntimeMetadata {
  return {
    skinningVersion: "SERA_BLENDER_SKIN_V2",
    regionCounts: diagnostics.regionCounts,
    semanticCounts: diagnostics.semanticCounts,
    headLockedVertices: diagnostics.headLockedVertices,
  };
}

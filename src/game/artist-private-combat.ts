import type { FighterModelId } from "./model-skins";

/** Private QA only. Art from a local File/Blob URL is never selectable from
 * the public versus/circuit dropdown, and the CPU never receives that URL.
 * This layer does not affect hitboxes, CPU difficulty, or the move catalog. */
export const ARTIST_PRIVATE_COMBAT_VERSION = "SERA_LOCAL_COMBAT_QA_V1";

export type ArtistPrivateModelSelection = Readonly<{
  p1Model: FighterModelId;
  p2Model: FighterModelId;
  eligible: boolean;
  issue: string | null;
}>;

export function resolveArtistPrivateCombatModels(
  privateQa: boolean,
  localGlbUrl: string | null,
  selectedModel: FighterModelId,
): ArtistPrivateModelSelection {
  if (!privateQa) return {
    p1Model: selectedModel,
    p2Model: selectedModel,
    eligible: true,
    issue: null,
  };
  // Explicit fail-closed: do not accidentally start a supposedly imported
  // SERA session with the public model when the blob URL is no longer valid.
  if (!localGlbUrl?.startsWith("blob:")) return {
    p1Model: "QUATERNIUS_UBC",
    p2Model: "QUATERNIUS_UBC",
    eligible: false,
    issue: "Select a compatible SERA GLB in ARTIST ASSET LAB before entering a private fight.",
  };
  return {
    p1Model: "SERA_ARTIST_PREVIEW",
    p2Model: "QUATERNIUS_UBC",
    eligible: true,
    issue: null,
  };
}

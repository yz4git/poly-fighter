export const FIGHTER_MODEL_IDS = ["QUATERNIUS_UBC", "ORIGINAL", "SERA_HERO_PBR", "SERA_ARTIST_PREVIEW"] as const;
export type FighterModelId = (typeof FIGHTER_MODEL_IDS)[number];

export const DEFAULT_FIGHTER_MODEL_ID: FighterModelId = "QUATERNIUS_UBC";

export const FIGHTER_MODEL_OPTIONS: ReadonlyArray<{
  id: FighterModelId;
  label: string;
  detail: string;
}> = [
  {
    id: "QUATERNIUS_UBC",
    label: "UBC CC0",
    detail: "QUATERNIUS / UNIVERSAL RIG",
  },
  {
    id: "SERA_HERO_PBR",
    label: "SERA HERO PBR",
    detail: "MAKEHUMAN / NEW RIG / SERA ONLY",
  },
  {
    id: "SERA_ARTIST_PREVIEW",
    label: "LOCAL ARTIST TEST",
    detail: "LOCAL GLB / UNAPPROVED / MOTION QA",
  },
  {
    id: "ORIGINAL",
    label: "ORIGINAL",
    detail: "POLY FIGHTER CUSTOM",
  },
];

export const FIGHTER_MODEL_IDS = ["QUATERNIUS_UBC", "ORIGINAL"] as const;
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
    id: "ORIGINAL",
    label: "ORIGINAL",
    detail: "POLY FIGHTER CUSTOM",
  },
];

import type { FighterDefinition } from "./types";

/**
 * Artist-first fallback: the CC0 UBC mesh is real skinned anatomy, but the
 * legacy first-pass outfit was dozens of camera-facing prisms/boxes that make
 * the game look like a geometry editor. Preserve only a narrow set of useful
 * soft silhouette cues while a fully sculpted hero GLB is independently
 * authored and approved (see SERA artist-first PR).
 *
 * This curation is deliberately a detail-creation policy, NOT a hide-at-render
 * hack: suppressed geometries are disposed before they can be uploaded,
 * cutting per-fighter draw calls in the mobile WebGL runtime.
 */
export const QUATERNIUS_HERO_CURATION_VERSION = "SCULPT_READY_MINIMAL_SILHOUETTE_V1";

export type QuaterniusDetailSource = "HERO_KIT" | "V2";
export type QuaterniusDetailDecision = "KEEP" | "REJECT_BLOCKY_PLACEHOLDER";

export function decideQuaterniusHeroDetail(
  name: string,
  archetype: FighterDefinition["archetype"],
  source: QuaterniusDetailSource,
): QuaterniusDetailDecision {
  const fighter = archetype === "POWER" ? "kairo" : "sera";
  if (!name.startsWith(`ubc-${fighter}-`)) return "REJECT_BLOCKY_PLACEHOLDER";

  // The existing linked fists remain essential for contact feedback and
  // screenshot/IK validation. Real hand geometry stays on the UBC mesh.
  if (source === "HERO_KIT" && name.endsWith("-fist")) return "KEEP";

  // Hair locks/ponytails help silhouette without covering anatomical planes.
  // Do not add separate primitive face/cheek/chest/leg armor: retain the
  // original facial geometry and the colorized skinned outfit underneath.
  const hair = ["hair", "fringe", "ponytail", "side-lock", "face-lock"];
  if (hair.some(part => name.includes(part))) return "KEEP";

  // Allow two narrow cloth accent strips over the skinned uniform, not large
  // suspended surface panels or shin-sized opaque cards.
  if (source === "HERO_KIT"
      && (name.includes("trouser-stripe") || name.includes("leg-stripe"))) {
    return "KEEP";
  }
  return "REJECT_BLOCKY_PLACEHOLDER";
}

import type { ReactionTarget } from "./types";

export const CONTACT_REACTION_VERSION = "CONTACT_REACTION_V1";
export type ContactReactionRegion = "HEAD" | "BODY" | "LEGS" | "BLOCK";

export function contactReactionClip(region: ReactionTarget, side: "LEFT" | "RIGHT", blocked: boolean): string {
  return blocked ? `CM_Block_${side === "LEFT" ? "L" : "R"}`
    : `CM_Hit_${region}_${side === "LEFT" ? "L" : "R"}`;
}

function pulse(u: number, peak: number, end: number): number {
  const x = u < peak ? u / peak : 1 - (u - peak) / (end - peak);
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

/** Baked target-rig response: contact first, weight transfer second, then brace. */
export function sampleContactReaction(region: ContactReactionRegion, side: "L" | "R", phase: number) {
  const u = Math.max(0, Math.min(1, phase));
  const sign = side === "L" ? -1 : 1;
  const impact = pulse(u, .12, .68);
  const weight = pulse(u, .29, .91);
  const step = pulse(u, .61, 1);
  const block = region === "BLOCK";
  const body = region === "BODY";
  const legs = region === "LEGS";
  return {
    side: sign * (legs ? .027 : .009) * weight,
    forward: -(block ? .008 : .022) * weight,
    drop: -(legs ? .060 : body ? .030 : block ? .012 : .018) * weight,
    pitch: .025 + (body ? .13 : legs ? .065 : block ? -.025 : -.10) * weight,
    chest: .035 + (body ? .20 : legs ? .06 : block ? -.045 : -.15) * impact,
    yaw: sign * (block ? .035 : .13) * impact,
    roll: sign * (legs ? .075 : .035) * weight,
    highGuard: block ? 1 : .15 * weight,
    headPitch: (body ? .055 : legs ? 0 : block ? -.02 : -.13) * impact,
    headYaw: sign * (block ? .025 : .10) * impact,
    handDrop: body ? .065 * impact : 0,
    rearStep: block ? 0 : .036 * step,
    footLift: block ? 0 : .022 * Math.sin(Math.PI * u) ** 2 * step,
  };
}

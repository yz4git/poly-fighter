import type { FighterDefinition, MoveDefinition, ReactionKind } from "./types";

export type MotionClipSpec = {
  name: string;
  loop: boolean;
  speedScale: number;
};

export type MotionStyle =
  | "JAB"
  | "CROSS"
  | "HOOK"
  | "BODY_BLOW"
  | "HEAVY"
  | "FRONT_KICK"
  | "LOW_KICK"
  | "RISING_KICK"
  | "DASH_KICK"
  | "THROW"
  | "COUNTER";

export type MoveMotionSpec = {
  clip: string;
  recoveryClip?: string;
  style: MotionStyle;
  speedScale: number;
  contactBlend: number;
};

export type TpsComboRoute = "CLOSE_A" | "CLOSE_B" | "FAR" | "FLANK" | "PERFECT";

/**
 * Runtime-authoritative motion mapping.
 *
 * Motion Readability v2 established readable authored silhouettes and limited
 * opponent-weighted IK. Procedural Fight v1 keeps that contact model but swaps
 * the attack body motion to a deterministic generated pack built from the UAL
 * skeleton. Existing Quaternius clips remain runtime fallbacks if the generated
 * pack cannot be loaded.
 */
const MOVE_MOTIONS: Readonly<Record<string, MoveMotionSpec>> = {
  jab: { clip: "PF_Jab_L", style: "JAB", speedScale: 1.08, contactBlend: 0.26 },
  straight: { clip: "PF_Cross_R", style: "CROSS", speedScale: 1.02, contactBlend: 0.30 },
  backfist: { clip: "PF_Backfist_R", recoveryClip: "Melee_Hook_Rec", style: "HOOK", speedScale: 1.0, contactBlend: 0.34 },
  bodyBlow: { clip: "PF_BodyBlow_L", style: "BODY_BLOW", speedScale: 1.05, contactBlend: 0.34 },
  power: { clip: "PF_Power_R", style: "HEAVY", speedScale: 0.92, contactBlend: 0.40 },
  kick: { clip: "PF_FrontKick_R", recoveryClip: "NinjaJump_Land", style: "FRONT_KICK", speedScale: 1.0, contactBlend: 0.68 },
  lowKick: { clip: "PF_LowKick_L", recoveryClip: "Slide_Exit", style: "LOW_KICK", speedScale: 1.02, contactBlend: 0.72 },
  risingKick: { clip: "PF_RisingKick_R", recoveryClip: "NinjaJump_Land", style: "RISING_KICK", speedScale: 0.94, contactBlend: 0.76 },
  dashKick: { clip: "PF_DashKick_R", recoveryClip: "NinjaJump_Land", style: "DASH_KICK", speedScale: 0.9, contactBlend: 0.80 },
  throw: { clip: "PF_Throw", style: "THROW", speedScale: 0.92, contactBlend: 0.30 },
  counter: { clip: "PF_Counter_R", style: "COUNTER", speedScale: 1.08, contactBlend: 0.32 },
};

const REACTION_CLIPS: Readonly<Record<Exclude<ReactionKind, "NONE">, string>> = {
  HEAD: "Hit_Head",
  BODY: "Hit_Chest",
  LOW: "PF_HitHeavy",
  HEAVY: "PF_HitHeavy",
  LAUNCH: "PF_Launch",
  THROW: "PF_HitHeavy",
  BLOCK: "Idle_Shield_Break",
  DOWN: "PF_DownBack",
  KO: "PF_DownBack",
};

export const MOTION_EXPANSION_PROFILE = {
  version: "MOTION_READABILITY_V2",
  proceduralVersion: "PROCEDURAL_FIGHT_V1",
  primaryLibraryClips: 12,
  secondaryLibraryClips: 20,
  proceduralLibraryClips: 15,
  uniqueMoveMappings: Object.keys(MOVE_MOTIONS).length,
  reactionKinds: Object.keys(REACTION_CLIPS).length,
  airLoopClip: "NinjaJump_Idle_Loop",
  wakeupClip: "PF_Wakeup",
  guardClip: "Idle_Shield_Loop",
  guardBreakClip: "Idle_Shield_Break",
  sideStepClip: "Slide_Start",
} as const;

export function motionSpecForMove(move: MoveDefinition): MoveMotionSpec {
  return MOVE_MOTIONS[move.id] ?? {
    clip: move.motionId ?? (move.animation === "kick" ? "NinjaJump_Start" : "Punch_Cross"),
    style: move.animation === "kick" ? "FRONT_KICK" : "CROSS",
    speedScale: 1,
    contactBlend: 0.5,
  };
}

export function motionClipForMove(move: MoveDefinition): string {
  return motionSpecForMove(move).clip;
}

export function motionRecoveryClipForMove(move: MoveDefinition): string | null {
  return motionSpecForMove(move).recoveryClip ?? null;
}

export function motionClipForReaction(kind: ReactionKind): string {
  if (kind === "NONE") return "Hit_Chest";
  return REACTION_CLIPS[kind];
}

export function reactionKindForMove(
  move: MoveDefinition | undefined,
  knockedDown: boolean,
  health: number,
): ReactionKind {
  if (health <= 0) return "KO";
  if (!move) return knockedDown ? "HEAVY" : "BODY";
  if (move.launcher) return "LAUNCH";
  if (knockedDown || move.power >= 1.55) return "HEAVY";
  if (move.reactionTarget === "HEAD" || move.hitLevel === "HIGH") return "HEAD";
  if (move.reactionTarget === "LEGS" || move.hitLevel === "LOW") return "LOW";
  return "BODY";
}

export function chooseTpsComboRoute(input: {
  distance: number;
  flank: boolean;
  perfect: boolean;
  variationSeed: number;
}): TpsComboRoute {
  if (input.perfect) return "PERFECT";
  if (input.flank) return "FLANK";
  if (input.distance > 1.58) return "FAR";
  return input.variationSeed % 2 === 0 ? "CLOSE_A" : "CLOSE_B";
}

export function tpsComboMoveForRoute(
  route: TpsComboRoute,
  stage: number,
  definition: FighterDefinition,
): string {
  const index = Math.max(0, Math.min(2, stage));
  const speedVariant = definition.archetype === "SPEED";
  const routes: Record<TpsComboRoute, readonly [string, string, string]> = {
    CLOSE_A: ["jab", "straight", "power"],
    CLOSE_B: speedVariant ? ["jab", "bodyBlow", "backfist"] : ["jab", "backfist", "power"],
    FAR: ["kick", "lowKick", "risingKick"],
    FLANK: ["backfist", "bodyBlow", "power"],
    PERFECT: speedVariant ? ["counter", "straight", "risingKick"] : ["counter", "backfist", "power"],
  };
  const selected = routes[route][index];
  return definition.moves[selected] ? selected : "jab";
}

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
 * V1 allowed the broad gameplay animation tag (punch/kick) and the first
 * available Quaternius clip to dominate the presentation. That left several
 * visibly different moves sharing one hook and used jump/roll as substitute
 * kicks. V2 treats the imported clip as the full-body momentum source, then the
 * runtime adds a move-specific strike trajectory on top of it.
 */
const MOVE_MOTIONS: Readonly<Record<string, MoveMotionSpec>> = {
  // Upper-body strikes intentionally use a restrained contact blend. The source
  // clip carries the readable silhouette; IK only nudges the limb toward the
  // opponent instead of burying the fist in the target and visually merging the
  // two fighters at contact.
  jab: { clip: "Punch_Jab", style: "JAB", speedScale: 1.08, contactBlend: 0.30 },
  straight: { clip: "Punch_Cross", style: "CROSS", speedScale: 1.02, contactBlend: 0.36 },
  backfist: { clip: "Melee_Hook", recoveryClip: "Melee_Hook_Rec", style: "HOOK", speedScale: 1.0, contactBlend: 0.42 },
  bodyBlow: { clip: "Shield_OneShot", style: "BODY_BLOW", speedScale: 1.05, contactBlend: 0.40 },
  power: { clip: "Sword_Regular_C", style: "HEAVY", speedScale: 0.92, contactBlend: 0.48 },
  kick: { clip: "NinjaJump_Start", recoveryClip: "NinjaJump_Land", style: "FRONT_KICK", speedScale: 1.0, contactBlend: 0.78 },
  lowKick: { clip: "Slide_Start", recoveryClip: "Slide_Exit", style: "LOW_KICK", speedScale: 1.02, contactBlend: 0.82 },
  risingKick: { clip: "NinjaJump_Start", recoveryClip: "NinjaJump_Land", style: "RISING_KICK", speedScale: 0.94, contactBlend: 0.86 },
  dashKick: { clip: "NinjaJump_Start", recoveryClip: "NinjaJump_Land", style: "DASH_KICK", speedScale: 0.9, contactBlend: 0.90 },
  throw: { clip: "OverhandThrow", style: "THROW", speedScale: 0.92, contactBlend: 0.35 },
  counter: { clip: "Punch_Cross", style: "COUNTER", speedScale: 1.08, contactBlend: 0.40 },
};

const REACTION_CLIPS: Readonly<Record<Exclude<ReactionKind, "NONE">, string>> = {
  HEAD: "Hit_Head",
  BODY: "Hit_Chest",
  LOW: "Hit_Knockback",
  HEAVY: "Hit_Knockback",
  LAUNCH: "NinjaJump_Start",
  THROW: "Hit_Knockback",
  BLOCK: "Idle_Shield_Break",
  DOWN: "Death01",
  KO: "Death01",
};

export const MOTION_EXPANSION_PROFILE = {
  version: "MOTION_READABILITY_V2",
  primaryLibraryClips: 12,
  secondaryLibraryClips: 20,
  uniqueMoveMappings: Object.keys(MOVE_MOTIONS).length,
  reactionKinds: Object.keys(REACTION_CLIPS).length,
  airLoopClip: "NinjaJump_Idle_Loop",
  wakeupClip: "LayToIdle",
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

import type { FighterDefinition, MoveDefinition, ReactionKind } from "./types";

export type MotionClipSpec = {
  name: string;
  loop: boolean;
  speedScale: number;
};

export type TpsComboRoute = "CLOSE_A" | "CLOSE_B" | "FAR" | "FLANK" | "PERFECT";

const MOVE_CLIPS: Readonly<Record<string, string>> = {
  jab: "Punch_Jab",
  straight: "Punch_Cross",
  backfist: "Melee_Hook",
  bodyBlow: "Melee_Hook",
  power: "Melee_Hook",
  kick: "Jump_Start",
  lowKick: "Slide_Start",
  risingKick: "NinjaJump_Start",
  dashKick: "Roll",
  throw: "OverhandThrow",
  counter: "Punch_Cross",
};

const REACTION_CLIPS: Readonly<Record<Exclude<ReactionKind, "NONE">, string>> = {
  HEAD: "Hit_Head",
  BODY: "Hit_Chest",
  LOW: "Hit_Knockback",
  HEAVY: "Hit_Knockback",
  LAUNCH: "NinjaJump_Start",
  THROW: "Hit_Knockback",
  BLOCK: "Hit_Knockback",
  DOWN: "Death01",
  KO: "Death01",
};

export const MOTION_EXPANSION_PROFILE = {
  version: "MOTION_EXPANSION_V1",
  primaryLibraryClips: 12,
  secondaryLibraryClips: 10,
  uniqueMoveMappings: Object.keys(MOVE_CLIPS).length,
  reactionKinds: Object.keys(REACTION_CLIPS).length,
  airLoopClip: "NinjaJump_Idle_Loop",
  wakeupClip: "NinjaJump_Land",
  guardClip: "Idle_Shield_Loop",
  sideStepClip: "Slide_Start",
} as const;

export function motionClipForMove(move: MoveDefinition): string {
  return move.motionId ?? MOVE_CLIPS[move.id] ?? (move.animation === "kick" ? "Jump_Start" : "Punch_Cross");
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

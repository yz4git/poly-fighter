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

export type TpsComboLinkWindow = {
  queueStart: number;
  linkStart: number;
  linkEnd: number;
};

/**
 * Runtime-authoritative motion mapping.
 *
 * Procedural Fight v2 keeps opponent-weighted contact correction intentionally
 * small and moves more of the visible mechanics into generated clips. Generated
 * attacks now include anticipation/impact/settle cadence and center-of-mass
 * motion; heavy attacks and kicks also use generated recovery clips.
 */
const MOVE_MOTIONS: Readonly<Record<string, MoveMotionSpec>> = {
  jab: { clip: "PF_Jab_L", style: "JAB", speedScale: 1.08, contactBlend: 0.24 },
  straight: { clip: "PF_Cross_R", style: "CROSS", speedScale: 1.02, contactBlend: 0.28 },
  backfist: { clip: "PF_Backfist_R", recoveryClip: "PF_HeavyRecover", style: "HOOK", speedScale: 1.0, contactBlend: 0.31 },
  bodyBlow: { clip: "PF_BodyBlow_L", style: "BODY_BLOW", speedScale: 1.05, contactBlend: 0.31 },
  power: { clip: "PF_Power_R", recoveryClip: "PF_HeavyRecover", style: "HEAVY", speedScale: 0.92, contactBlend: 0.36 },
  kick: { clip: "PF_FrontKick_R", recoveryClip: "PF_KickRecover", style: "FRONT_KICK", speedScale: 1.0, contactBlend: 0.62 },
  lowKick: { clip: "PF_LowKick_L", recoveryClip: "PF_KickRecover", style: "LOW_KICK", speedScale: 1.02, contactBlend: 0.66 },
  risingKick: { clip: "PF_RisingKick_R", recoveryClip: "PF_KickRecover", style: "RISING_KICK", speedScale: 0.94, contactBlend: 0.70 },
  dashKick: { clip: "PF_DashKick_R", recoveryClip: "PF_KickRecover", style: "DASH_KICK", speedScale: 0.9, contactBlend: 0.74 },
  throw: { clip: "PF_Throw", style: "THROW", speedScale: 0.92, contactBlend: 0.28 },
  counter: { clip: "PF_Counter_L", style: "COUNTER", speedScale: 1.08, contactBlend: 0.29 },
};

const REACTION_CLIPS: Readonly<Record<Exclude<ReactionKind, "NONE">, string>> = {
  HEAD: "Hit_Head",
  BODY: "Hit_Chest",
  LOW: "PF_HitHeavy",
  HEAVY: "PF_HitHeavy",
  LAUNCH: "PF_Launch",
  THROW: "PF_HitHeavy",
  BLOCK: "PF_GuardBreak",
  DOWN: "PF_DownBack",
  KO: "PF_DownBack",
};

export const MOTION_EXPANSION_PROFILE = {
  version: "MOTION_READABILITY_V2",
  proceduralVersion: "PROCEDURAL_FIGHT_V2",
  primaryLibraryClips: 12,
  secondaryLibraryClips: 23,
  proceduralLibraryClips: 23,
  uniqueMoveMappings: Object.keys(MOVE_MOTIONS).length,
  reactionKinds: Object.keys(REACTION_CLIPS).length,
  airLoopClip: "NinjaJump_Idle_Loop",
  wakeupClip: "PF_Wakeup",
  guardClip: "Idle_Shield_Loop",
  guardBreakClip: "PF_GuardBreak",
  sideStepClip: "PF_Sidestep_R",
  sideStepLeftClip: "PF_Sidestep_L",
  kickRecoveryClip: "PF_KickRecover",
  heavyRecoveryClip: "PF_HeavyRecover",
  rootMotionPolicy: "ADDITIVE_COM_RETURN_TO_BIND",
  timingPolicy: "ANTICIPATION_DRIVE_IMPACT_OVERTRAVEL_SETTLE",
} as const;

function handedClipForMove(move: MoveDefinition, fallback: string): string {
  const left = move.visualContact?.startsWith("LEFT") === true;
  if (move.id === "backfist") return left ? "PF_Backfist_L" : "PF_Backfist_R";
  if (move.id === "bodyBlow") return left ? "PF_BodyBlow_L" : "PF_BodyBlow_R";
  if (move.id === "counter") return left ? "PF_Counter_L" : "PF_Counter_R";
  return fallback;
}

export function motionSpecForMove(move: MoveDefinition): MoveMotionSpec {
  const authored = MOVE_MOTIONS[move.id];
  if (authored) return { ...authored, clip: handedClipForMove(move, authored.clip) };
  return {
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

/**
 * A combo link is deliberately narrower than the whole recovery period.
 * ATTACK may be buffered shortly before recovery, but the actual branch only
 * fires after a small visible settle beat and before the authored cancel window
 * closes. Gameplay therefore stays responsive without visually snapping from
 * impact directly into the next startup.
 */
export function tpsComboLinkWindow(move: MoveDefinition): TpsComboLinkWindow {
  const recoveryStart = move.startup + move.active;
  const recoveryTicks = Math.max(1, move.recovery);
  const usableRecovery = Math.max(1, recoveryTicks - 2);
  const authoredWindow = Math.max(1, Math.min(usableRecovery, move.cancelWindow));
  const settleTicks = Math.max(1, Math.min(usableRecovery, Math.round(recoveryTicks * 0.22)));
  const linkStart = recoveryStart + settleTicks;
  const linkEnd = Math.min(recoveryStart + recoveryTicks - 1, linkStart + authoredWindow - 1);
  return {
    queueStart: Math.max(move.startup, recoveryStart - 2),
    linkStart,
    linkEnd,
  };
}

/**
 * Direction held with the buffered ATTACK chooses the continuation at the link
 * point. Earned PERFECT/FLANK routes stay locked; ordinary strings may change
 * between pressure and angle routes, while knockback naturally promotes a FAR
 * continuation. No extra input button is required.
 */
export function chooseTpsComboContinuationRoute(input: {
  currentRoute: TpsComboRoute;
  distance: number;
  forward: boolean;
  back: boolean;
  side: boolean;
}): TpsComboRoute {
  if (input.currentRoute === "PERFECT" || input.currentRoute === "FLANK") return input.currentRoute;
  if (input.distance > 1.72) return "FAR";
  if (input.side || input.back) return "CLOSE_B";
  if (input.forward) return "CLOSE_A";
  if (input.currentRoute === "FAR") return "CLOSE_A";
  return input.currentRoute;
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

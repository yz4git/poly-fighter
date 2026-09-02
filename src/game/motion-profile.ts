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
  plantFoot: "LEFT" | "RIGHT" | "BOTH" | "AIR";
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
 * Procedural Fight v3 is pose-first: authored timing profiles drive a nine-pose
 * graph while runtime support-foot locking, bounded COM solve and target-aware
 * full-body IK preserve believable force transfer. Motion DNA differentiates
 * KAIRO's weight from SERA's lateral speed without changing frame data.
 */
export type MotionTimingProfile = {
  load: number; hold: number; launch: number; pre: number;
  impact: number; over: number; recoil: number; settle: number;
};

export type MotionDna = {
  id: "KAIRO_POWER" | "SERA_SPEED";
  hipLead: number;
  chestFollow: number;
  recoil: number;
  lateral: number;
  guardDiscipline: number;
};

const MOVE_TIMINGS: Readonly<Record<string, MotionTimingProfile>> = {
  jab:        { load: .10, hold: .16, launch: .26, pre: .48, impact: .61, over: .67, recoil: .76, settle: .88 },
  straight:   { load: .12, hold: .21, launch: .32, pre: .55, impact: .68, over: .75, recoil: .84, settle: .93 },
  backfist:   { load: .14, hold: .27, launch: .38, pre: .54, impact: .64, over: .74, recoil: .84, settle: .94 },
  bodyBlow:   { load: .16, hold: .29, launch: .41, pre: .58, impact: .70, over: .77, recoil: .87, settle: .95 },
  power:      { load: .17, hold: .34, launch: .47, pre: .63, impact: .73, over: .81, recoil: .90, settle: .97 },
  kick:       { load: .13, hold: .25, launch: .37, pre: .52, impact: .64, over: .72, recoil: .83, settle: .94 },
  lowKick:    { load: .15, hold: .28, launch: .40, pre: .55, impact: .67, over: .76, recoil: .87, settle: .95 },
  risingKick: { load: .17, hold: .30, launch: .42, pre: .58, impact: .69, over: .78, recoil: .88, settle: .96 },
  dashKick:   { load: .08, hold: .16, launch: .27, pre: .49, impact: .66, over: .73, recoil: .82, settle: .92 },
  throw:      { load: .13, hold: .26, launch: .39, pre: .51, impact: .58, over: .66, recoil: .80, settle: .93 },
  counter:    { load: .06, hold: .12, launch: .22, pre: .42, impact: .55, over: .63, recoil: .75, settle: .88 },
};

const MOTION_DNA: Readonly<Record<FighterDefinition["archetype"], MotionDna>> = {
  POWER: { id: "KAIRO_POWER", hipLead: 1.18, chestFollow: 1.10, recoil: 1.14, lateral: 0.82, guardDiscipline: 1.00 },
  SPEED: { id: "SERA_SPEED", hipLead: 1.04, chestFollow: 0.94, recoil: 0.82, lateral: 1.22, guardDiscipline: 0.92 },
};

const MOVE_MOTIONS: Readonly<Record<string, MoveMotionSpec>> = {
  jab: { clip: "PF_Jab_L", style: "JAB", speedScale: 1.08, contactBlend: 0.24, plantFoot: "RIGHT" },
  straight: { clip: "PF_Cross_R", style: "CROSS", speedScale: 1.02, contactBlend: 0.28, plantFoot: "LEFT" },
  backfist: { clip: "PF_Backfist_R", recoveryClip: "PF_HeavyRecover", style: "HOOK", speedScale: 1.0, contactBlend: 0.31, plantFoot: "LEFT" },
  bodyBlow: { clip: "PF_BodyBlow_L", style: "BODY_BLOW", speedScale: 1.05, contactBlend: 0.38, plantFoot: "RIGHT" },
  power: { clip: "PF_Power_R", recoveryClip: "PF_HeavyRecover", style: "HEAVY", speedScale: 0.92, contactBlend: 0.36, plantFoot: "LEFT" },
  kick: { clip: "PF_FrontKick_R", style: "FRONT_KICK", speedScale: 1.0, contactBlend: 0.84, plantFoot: "LEFT" },
  lowKick: { clip: "PF_LowKick_L", style: "LOW_KICK", speedScale: 1.02, contactBlend: 0.82, plantFoot: "RIGHT" },
  risingKick: { clip: "PF_RisingKick_R", style: "RISING_KICK", speedScale: 0.94, contactBlend: 0.90, plantFoot: "LEFT" },
  dashKick: { clip: "PF_DashKick_R", style: "DASH_KICK", speedScale: 0.9, contactBlend: 0.90, plantFoot: "AIR" },
  throw: { clip: "PF_Throw", style: "THROW", speedScale: 0.92, contactBlend: 0.28, plantFoot: "BOTH" },
  counter: { clip: "PF_Counter_L", style: "COUNTER", speedScale: 1.08, contactBlend: 0.29, plantFoot: "RIGHT" },
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
  version: "MOTION_QUALITY_V3",
  proceduralVersion: "PROCEDURAL_FIGHT_V3",
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
  rootMotionPolicy: "POSE_GRAPH_COM_WITH_RUNTIME_FOOT_LOCK",
  timingPolicy: "MOVE_SPECIFIC_9_POSE_TIMING",
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
    plantFoot: move.animation === "kick" ? "LEFT" : "RIGHT",
  };
}

export function motionClipForMove(move: MoveDefinition): string {
  return motionSpecForMove(move).clip;
}

export function motionRecoveryClipForMove(move: MoveDefinition): string | null {
  return motionSpecForMove(move).recoveryClip ?? null;
}

export function motionTimingForMove(move: MoveDefinition): MotionTimingProfile {
  return MOVE_TIMINGS[move.id] ?? MOVE_TIMINGS.straight;
}

export function motionPlantFootForMove(move: MoveDefinition): MoveMotionSpec["plantFoot"] {
  // Handed variants must mirror their support foot as well as their clip. The
  // support leg stays opposite the striking arm for these rotational punches.
  if (move.id === "backfist" || move.id === "bodyBlow" || move.id === "counter") {
    return move.visualContact?.startsWith("LEFT") ? "RIGHT" : "LEFT";
  }
  return motionSpecForMove(move).plantFoot;
}

export function motionDnaForFighter(definition: FighterDefinition): MotionDna {
  return MOTION_DNA[definition.archetype];
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
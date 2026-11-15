import type { MoveDefinition } from "./types";
import { sourceOfExpandedClip } from "./expanded-motion-library";

export type CombatMotionStage = "STARTUP" | "ACTIVE" | "RECOVERY";

export type AuthoredMotionEvents = Readonly<{
  /** Normalized clip phase where the visible strike first reaches contact. */
  contact: number;
  /** Normalized clip phase at the end of the contact/overtravel arc. */
  contactExit: number;
  /** The first visible pose is already in windup when an ATTACK is accepted. */
  anticipation: number;
  /** The tiny share of recovery spent displaying the end of the follow-through. */
  followHold: number;
  /** Front-load the active overtravel without moving the first contact frame. */
  drive: number;
}>;

export type AuthoredMotionCharacter = "LIGHT" | "PUNCH" | "HEAVY" | "KICK";
const MOTION_CHARACTER: Readonly<Record<AuthoredMotionCharacter, Readonly<{
  travel: number; anticipation: number; followHold: number; drive: number;
}>>> = {
  LIGHT: { travel: 0.035, anticipation: 0, followHold: 0, drive: 0 },
  PUNCH: { travel: 0.060, anticipation: 0.065, followHold: 0.045, drive: 0.22 },
  HEAVY: { travel: 0.080, anticipation: 0.115, followHold: 0.125, drive: 0.38 },
  KICK: { travel: 0.070, anticipation: 0.085, followHold: 0.075, drive: 0.30 },
};

export type CombatMotionSample = Readonly<{
  stage: CombatMotionStage;
  stageProgress: number;
  phase: number;
  contactPhase: number;
  contactExitPhase: number;
  contactWeight: number;
}>;

/**
 * Single source of truth for authored combat events.
 *
 * Gameplay owns time. Blender/Foundry owns poses. This table only states where
 * the authored contact exists inside each committed clip. Runtime code must not
 * duplicate these phases or maintain a second move-specific animation clock.
 */
export const AUTHORED_MOTION_EVENTS: Readonly<Record<string, AuthoredMotionEvents>> = {
  BF_Jab_L: events(16 / 32, "LIGHT"),
  BF_Cross_R: events(20 / 41, "PUNCH"),
  BF_BodyBlow_L: events(22 / 43, "PUNCH"),
  BF_BodyBlow_R: events(22 / 43, "PUNCH"),
  BF_Backfist_R: events(20 / 40, "PUNCH"),
  BF_Backfist_L: events(20 / 40, "PUNCH"),
  BF_Power_R: events(29 / 51, "HEAVY"),
  BF_FrontKick_R: events(23 / 42, "KICK"),
  BF_LowKick_L: events(24 / 45, "KICK"),
  BF_RisingKick_R: events(27 / 48, "HEAVY"),
  BF_DashKick_R: events(22 / 44, "HEAVY"),
  BF_Counter_R: events(17 / 34, "PUNCH"),
  CM_Counter_L: events(0.5, "PUNCH"),
  CM_Counter_R: events(0.5, "PUNCH"),
  CM_Throw: events(0.5, "HEAVY"),
  // All four clips are reconstructed with a clear 0.50 contact key.
  // This pins first-active hitboxes to the actual visual strike, not a
  // separate clock or the arbitrary last keyframe.
  CM_Video_Jab: events(.50, "LIGHT"),
  CM_Video_Palm: events(.50, "PUNCH"),
  CM_Video_SideKick: events(.50, "KICK"),
  CM_Video_SpinKick: events(.50, "HEAVY"),
  // Travel is implemented in the authored approach clip, not by moving the
  // hitbox: range moves retain their actual 0.50-frame contact contract.
  CM_Range_rangeBlitz: events(.50, "PUNCH"),
  CM_Range_rangeCrescent: events(.50, "KICK"),
  CM_Range_rangeComet: events(.50, "HEAVY"),
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smootherstep(value: number): number {
  const u = clamp01(value);
  return u * u * u * (10 + u * (-15 + u * 6));
}

export function motionEventsAtContact(
  contact: number,
  character: AuthoredMotionCharacter = "LIGHT",
): AuthoredMotionEvents {
  const normalized = clamp01(contact);
  const style = MOTION_CHARACTER[character];
  // Extend the original Blender contact just far enough to show the authored
  // follow-through. Never enter the clip's late neutral/return pose in ACTIVE.
  return {
    contact: normalized,
    contactExit: Math.max(normalized, Math.min(0.68, normalized + style.travel)),
    anticipation: style.anticipation,
    followHold: style.followHold,
    drive: style.drive,
  };
}

function events(contact: number, character: AuthoredMotionCharacter = "LIGHT"): AuthoredMotionEvents {
  return motionEventsAtContact(contact, character);
}

export function authoredMotionEvents(clipName: string): AuthoredMotionEvents {
  return AUTHORED_MOTION_EVENTS[sourceOfExpandedClip(clipName)] ?? events(0.5);
}

/**
 * Pure timeline sampler shared by the runtime and compatibility API. Keeping
 * this math in one function prevents punch/kick/fallback paths from drifting.
 */
export function sampleCombatMotionAtEvent(
  move: Pick<MoveDefinition, "startup" | "active" | "recovery">,
  tick: number,
  event: AuthoredMotionEvents,
): CombatMotionSample {
  const totalTicks = Math.max(1, move.startup + move.active + move.recovery);
  const finalTick = Math.max(0, totalTicks - 1);
  const startupTicks = Math.max(0, move.startup);
  const activeTicks = Math.max(1, move.active);
  const activeEndTick = Math.min(finalTick, startupTicks + activeTicks - 1);
  const t = Math.max(0, Math.min(finalTick, tick));

  if (t < startupTicks) {
    const progress = startupTicks === 0 ? 1 : clamp01(t / startupTicks);
    return {
      stage: "STARTUP",
      stageProgress: progress,
      // Sakurai 036/049: a committed punch/kick should visibly respond on its
      // first rendered tick, not slowly fade out of a static neutral pose.
      // Pure clip-time remapping: the fighter, hitbox and startup ticks do not
      // move, and the first ACTIVE tick remains the exact authored contact.
      phase: event.contact * (event.anticipation + (1 - event.anticipation) * progress),
      contactPhase: event.contact,
      contactExitPhase: event.contactExit,
      contactWeight: smootherstep((progress - 0.72) / 0.28),
    };
  }

  if (t <= activeEndTick) {
    const denominator = Math.max(1, activeEndTick - startupTicks);
    const progress = clamp01((t - startupTicks) / denominator);
    return {
      stage: "ACTIVE",
      stageProgress: progress,
      // Cross contact promptly, then show the end of the authored swing
      // without adding a second hit or advancing the combat clock.
      phase: event.contact + (event.contactExit - event.contact)
        * (progress + event.drive * progress * (1 - progress)),
      contactPhase: event.contact,
      contactExitPhase: event.contactExit,
      contactWeight: 1,
    };
  }

  const recoveryTicks = Math.max(1, finalTick - activeEndTick);
  const progress = clamp01((t - activeEndTick) / recoveryTicks);
  const afterHold = clamp01((progress - event.followHold) / (1 - event.followHold));
  return {
    stage: "RECOVERY",
    stageProgress: progress,
    // Sakurai 077: heavy punches finish their swing and keep that silhouette
    // briefly before returning to stance. Recovery/cancel frame counts stay
    // authored by combat data, this merely samples the existing animation.
    phase: event.contactExit + (1 - event.contactExit) * smootherstep(afterHold),
    contactPhase: event.contact,
    contactExitPhase: event.contactExit,
    contactWeight: 1 - smootherstep(progress),
  };
}

/**
 * Converts deterministic gameplay moveTick into one normalized authored clip
 * phase. The first ACTIVE tick is exactly contact. Hitstop naturally freezes
 * the pose because FighterRuntime freezes moveTick during hitstop.
 */
export function sampleCombatMotionTimeline(
  move: Pick<MoveDefinition, "startup" | "active" | "recovery">,
  tick: number,
  clipName: string,
): CombatMotionSample {
  return sampleCombatMotionAtEvent(move, tick, authoredMotionEvents(clipName));
}

import type { MoveDefinition } from "./types";

export type CombatMotionStage = "STARTUP" | "ACTIVE" | "RECOVERY";

export type AuthoredMotionEvents = Readonly<{
  /** Normalized clip phase where the visible strike first reaches contact. */
  contact: number;
  /** Normalized clip phase at the end of the narrow contact/overtravel arc. */
  contactExit: number;
}>;

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
  BF_Jab_L: events(16 / 32),
  BF_Cross_R: events(20 / 41),
  BF_BodyBlow_L: events(22 / 43),
  BF_BodyBlow_R: events(22 / 43),
  BF_Backfist_R: events(20 / 40),
  BF_Backfist_L: events(20 / 40),
  BF_Power_R: events(29 / 51),
  BF_FrontKick_R: events(23 / 42),
  BF_LowKick_L: events(24 / 45),
  BF_RisingKick_R: events(27 / 48),
  BF_DashKick_R: events(22 / 44),
  CM_Counter_L: events(0.5),
  CM_Counter_R: events(0.5),
  CM_Throw: events(0.5),
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smootherstep(value: number): number {
  const u = clamp01(value);
  return u * u * u * (10 + u * (-15 + u * 6));
}

export function motionEventsAtContact(contact: number): AuthoredMotionEvents {
  const normalized = clamp01(contact);
  // Keep contact travel narrow. It exists to carry force through ACTIVE, not to
  // invent a second strike on top of the authored Blender trajectory.
  return {
    contact: normalized,
    contactExit: Math.min(0.68, normalized + 0.035),
  };
}

function events(contact: number): AuthoredMotionEvents {
  return motionEventsAtContact(contact);
}

export function authoredMotionEvents(clipName: string): AuthoredMotionEvents {
  return AUTHORED_MOTION_EVENTS[clipName] ?? events(0.5);
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
      phase: event.contact * progress,
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
      phase: event.contact + (event.contactExit - event.contact) * progress,
      contactPhase: event.contact,
      contactExitPhase: event.contactExit,
      contactWeight: 1,
    };
  }

  const recoveryTicks = Math.max(1, finalTick - activeEndTick);
  const progress = clamp01((t - activeEndTick) / recoveryTicks);
  return {
    stage: "RECOVERY",
    stageProgress: progress,
    phase: event.contactExit + (1 - event.contactExit) * progress,
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

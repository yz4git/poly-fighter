import type { MoveDefinition } from "./types";
import {
  AUTHORED_MOTION_EVENTS,
  motionEventsAtContact,
  sampleCombatMotionAtEvent,
} from "./combat-motion-timeline";

export const COMBAT_MOTION_VERSION = "COMBAT_MOTION_V9_CONTINUOUS_LOCOMOTION";

/** @deprecated Use AUTHORED_MOTION_EVENTS from combat-motion-timeline. */
export const AUTHORED_CONTACT_PHASE: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(Object.entries(AUTHORED_MOTION_EVENTS).map(([name, event]) => [name, event.contact])),
);

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function smoothMotion(value: number): number {
  const u = clamp01(value);
  return u * u * u * (10 + u * (-15 + u * 6));
}

/**
 * @deprecated Compatibility adapter for older tests/tools. Runtime playback must
 * use sampleCombatMotionTimeline so the clip name and authored event stay bound.
 */
export function combatAttackPhase(
  move: Pick<MoveDefinition, "startup" | "active" | "recovery">,
  tick: number,
  impact: number,
): number {
  return sampleCombatMotionAtEvent(move, tick, motionEventsAtContact(impact)).phase;
}

export const LOCOMOTION_DIRECTIONS = ["F", "FR", "R", "BR", "B", "BL", "L", "FL"] as const;
export type LocomotionDirection = typeof LOCOMOTION_DIRECTIONS[number];

/** Short lateral steps keep the feet separated inside the narrower speed stance. */
export function combatStride(speed: boolean, lateral: number): number {
  return Math.min(.30, (speed ? .16 : .20) / Math.max(.001, Math.abs(lateral)));
}

export function locomotionDirection(x: number, z: number): LocomotionDirection {
  const sector = Math.round(Math.atan2(x, z) / (Math.PI / 4));
  return LOCOMOTION_DIRECTIONS[(sector + 8) % 8];
}

/**
 * Continuous eight-way locomotion on a single, shared gait clock.
 *
 * Unlike sector snapping, this represents the full analogue movement heading.
 * At sector boundaries both clips agree, so reversing/circling does not restart
 * the walk animation or swap the planted leg.
 */
export function locomotionBlendAtHeading(heading: number): {
  first: LocomotionDirection;
  second: LocomotionDirection;
  firstWeight: number;
  secondWeight: number;
} {
  const sectors = Number.isFinite(heading) ? heading / (Math.PI / 4) : 0;
  const wrapped = ((sectors % 8) + 8) % 8;
  const index = Math.floor(wrapped);
  const weight = smoothMotion(wrapped - index);
  return {
    first: LOCOMOTION_DIRECTIONS[index],
    second: LOCOMOTION_DIRECTIONS[(index + 1) % 8],
    firstWeight: 1 - weight,
    secondWeight: weight,
  };
}

/** Slew the heading, not the animated joints: prevents direction jitter. */
export function approachLocomotionHeading(
  previous: number | null,
  x: number,
  z: number,
  deltaSeconds: number,
): number {
  const target = Math.hypot(x, z) > 1e-7 ? Math.atan2(x, z) : (previous ?? 0);
  if (previous === null || !Number.isFinite(previous) || !(deltaSeconds > 0)) return target;
  const distance = Math.atan2(Math.sin(target - previous), Math.cos(target - previous));
  const maxStep = Math.max(0, deltaSeconds) * 9; // <= 9 radians/second, frame-rate independent.
  const next = previous + Math.max(-maxStep, Math.min(maxStep, distance));
  return Math.atan2(Math.sin(next), Math.cos(next));
}

/** The stance part is linear: world travel exactly cancels the planted foot. */
export function combatFootCycle(phase: number): { travel: number; lift: number; planted: boolean; roll: number } {
  const u = ((phase % 1) + 1) % 1;
  const stance = .62;
  if (u < stance) {
    const t = u / stance;
    return { travel: .5 - t, lift: 0, planted: true, roll: .08 * smoothMotion((t - .82) / .18) };
  }
  const t = (u - stance) / (1 - stance);
  return { travel: -.5 + smoothMotion(t), lift: Math.sin(Math.PI * t) ** 2, planted: false, roll: -.10 * Math.sin(Math.PI * t) };
}

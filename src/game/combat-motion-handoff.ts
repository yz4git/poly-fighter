import type { FighterState } from "./types";

/**
 * Rendering-only handoffs. Combat startup, ACTIVE frames, recovery ticks and
 * contact windows stay owned by FighterRuntime / combat-motion-timeline.
 *
 * Short stun handoffs favor the incoming impact pose; long recovery handoffs
 * retain a portion of the previous guard/attack angular momentum.
 */
export type CombatMotionHandoffMode =
  | "ATTACK_COMBO"
  | "ATTACK_ENTRY"
  | "ATTACK_TO_GUARD"
  | "ATTACK_TO_READY"
  | "REACTION_INTERRUPT"
  | "BLOCK_INTERRUPT"
  | "REACTION_RECOVERY"
  | "BLOCK_RECOVERY"
  | "GUARD_RECOVERY"
  | "LOCOMOTION"
  | "LANDING"
  | "GENERAL";

export type CombatMotionHandoff = Readonly<{
  mode: CombatMotionHandoffMode;
  duration: number;
  velocityCarry: number;
}>;

export function isCombatAttackClip(name: string): boolean {
  return name.startsWith("BF_Jab") || name.startsWith("BF_Cross")
    || name.startsWith("BF_BodyBlow") || name.startsWith("BF_Backfist")
    || name.startsWith("BF_Power") || name.startsWith("BF_FrontKick")
    || name.startsWith("BF_LowKick") || name.startsWith("BF_RisingKick")
    || name.startsWith("BF_DashKick") || name === "BF_Counter_R"
    || name.startsWith("CM_Counter_");
}

function isReactionClip(name: string): boolean {
  return name.startsWith("BF_Hit") || name.startsWith("BF_CounterHit")
    || name === "BF_EdgeStagger" || name === "CM_Launch";
}

export function planCombatMotionHandoff(
  previous: string,
  next: string,
  nextState: FighterState,
): CombatMotionHandoff {
  const fromAttack = isCombatAttackClip(previous);
  const toAttack = isCombatAttackClip(next);

  // A live hit or blocked strike must take priority over an outgoing combo
  // velocity. The incoming reaction's head, spine and guard become authoritative.
  if (nextState === "HIT" || isReactionClip(next)) {
    return { mode: "REACTION_INTERRUPT", duration: 0.034, velocityCarry: .22 };
  }
  if (nextState === "BLOCK_STUN" || next === "CM_Block") {
    return { mode: "BLOCK_INTERRUPT", duration: 0.038, velocityCarry: .35 };
  }
  if (fromAttack && toAttack) {
    return { mode: "ATTACK_COMBO", duration: .069, velocityCarry: .72 };
  }
  if (toAttack) {
    return { mode: "ATTACK_ENTRY", duration: .052, velocityCarry: .66 };
  }
  if (fromAttack && (nextState === "GUARD" || next === "CM_Guard")) {
    return { mode: "ATTACK_TO_GUARD", duration: .090, velocityCarry: .42 };
  }
  if (fromAttack && (next === "CM_Ready" || next.startsWith("CM_Move"))) {
    return { mode: "ATTACK_TO_READY", duration: .096, velocityCarry: .52 };
  }
  if (isReactionClip(previous) && (nextState === "GUARD" || nextState === "IDLE" || nextState === "WALK")) {
    return { mode: "REACTION_RECOVERY", duration: .115, velocityCarry: .30 };
  }
  if (previous === "CM_Block" && (nextState === "GUARD" || nextState === "IDLE" || nextState === "WALK")) {
    return { mode: "BLOCK_RECOVERY", duration: .086, velocityCarry: .32 };
  }
  if (nextState === "GUARD") {
    return { mode: "GUARD_RECOVERY", duration: .067, velocityCarry: .43 };
  }
  if (next === "CM_Wakeup") {
    return { mode: "LANDING", duration: .052, velocityCarry: .26 };
  }
  if (next.startsWith("CM_Move") && previous.startsWith("CM_Move")) {
    return { mode: "LOCOMOTION", duration: .085, velocityCarry: .55 };
  }
  if (next.startsWith("CM_Step")) {
    return { mode: "LOCOMOTION", duration: .040, velocityCarry: .48 };
  }
  if (next === "CM_Land") {
    return { mode: "LANDING", duration: .062, velocityCarry: .37 };
  }
  return { mode: "GENERAL", duration: .056, velocityCarry: .55 };
}

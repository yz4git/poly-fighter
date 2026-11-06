/**
 * Deterministic contact-aware stance policy for MotionBricks-inspired playback.
 *
 * Actual strike silhouettes, simulation travel, kick foot arcs, and combat
 * contacts remain authored. Only small presentation-only pelvis drift cleanup
 * is allowed when a clearly identified support foot is planted.
 */
export const MOTIONBRICKS_CONTACT_POLICY_VERSION = "SUPPORT_FOOT_CONTACT_V1";

export type MotionContactPolicyInput = Readonly<{
  state: string;
  moveId: string | null;
  visualContact?: string | null;
  contactWeight: number;
  grounded: boolean;
}>;

export type MotionContactPolicy = Readonly<{
  mode: "GROUND_STANCE" | "STRIKE_SUPPORT" | "STRIKE_CONTACT" | "COMMITTED_TRAVEL" | "WALK_IK" | "NO_CONTACT";
  left: number;
  right: number;
  support: "l" | "r" | null;
}>;

const NONE: MotionContactPolicy = Object.freeze({ mode: "NO_CONTACT", left: 0, right: 0, support: null });

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function planMotionContactPolicy(input: MotionContactPolicyInput): MotionContactPolicy {
  if (!input.grounded) return NONE;
  if (input.state === "WALK") {
    // Walking already has an authored gait-phase two-bone plantar solve.
    // Do not create a second, opposing pelvis lock here.
    return { mode: "WALK_IK", left: 0, right: 0, support: null };
  }
  if (input.state === "ATTACK") {
    // Distant strikes have committed 60 Hz simulation travel; pinning a foot
    // to its previous world location would pull the visual pelvis backward.
    if (input.moveId === "rangeBlitz" || input.moveId === "rangeCrescent"
        || input.moveId === "rangeComet" || input.moveId === "dashKick") {
      return { mode: "COMMITTED_TRAVEL", left: 0, right: 0, support: null };
    }
    const contact = clamp01(input.contactWeight);
    if (contact >= .82) {
      // Preserve all exact impact silhouettes and authored end effectors.
      return { mode: "STRIKE_CONTACT", left: 0, right: 0, support: null };
    }
    // Release foot anchoring as the authored contact frame approaches.
    const release = 1 - clamp01((contact - .18) / .64);
    const side = input.visualContact === "RIGHT_FOOT" || input.visualContact === "RIGHT_FIST" ? "l"
      : input.visualContact === "LEFT_FOOT" || input.visualContact === "LEFT_FIST" ? "r"
      : null;
    if (!side) return NONE;
    const weight = (input.visualContact?.includes("FOOT") ? .94 : .90) * release;
    // Never pin the kicking foot. Punches get only a primary support anchor;
    // secondary footwork and root drive stay exactly as authored.
    return {
      mode: "STRIKE_SUPPORT",
      left: side === "l" ? weight : 0,
      right: side === "r" ? weight : 0,
      support: side,
    };
  }
  if (input.state === "IDLE" || input.state === "GUARD" || input.state === "CROUCH"
      || input.state === "BLOCK_STUN") {
    return { mode: "GROUND_STANCE", left: 1, right: 1, support: null };
  }
  return NONE;
}

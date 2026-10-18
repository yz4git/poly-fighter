import type { FighterRuntime } from "./fighter";
import type { ReactionTarget } from "./types";
import type { TpsReactionType } from "./tps-impact-resolution";
import { contactReactionClip, CONTACT_REACTION_VERSION } from "./combat-contact-reaction";

export function applyTpsImpactPresentation(input: {
  attacker: FighterRuntime;
  defender: FighterRuntime;
  simulationTicks: number;
  moveId: string;
  contact: { x: number; y: number; z: number };
  direction: { x: number; z: number };
  reactionType: TpsReactionType;
  reactionRegion: ReactionTarget;
  reactionVariant: number;
  reactionStrength: number;
  impactPairStrength: number;
}): void {
  const {
    attacker,
    defender,
    simulationTicks,
    moveId,
    contact,
    direction,
    reactionType,
    reactionRegion,
    reactionVariant,
    reactionStrength,
    impactPairStrength,
  } = input;

  attacker.visual.root.userData.tpsImpactPairRole = "ATTACKER";
  attacker.visual.root.userData.tpsImpactPairTick = simulationTicks;
  attacker.visual.root.userData.tpsImpactPairMove = moveId;
  attacker.visual.root.userData.tpsImpactPairStrength = impactPairStrength;
  attacker.visual.root.userData.tpsImpactPairContact = [contact.x, contact.y, contact.z];

  defender.visual.root.userData.tpsImpactPairRole = "DEFENDER";
  defender.visual.root.userData.tpsImpactPairTick = simulationTicks;
  defender.visual.root.userData.tpsImpactPairMove = moveId;
  defender.visual.root.userData.tpsImpactPairStrength = impactPairStrength;
  defender.visual.root.userData.tpsImpactPairContact = [contact.x, contact.y, contact.z];
  defender.visual.root.userData.tpsReactionType = reactionType;
  defender.visual.root.userData.tpsReactionRegion = reactionRegion;
  defender.visual.root.userData.tpsReactionVariant = reactionVariant;
  defender.visual.root.userData.tpsReactionStrength = reactionStrength;
  defender.visual.root.userData.tpsReactionDirectionX = direction.x;
  defender.visual.root.userData.tpsReactionDirectionZ = direction.z;
  defender.visual.root.userData.tpsReactionTick = simulationTicks;
  const limb = attacker.currentMove?.visualContact;
  const side = limb?.startsWith("LEFT") ? "RIGHT" : "LEFT";
  const kind = reactionType === "COUNTER" || reactionType === "INTERCEPT" || reactionType === "REVERSAL"
    ? "COUNTER" : reactionRegion === "HEAD" && reactionStrength < 1.2 ? "LIGHT"
      : reactionType === "HEAVY" || reactionType === "FINISHER" ? "HEAVY" : "MID";
  defender.setHitReactionVisual(kind, side, Math.hypot(defender.position.x, defender.position.z) > 5.8);
  defender.visual.root.userData.tpsContactReactionVersion = CONTACT_REACTION_VERSION;
  defender.visual.root.userData.tpsContactReactionClip = contactReactionClip(reactionRegion, side, reactionType === "BLOCK");
}

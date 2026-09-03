import type {
  HitEvent,
  HitLevel,
  Hurtbox,
  MoveDefinition,
} from "./types";
import { FighterRuntime } from "./fighter";
import { attackHitboxCenter } from "./rig";

// Visual-only edge thresholds sit safely inside the actual 6.25 x 3.55 ring.
// They select a compact stagger pose but never change hit logic or knockback.
const VISUAL_EDGE_X = 5.35;
const VISUAL_EDGE_Z = 2.95;

// Standing fighters previously had no body/push collision at all, so walking or
// attacking at close range could place both character meshes almost on the same
// root position. Keep this deliberately smaller than strike reach: it prevents
// torso overlap without turning the game into a rigid invisible-wall fighter.
const POWER_PUSH_RADIUS = 0.48;
const SPEED_PUSH_RADIUS = 0.42;
const MAX_PUSH_CORRECTION = 0.12;
const PUSH_VERTICAL_TOLERANCE = 0.9;
const PUSH_EPSILON = 1e-6;
const PUSH_PASSIVE_STATES = new Set(["KNOCKDOWN", "THROW", "KO", "RING_OUT"]);

function pushRadius(fighter: FighterRuntime): number {
  return fighter.definition.archetype === "POWER" ? POWER_PUSH_RADIUS : SPEED_PUSH_RADIUS;
}

function pushMobility(fighter: FighterRuntime): number {
  if (PUSH_PASSIVE_STATES.has(fighter.state)) return 0;
  if (fighter.state === "HIT" || fighter.state === "BLOCK_STUN") return 0.35;
  return 1;
}

/**
 * Resolves only horizontal root overlap. Hit boxes, damage and knockback stay
 * untouched. The correction is capped per simulation tick so close-range
 * contact reads as body pressure rather than a visible teleport.
 */
export function resolveFighterPushboxes(first: FighterRuntime, second: FighterRuntime): boolean {
  if (first.hitStop > 0 || second.hitStop > 0) return false;
  if (Math.abs(first.position.y - second.position.y) > PUSH_VERTICAL_TOLERANCE) return false;

  const firstMobility = pushMobility(first);
  const secondMobility = pushMobility(second);
  if (firstMobility <= 0 && secondMobility <= 0) return false;

  let deltaX = second.position.x - first.position.x;
  let deltaZ = second.position.z - first.position.z;
  const minimumDistance = pushRadius(first) + pushRadius(second);
  const minimumDistanceSq = minimumDistance * minimumDistance;
  const distanceSq = deltaX * deltaX + deltaZ * deltaZ;
  if (distanceSq >= minimumDistanceSq) return false;

  let distance = Math.sqrt(distanceSq);
  let separationDistance = distance;
  if (distance < PUSH_EPSILON) {
    deltaX = first.facing >= 0 ? 1 : -1;
    deltaZ = 0;
    distance = 1;
    separationDistance = 0;
  }

  const normalX = deltaX / distance;
  const normalZ = deltaZ / distance;
  const penetration = minimumDistance - separationDistance;
  const correction = Math.min(MAX_PUSH_CORRECTION, Math.max(0, penetration));
  if (correction <= 0) return false;

  const mobilityTotal = firstMobility + secondMobility;
  const firstShare = mobilityTotal > 0 ? firstMobility / mobilityTotal : 0.5;
  const secondShare = mobilityTotal > 0 ? secondMobility / mobilityTotal : 0.5;

  first.position.x -= normalX * correction * firstShare;
  first.position.z -= normalZ * correction * firstShare;
  second.position.x += normalX * correction * secondShare;
  second.position.z += normalZ * correction * secondShare;
  return true;
}

export interface Hitbox {
  centerX: number;
  centerY: number;
  centerZ: number;
  halfX: number;
  halfY: number;
  halfZ: number;
  level: HitLevel;
}

export class HurtboxSystem {
  getHurtboxes(fighter: FighterRuntime): Hurtbox[] {
    if (fighter.state === "KO" || fighter.state === "RING_OUT") return [];
    const crouching = fighter.state === "CROUCH" || fighter.input.down;
    const baseY = fighter.position.y;
    const scale = crouching ? 0.78 : 1;
    return [
      {
        kind: "HEAD",
        centerX: fighter.position.x,
        centerY: baseY + 2.44 * scale,
        centerZ: fighter.position.z,
        halfX: 0.36,
        halfY: 0.36 * scale,
        halfZ: 0.34,
      },
      {
        kind: "BODY",
        centerX: fighter.position.x,
        centerY: baseY + 1.42 * scale,
        centerZ: fighter.position.z,
        halfX: 0.52,
        halfY: 0.7 * scale,
        halfZ: 0.42,
      },
      {
        kind: "LEGS",
        centerX: fighter.position.x,
        centerY: baseY + 0.54 * scale,
        centerZ: fighter.position.z,
        halfX: 0.5,
        halfY: 0.55 * scale,
        halfZ: 0.38,
      },
    ];
  }
}

export class HitboxSystem {
  getHitbox(attacker: FighterRuntime, move: MoveDefinition): Hitbox {
    const center = attackHitboxCenter(attacker.position, attacker.facing, move);
    return {
      centerX: center.x,
      centerY: center.y,
      centerZ: center.z,
      halfX: move.reach * 0.48,
      halfY: move.hitLevel === "LOW" ? 0.25 : move.height * 0.42,
      halfZ: move.width * 0.55,
      level: move.hitLevel,
    };
  }

  intersects(hitbox: Hitbox, hurtbox: Hurtbox): boolean {
    return (
      Math.abs(hitbox.centerX - hurtbox.centerX) <= hitbox.halfX + hurtbox.halfX &&
      Math.abs(hitbox.centerY - hurtbox.centerY) <= hitbox.halfY + hurtbox.halfY &&
      Math.abs(hitbox.centerZ - hurtbox.centerZ) <= hitbox.halfZ + hurtbox.halfZ
    );
  }
}

export class CombatSystem {
  readonly hurtboxes = new HurtboxSystem();
  readonly hitboxes = new HitboxSystem();
  onHit: ((event: HitEvent) => void) | null = null;

  resolve(attacker: FighterRuntime, defender: FighterRuntime): HitEvent | null {
    // PolyFightGame resolves p1->p2 and p2->p1 every tick. Use the stable id
    // ordering to perform the body separation exactly once before either hit
    // test, including ticks where neither fighter is attacking.
    if (attacker.id.localeCompare(defender.id) < 0) resolveFighterPushboxes(attacker, defender);

    const move = attacker.currentMove;
    if (
      !move ||
      !attacker.isActive() ||
      attacker.hitTargets.has(defender.id) ||
      attacker.state === "KO" ||
      attacker.state === "RING_OUT" ||
      defender.state === "KO" ||
      defender.state === "RING_OUT"
    ) return null;
    const hitbox = this.hitboxes.getHitbox(attacker, move);
    const defenderHurtboxes = this.hurtboxes.getHurtboxes(defender);
    const targetHurtbox = defenderHurtboxes.find((hurtbox) => {
      if (move.hitLevel === "LOW" && hurtbox.kind !== "LEGS") return false;
      if (move.hitLevel === "HIGH" && hurtbox.kind === "LEGS") return false;
      return this.hitboxes.intersects(hitbox, hurtbox);
    });
    if (!targetHurtbox) return null;

    attacker.hitTargets.add(defender.id);
    const counter = defender.state === "ATTACK" && !defender.isActive();
    if (move.hitLevel === "THROW") {
      const throwEscape =
        defender.justPressed("punch") && defender.input.guard;
      if (throwEscape) {
        const event = this.event(attacker, defender, move, false, false, true, 0, hitbox);
        this.onHit?.(event);
        return event;
      }
      defender.receiveThrow(move.damage, move.knockback, attacker.facing, move.hitStop);
      const event = this.event(attacker, defender, move, false, counter, false, move.damage, hitbox);
      this.onHit?.(event);
      return event;
    }

    const blocked = this.isGuarding(defender, move.hitLevel);
    const damage = Math.round(move.damage * (counter ? 1.25 : 1));
    if (blocked) {
      defender.receiveBlock(move.guardDamage, move.blockStun, Math.max(2, move.hitStop - 1));
    } else {
      const reactionSide = (move.visualContact ?? "BODY").startsWith("LEFT_") ? "LEFT" : "RIGHT";
      const reactionKind = counter
        ? "COUNTER"
        : damage <= 7
          ? "LIGHT"
          : damage <= 13
            ? "MID"
            : "HEAVY";
      const reactionAtEdge = Math.abs(defender.position.x) >= VISUAL_EDGE_X || Math.abs(defender.position.z) >= VISUAL_EDGE_Z;
      defender.setHitReactionVisual(reactionKind, reactionSide, reactionAtEdge);
      defender.receiveDamage(
        damage,
        move.hitStun,
        move.knockback,
        attacker.facing,
        Boolean(move.knockdown || move.launcher),
        move.hitStop,
      );
    }
    const event = this.event(attacker, defender, move, blocked, counter, false, blocked ? 0 : damage, hitbox);
    this.onHit?.(event);
    return event;
  }

  private isGuarding(defender: FighterRuntime, level: HitLevel): boolean {
    if (!defender.input.guard) return false;
    if (level === "LOW") return defender.input.down || defender.state === "CROUCH";
    if (level === "HIGH") return !defender.input.down && defender.state !== "CROUCH";
    return true;
  }

  private event(
    attacker: FighterRuntime,
    defender: FighterRuntime,
    move: MoveDefinition,
    blocked: boolean,
    counter: boolean,
    throwEscape: boolean,
    damage: number,
    hitbox: Hitbox,
  ): HitEvent {
    return {
      attacker: attacker.id,
      defender: defender.id,
      move,
      blocked,
      counter,
      throwEscape,
      damage,
      position: {
        x: hitbox.centerX,
        y: hitbox.centerY,
        z: hitbox.centerZ,
      },
    };
  }
}

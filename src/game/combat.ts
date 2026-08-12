import type {
  HitEvent,
  HitLevel,
  Hurtbox,
  MoveDefinition,
} from "./types";
import { FighterRuntime } from "./fighter";
import { attackHitboxCenter } from "./rig";

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

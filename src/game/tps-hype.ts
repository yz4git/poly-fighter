import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import type { HitEvent } from "./types";

export const TPS_HYPE_PROFILE = Object.freeze({
  lightSharedHitStopTicks: 3,
  mediumSharedHitStopTicks: 5,
  heavySharedHitStopTicks: 9,
  hitConfirmCancelLagTicks: 3,
  lightKnockbackScale: 1.04,
  mediumKnockbackScale: 1.14,
  heavyKnockbackScale: 1.46,
  launcherVerticalSpeed: 4.9,
  heavyKnockdownVerticalSpeed: 5.25,
  maxShockRings: 10,
  maxBurstSpokes: 4,
  lightImpactRingCount: 1,
  mediumImpactRingCount: 1,
  heavyImpactRingCount: 2,
  impactRingExpansion: 1.6,
  heavyBurstScale: 0.48,
  perfectStepFovRush: 4.8,
  dashFovRush: 3.8,
  heavyImpactFovPunch: -5.2,
});

type ImpactTier = 1 | 2 | 3;

interface ShockRing {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  life: number;
  maxLife: number;
  startScale: number;
}

interface BurstSpokes {
  lines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  life: number;
  maxLife: number;
  startScale: number;
}

export function tpsHypeImpactTier(moveId: string, power: number): ImpactTier {
  if (["power", "risingKick", "dashKick", "counter", "backfist"].includes(moveId) || power >= 1.6) return 3;
  if (["straight", "lowKick", "bodyBlow", "kick"].includes(moveId) || power >= 1.25) return 2;
  return 1;
}

export function tpsHypeHitStopForTier(tier: ImpactTier, blocked: boolean): number {
  if (blocked) return 1;
  if (tier === 3) return TPS_HYPE_PROFILE.heavySharedHitStopTicks;
  if (tier === 2) return TPS_HYPE_PROFILE.mediumSharedHitStopTicks;
  return TPS_HYPE_PROFILE.lightSharedHitStopTicks;
}

export function tpsHypeKnockbackScaleForTier(tier: ImpactTier): number {
  if (tier === 3) return TPS_HYPE_PROFILE.heavyKnockbackScale;
  if (tier === 2) return TPS_HYPE_PROFILE.mediumKnockbackScale;
  return TPS_HYPE_PROFILE.lightKnockbackScale;
}

function horizontalDirection(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3 {
  const result = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);
  return result.lengthSq() > 1e-8 ? result.normalize() : new THREE.Vector3(0, 0, 1);
}

function burstGeometry(): THREE.BufferGeometry {
  const values: number[] = [];
  const spokes = 18;
  for (let index = 0; index < spokes; index += 1) {
    const angle = index * Math.PI * 2 / spokes + (index % 2) * 0.045;
    const inner = 0.24 + (index % 3) * 0.035;
    const outer = 0.88 + (index % 4) * 0.11;
    values.push(
      Math.cos(angle) * inner,
      Math.sin(angle) * inner,
      0,
      Math.cos(angle) * outer,
      Math.sin(angle) * outer,
      0,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(values, 3));
  return geometry;
}

export class TpsHypeDirector {
  readonly group = new THREE.Group();
  private readonly ringGeometry = new THREE.RingGeometry(0.18, 0.235, 40);
  private readonly spokeGeometry = burstGeometry();
  private readonly rings: ShockRing[] = [];
  private readonly bursts: BurstSpokes[] = [];
  private fovOffset = 0;
  private cameraKick = 0;
  private cameraSide = 0;
  private cameraRoll = 0;
  private cameraShake = 0;
  private phase = 0;

  constructor(scene: THREE.Scene) {
    this.group.name = "tps-exhilaration-director";
    scene.add(this.group);

    for (let index = 0; index < TPS_HYPE_PROFILE.maxShockRings; index += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.ringGeometry, material);
      mesh.name = `tps-hype-shock-ring-${index}`;
      mesh.visible = false;
      mesh.renderOrder = 28;
      this.group.add(mesh);
      this.rings.push({ mesh, life: 0, maxLife: 0, startScale: 1 });
    }

    for (let index = 0; index < TPS_HYPE_PROFILE.maxBurstSpokes; index += 1) {
      const material = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const lines = new THREE.LineSegments(this.spokeGeometry, material);
      lines.name = `tps-hype-burst-spokes-${index}`;
      lines.visible = false;
      lines.renderOrder = 29;
      this.group.add(lines);
      this.bursts.push({ lines, life: 0, maxLife: 0, startScale: 1 });
    }
  }

  hit(event: HitEvent, camera: THREE.PerspectiveCamera): void {
    const tier = event.blocked ? 1 : tpsHypeImpactTier(event.move.id, event.move.power);
    const color = event.blocked
      ? 0x7deeff
      : event.counter
        ? 0xffe46f
        : event.attacker === "p1"
          ? 0xff4768
          : 0x4bdcff;
    const point = new THREE.Vector3(event.position.x, event.position.y, event.position.z);
    const facing = camera.position.clone().sub(point).normalize();
    const ringCount = event.blocked ? 1 : tier === 3 ? TPS_HYPE_PROFILE.heavyImpactRingCount : tier === 2 ? TPS_HYPE_PROFILE.mediumImpactRingCount : TPS_HYPE_PROFILE.lightImpactRingCount;

    for (let index = 0; index < ringCount; index += 1) {
      const ring = this.rings.find((entry) => entry.life <= 0) ?? this.rings[index % this.rings.length];
      ring.life = 0.16 + tier * 0.035 + index * 0.012;
      ring.maxLife = ring.life;
      ring.startScale = 0.56 + tier * 0.14 + index * 0.10;
      ring.mesh.visible = true;
      ring.mesh.position.copy(point);
      ring.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), facing);
      ring.mesh.rotateZ(index * 0.44 + tier * 0.11);
      ring.mesh.scale.setScalar(ring.startScale);
      ring.mesh.material.color.setHex(color);
      ring.mesh.material.opacity = event.blocked ? 0.36 : Math.max(0.38, 0.76 - index * 0.10);
    }

    const burst = this.bursts.find((entry) => entry.life <= 0) ?? this.bursts[0];
    burst.life = event.blocked ? 0.10 : tier === 3 ? 0.20 : tier === 2 ? 0.15 : 0.11;
    burst.maxLife = burst.life;
    burst.startScale = event.blocked ? 0.34 : tier === 3 ? TPS_HYPE_PROFILE.heavyBurstScale : tier === 2 ? 0.50 : 0.40;
    burst.lines.visible = true;
    burst.lines.position.copy(point);
    burst.lines.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), facing);
    burst.lines.rotation.z += tier * 0.17;
    burst.lines.scale.setScalar(burst.startScale);
    burst.lines.material.color.setHex(color);
    burst.lines.material.opacity = event.blocked ? 0.28 : tier === 3 ? 0.68 : 0.58;

    if (event.blocked) {
      this.fovOffset = Math.max(this.fovOffset, 0.65);
      this.cameraKick = Math.max(this.cameraKick, 0.018);
      this.cameraShake = Math.max(this.cameraShake, 0.018);
      return;
    }

    const tierFov = tier === 3 ? TPS_HYPE_PROFILE.heavyImpactFovPunch : tier === 2 ? -2.9 : -1.2;
    this.fovOffset = Math.min(this.fovOffset, tierFov);
    this.cameraKick = Math.max(this.cameraKick, tier === 3 ? 0.22 : tier === 2 ? 0.105 : 0.045);
    this.cameraSide = (event.attacker === "p1" ? 1 : -1)
      * Math.max(Math.abs(this.cameraSide), tier === 3 ? 0.105 : tier === 2 ? 0.052 : 0.024);
    this.cameraRoll = (event.attacker === "p1" ? -1 : 1)
      * Math.max(Math.abs(this.cameraRoll), tier === 3 ? 0.012 : tier === 2 ? 0.006 : 0.003);
    this.cameraShake = Math.max(this.cameraShake, tier === 3 ? 0.115 : tier === 2 ? 0.060 : 0.030);

    if (event.counter) {
      this.fovOffset = Math.min(this.fovOffset, -6.4);
      this.cameraKick = Math.max(this.cameraKick, 0.26);
      this.cameraShake = Math.max(this.cameraShake, 0.14);
    }

    this.group.userData.lastHypeImpactTier = tier;
    this.group.userData.lastHypeMove = event.move.id;
    this.group.userData.lastHypeCounter = event.counter;
  }

  step(fighter: FighterRuntime, opponent: FighterRuntime, perfect: boolean): void {
    const forward = horizontalDirection(fighter.position, opponent.position);
    const ring = this.rings.find((entry) => entry.life <= 0) ?? this.rings[0];
    ring.life = perfect ? 0.28 : 0.20;
    ring.maxLife = ring.life;
    ring.startScale = perfect ? 1.18 : 0.90;
    ring.mesh.visible = true;
    ring.mesh.position.copy(fighter.position).add(new THREE.Vector3(0, 0.05, 0));
    ring.mesh.rotation.set(-Math.PI / 2, 0, Math.atan2(forward.z, forward.x));
    ring.mesh.scale.setScalar(ring.startScale);
    ring.mesh.material.color.setHex(perfect ? 0x79ffc0 : fighter.definition.colors.glow);
    ring.mesh.material.opacity = perfect ? 0.72 : 0.42;

    this.fovOffset = Math.max(this.fovOffset, perfect ? TPS_HYPE_PROFILE.perfectStepFovRush : 2.8);
    this.cameraKick = Math.max(this.cameraKick, perfect ? 0.075 : 0.035);
    this.cameraShake = Math.max(this.cameraShake, perfect ? 0.038 : 0.018);
    this.group.userData.lastStepPerfect = perfect;
  }

  dash(): void {
    this.fovOffset = Math.max(this.fovOffset, TPS_HYPE_PROFILE.dashFovRush);
    this.cameraKick = Math.max(this.cameraKick, 0.055);
    this.cameraShake = Math.max(this.cameraShake, 0.022);
  }

  comboShift(stage: number): void {
    this.fovOffset = Math.max(this.fovOffset, 1.0 + stage * 0.55);
    this.cameraKick = Math.max(this.cameraKick, 0.020 + stage * 0.012);
    this.group.userData.lastComboShiftStage = stage;
  }

  update(camera: THREE.PerspectiveCamera, delta: number): void {
    this.phase += delta;

    for (const ring of this.rings) {
      if (ring.life <= 0) continue;
      ring.life -= delta;
      const progress = 1 - Math.max(0, ring.life) / Math.max(1e-4, ring.maxLife);
      ring.mesh.scale.setScalar(ring.startScale * (1 + progress * TPS_HYPE_PROFILE.impactRingExpansion));
      ring.mesh.material.opacity = Math.max(0, (1 - progress) * 0.82);
      if (ring.life <= 0) {
        ring.mesh.visible = false;
        ring.mesh.material.opacity = 0;
      }
    }

    for (const burst of this.bursts) {
      if (burst.life <= 0) continue;
      burst.life -= delta;
      const progress = 1 - Math.max(0, burst.life) / Math.max(1e-4, burst.maxLife);
      burst.lines.scale.setScalar(burst.startScale * (1 + progress * 1.75));
      burst.lines.material.opacity = Math.max(0, (1 - progress) * 0.92);
      if (burst.life <= 0) {
        burst.lines.visible = false;
        burst.lines.material.opacity = 0;
      }
    }

    const baseFov = camera.aspect < 2.4 && camera.aspect > 1 ? 52 : 47;
    if (Math.abs(this.fovOffset) > 0.01) {
      camera.fov = THREE.MathUtils.clamp(baseFov + this.fovOffset, 38, 58);
      camera.updateProjectionMatrix();
      this.fovOffset *= Math.exp(-13.5 * delta);
    } else if (Math.abs(camera.fov - baseFov) > 0.01) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, baseFov, 1 - Math.exp(-16 * delta));
      camera.updateProjectionMatrix();
    }

    if (this.cameraKick > 0.0005) {
      camera.translateZ(this.cameraKick);
      this.cameraKick *= Math.exp(-17 * delta);
    }
    if (Math.abs(this.cameraSide) > 0.0005) {
      camera.translateX(this.cameraSide);
      this.cameraSide *= Math.exp(-20 * delta);
    }
    if (Math.abs(this.cameraRoll) > 0.00005) {
      camera.rotation.z += this.cameraRoll;
      this.cameraRoll *= Math.exp(-19 * delta);
    }
    if (this.cameraShake > 0.0005) {
      const shake = this.cameraShake;
      camera.translateX(Math.sin(this.phase * 127) * shake);
      camera.translateY(Math.cos(this.phase * 149) * shake * 0.42);
      this.cameraShake *= Math.exp(-24 * delta);
    }
  }

  reset(camera: THREE.PerspectiveCamera): void {
    this.fovOffset = 0;
    this.cameraKick = 0;
    this.cameraSide = 0;
    this.cameraRoll = 0;
    this.cameraShake = 0;
    const baseFov = camera.aspect < 2.4 && camera.aspect > 1 ? 52 : 47;
    camera.fov = baseFov;
    camera.updateProjectionMatrix();
    for (const ring of this.rings) {
      ring.life = 0;
      ring.mesh.visible = false;
      ring.mesh.material.opacity = 0;
    }
    for (const burst of this.bursts) {
      burst.life = 0;
      burst.lines.visible = false;
      burst.lines.material.opacity = 0;
    }
  }

  dispose(): void {
    this.ringGeometry.dispose();
    this.spokeGeometry.dispose();
    for (const ring of this.rings) ring.mesh.material.dispose();
    for (const burst of this.bursts) burst.lines.material.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}

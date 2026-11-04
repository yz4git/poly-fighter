import * as THREE from "three";
import type { HitEvent } from "./types";
import { tpsDecorativeHitLane } from "./tps-screen-readability";

/**
 * Presentation-only, pooled spectacle. No combat timers, collision volumes or
 * input are modified. Everything is geometry + material, so it also runs on
 * mobile Safari without postprocessing or a texture download.
 */
export type CinematicImpactTier = 1 | 2 | 3;

export interface CinematicImpactStyle {
  shards: number;
  groundWaves: number;
  scale: number;
  opacity: number;
  duration: number;
}

export function cinematicImpactStyle(
  tier: CinematicImpactTier,
  blocked: boolean,
  counter: boolean,
  signature: boolean,
  streak: number,
  finishing: boolean,
): CinematicImpactStyle {
  if (blocked) return { shards: 1, groundWaves: 0, scale: 0.45, opacity: 0.16, duration: 0.10 };
  const crescendo = Math.min(3, Math.max(0, streak - 1));
  const major = tier === 3 || counter || signature;
  return {
    // Build excitement through successive confirmed contacts, not idle flashing.
    shards: finishing ? 1 : major || crescendo >= 2 ? 2 : 1,
    groundWaves: finishing ? 1 : signature ? 2 : major || crescendo >= 2 ? 1 : 0,
    scale: (tier === 3 ? 1.08 : tier === 2 ? 0.87 : 0.64) + crescendo * 0.12,
    // FINAL IMPACT already has a large halo and lens hold; don't white-out the KO.
    opacity: finishing ? 0.29 : Math.min(0.47, 0.22 + tier * 0.055 + crescendo * 0.032 + (counter ? 0.055 : 0)),
    duration: finishing ? 0.23 : Math.min(0.27, 0.12 + tier * 0.032 + crescendo * 0.012),
  };
}

type Shard = {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  life: number;
  duration: number;
  opacity: number;
  scale: number;
};

type GroundWave = {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  life: number;
  duration: number;
  opacity: number;
  radius: number;
};

/** Filled tapered shards are visible on iOS, unlike WebGL 1px line-width rays. */
function makeShardsGeometry(): THREE.BufferGeometry {
  const points: number[] = [];
  const count = 14;
  for (let index = 0; index < count; index += 1) {
    const angle = index * Math.PI * 2 / count + (index % 3) * 0.075;
    const radialX = Math.cos(angle);
    const radialY = Math.sin(angle);
    const tangentX = -radialY;
    const tangentY = radialX;
    const start = 0.37 + (index % 3) * 0.075;
    const end = 0.92 + (index % 5) * 0.085;
    const halfWidth = 0.026 + (index % 4) * 0.008;
    points.push(
      radialX * start + tangentX * halfWidth,
      radialY * start + tangentY * halfWidth,
      0,
      radialX * start - tangentX * halfWidth,
      radialY * start - tangentY * halfWidth,
      0,
      radialX * end,
      radialY * end,
      0,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  return geometry;
}

export class TpsCinematicImpactSpectacle {
  readonly group = new THREE.Group();
  private readonly shardGeometry = makeShardsGeometry();
  private readonly groundGeometry = new THREE.RingGeometry(0.86, 1.0, 48);
  private readonly shards: Shard[] = [];
  private readonly groundWaves: GroundWave[] = [];

  constructor(parent: THREE.Group) {
    this.group.name = "tps-cinematic-impact-spectacle";
    parent.add(this.group);
    // Five pooled draw calls maximum (2 shards + 2 waves in normal play).
    // Additional spare slots prevent a rapid clash from reallocating GPU objects.
    for (let index = 0; index < 3; index += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.shardGeometry, material);
      mesh.name = `tps-cinematic-shards-${index}`;
      mesh.visible = false;
      mesh.renderOrder = 25;
      this.group.add(mesh);
      this.shards.push({ mesh, life: 0, duration: 0, opacity: 0, scale: 1 });
    }

    for (let index = 0; index < 3; index += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.groundGeometry, material);
      mesh.name = `tps-cinematic-ground-wave-${index}`;
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 17;
      this.group.add(mesh);
      this.groundWaves.push({ mesh, life: 0, duration: 0, opacity: 0, radius: 1 });
    }
  }

  hit(
    event: HitEvent,
    camera: THREE.PerspectiveCamera,
    tier: CinematicImpactTier,
    streak: number,
  ): void {
    const finishing = camera.userData.tpsFinalImpactStage === "HOLD";
    const signature = Boolean(event.move.cinematicRole);
    const style = cinematicImpactStyle(tier, event.blocked, event.counter, signature, streak, finishing);
    const color = event.blocked ? 0x61dfff
      : event.counter ? 0xffe681
      : signature ? 0xffa868
      : event.attacker === "p1" ? 0xff527a : 0x69dfff;
    const point = new THREE.Vector3(event.position.x, event.position.y, event.position.z);
    const normal = camera.position.clone().sub(point).normalize();
    const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
    const decorativeLane = tpsDecorativeHitLane(event);
    const viewRotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);

    // Keep the next attack's silhouette readable rather than stacking
    // opaque flashes from unrelated hits in the same 200 ms window.
    this.clearActive();

    for (let index = 0; index < style.shards; index += 1) {
      const shard = this.shards[index];
      shard.life = style.duration + index * 0.027;
      shard.duration = shard.life;
      shard.scale = style.scale * (index === 0 ? 1 : 1.30);
      shard.opacity = style.opacity * (index === 0 ? 1 : 0.53);
      shard.mesh.position.copy(point)
        .addScaledVector(cameraRight, decorativeLane)
        .addScaledVector(normal, finishing ? -0.23 : -0.14);
      shard.mesh.quaternion.copy(viewRotation);
      shard.mesh.rotateZ(index * 0.35 + (streak % 4) * 0.12);
      shard.mesh.scale.setScalar(shard.scale);
      shard.mesh.material.color.setHex(index === 0 ? color : 0xffffff);
      shard.mesh.material.opacity = shard.opacity;
      shard.mesh.visible = true;
    }

    for (let index = 0; index < style.groundWaves; index += 1) {
      const wave = this.groundWaves[index];
      wave.life = 0.29 + index * 0.07 + (signature ? 0.05 : 0);
      wave.duration = wave.life;
      wave.opacity = finishing ? 0.24 : index === 0 ? 0.34 : 0.21;
      wave.radius = (signature ? 3.8 : 3.1) + index * 0.75 + Math.min(3, streak) * 0.18;
      wave.mesh.position.set(point.x, 0.045 + index * 0.008, point.z);
      wave.mesh.scale.setScalar(0.32);
      wave.mesh.material.color.setHex(index === 0 ? color : 0xffffff);
      wave.mesh.material.opacity = wave.opacity;
      wave.mesh.visible = true;
    }

    this.group.userData.tpsCinematicHitStreak = streak;
    this.group.userData.tpsCinematicShardLayers = style.shards;
    this.group.userData.tpsCinematicGroundWaves = style.groundWaves;
    this.group.userData.tpsCinematicFinishing = finishing;
    this.group.userData.tpsCinematicLastMove = event.move.id;
    this.group.userData.tpsDecorativeImpactLane = decorativeLane;
  }

  update(delta: number): void {
    for (const shard of this.shards) {
      if (shard.life <= 0) continue;
      shard.life = Math.max(0, shard.life - delta);
      const progress = 1 - shard.life / Math.max(0.001, shard.duration);
      shard.mesh.scale.setScalar(shard.scale * (1 + progress * 0.76));
      shard.mesh.material.opacity = shard.opacity * Math.pow(1 - progress, 1.5);
      if (shard.life <= 0) shard.mesh.visible = false;
    }
    for (const wave of this.groundWaves) {
      if (wave.life <= 0) continue;
      wave.life = Math.max(0, wave.life - delta);
      const progress = 1 - wave.life / Math.max(0.001, wave.duration);
      wave.mesh.scale.setScalar(0.32 + progress * wave.radius);
      wave.mesh.material.opacity = wave.opacity * Math.pow(1 - progress, 1.8);
      if (wave.life <= 0) wave.mesh.visible = false;
    }
  }

  private clearActive(): void {
    for (const shard of this.shards) {
      shard.life = 0;
      shard.mesh.visible = false;
      shard.mesh.material.opacity = 0;
    }
    for (const wave of this.groundWaves) {
      wave.life = 0;
      wave.mesh.visible = false;
      wave.mesh.material.opacity = 0;
    }
  }

  reset(): void {
    this.clearActive();
    this.group.userData.tpsCinematicHitStreak = 0;
    this.group.userData.tpsCinematicShardLayers = 0;
    this.group.userData.tpsCinematicGroundWaves = 0;
    this.group.userData.tpsCinematicFinishing = false;
  }

  dispose(): void {
    this.clearActive();
    this.group.removeFromParent();
    for (const shard of this.shards) shard.mesh.material.dispose();
    for (const wave of this.groundWaves) wave.mesh.material.dispose();
    this.shardGeometry.dispose();
    this.groundGeometry.dispose();
    this.group.clear();
  }
}

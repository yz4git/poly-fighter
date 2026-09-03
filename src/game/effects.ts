import * as THREE from "three";
import { recordMotionHit } from "./motion-reaction";
import type { HitEvent } from "./types";

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

interface Flash {
  mesh: THREE.Mesh;
  life: number;
}

function impactTier(event: HitEvent): 1 | 2 | 3 {
  const id = event.move.id;
  if (["power", "risingKick", "dashKick", "counter", "backfist"].includes(id) || event.move.power >= 1.6) return 3;
  if (["straight", "lowKick", "bodyBlow", "kick"].includes(id) || event.move.power >= 1.25) return 2;
  return 1;
}

export class EffectsManager {
  readonly group = new THREE.Group();
  private readonly fragments: Particle[] = [];
  private readonly flashes: Flash[] = [];
  private readonly fragmentGeometry = new THREE.TetrahedronGeometry(0.07, 0);
  // A thin camera-facing ring preserves the exact fist/foot silhouette through
  // the impact frame. The previous expanding icosahedron could cover most of a
  // forearm or torso on strong hits at iPhone landscape scale.
  private readonly flashGeometry = new THREE.TorusGeometry(0.18, 0.034, 5, 16);
  private readonly materials = new Map<number, THREE.MeshStandardMaterial>();
  onShake: ((amount: number) => void) | null = null;

  constructor() {
    this.group.name = "impact-effects";
    const fragmentMaterial = this.materialFor(0xffffff);
    for (let index = 0; index < 64; index += 1) {
      const mesh = new THREE.Mesh(this.fragmentGeometry, fragmentMaterial);
      mesh.visible = false;
      mesh.castShadow = true;
      this.group.add(mesh);
      this.fragments.push({ mesh, velocity: new THREE.Vector3(), life: 0, maxLife: 0 });
    }
    for (let index = 0; index < 10; index += 1) {
      const mesh = new THREE.Mesh(
        this.flashGeometry,
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.82,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      mesh.visible = false;
      this.group.add(mesh);
      this.flashes.push({ mesh, life: 0 });
    }
  }

  hit(event: HitEvent): void {
    // Motion Expansion listens at the shared impact presentation layer so TPS
    // and the classic battle runtime drive the same directional reaction model.
    recordMotionHit(event);
    const color = event.blocked ? 0x63e9ff : event.counter ? 0xffd45c : event.attacker === "p1" ? 0xff405d : 0x58e7ff;
    const tier = event.blocked ? 1 : impactTier(event);
    const tierScale = tier === 3 ? 1.42 : tier === 2 ? 1.18 : 1;
    const strength = event.move.power * (event.blocked ? 0.72 : 1) * tierScale;
    const visualStrength = Math.min(2.15, strength);

    // Keep the amount of debris proportional to hit strength, but cap both the
    // count and individual size so the striking limb remains readable.
    let remaining = Math.min(18, Math.round(4 + visualStrength * (tier === 3 ? 5 : 4)));
    for (const particle of this.fragments) {
      if (remaining <= 0) break;
      if (particle.life > 0) continue;
      particle.mesh.visible = true;
      particle.mesh.material = this.materialFor(color);
      particle.mesh.position.set(event.position.x, event.position.y, event.position.z);
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.35 + Math.random() * 3.15 * visualStrength;
      particle.velocity.set(
        Math.cos(angle) * speed,
        0.9 + Math.random() * 2.75 * visualStrength,
        Math.sin(angle) * speed * 0.58,
      );
      particle.life = 0.18 + Math.random() * 0.24 + (tier - 1) * 0.025;
      particle.maxLife = particle.life;
      const size = (0.52 + Math.random() * 0.52 * visualStrength) * (tier === 3 ? 1.06 : 1);
      particle.mesh.scale.setScalar(size);
      remaining -= 1;
    }

    const flash = this.flashes.find((item) => item.life <= 0);
    if (flash) {
      flash.mesh.visible = true;
      flash.mesh.position.set(event.position.x, event.position.y, event.position.z + 0.035);
      flash.mesh.rotation.set(0, 0, Math.random() * Math.PI);
      flash.mesh.scale.setScalar((0.72 + visualStrength * 0.22) * (tier === 3 ? 1.08 : 1));
      const flashMaterial = flash.mesh.material as THREE.MeshBasicMaterial;
      flashMaterial.color.setHex(color);
      flashMaterial.opacity = event.blocked ? 0.52 : tier === 3 ? 0.86 : 0.76;
      flash.life = 0.105 + visualStrength * 0.022 + (tier - 1) * 0.012;
    }

    // Preserve impact weight primarily through hit-stop, reaction motion and
    // camera impulse rather than by making the contact sprite cover the model.
    const shake = event.blocked ? 0.035 : (0.07 + strength * 0.04) * (tier === 3 ? 1.22 : tier === 2 ? 1.08 : 1);
    this.onShake?.(shake);
  }

  private materialFor(color: number): THREE.MeshStandardMaterial {
    const existing = this.materials.get(color);
    if (existing) return existing;
    const created = new THREE.MeshStandardMaterial({
      color,
      flatShading: true,
      emissive: color,
      emissiveIntensity: 0.3,
      roughness: 0.72,
    });
    this.materials.set(color, created);
    return created;
  }

  update(deltaSeconds: number): void {
    for (const particle of this.fragments) {
      if (particle.life <= 0) continue;
      particle.life -= deltaSeconds;
      particle.velocity.y -= 8 * deltaSeconds;
      particle.mesh.position.addScaledVector(particle.velocity, deltaSeconds);
      particle.mesh.rotation.x += deltaSeconds * 8;
      particle.mesh.rotation.y += deltaSeconds * 11;
      particle.mesh.scale.multiplyScalar(0.982);
      if (particle.life <= 0) particle.mesh.visible = false;
    }
    for (const flash of this.flashes) {
      if (flash.life <= 0) continue;
      flash.life -= deltaSeconds;
      flash.mesh.scale.multiplyScalar(1.08);
      const material = flash.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = Math.max(0, flash.life * 5.8);
      if (flash.life <= 0) flash.mesh.visible = false;
    }
  }

  resourceStats(): { fragmentMaterials: number; flashMaterials: number; geometries: number } {
    return { fragmentMaterials: this.materials.size, flashMaterials: this.flashes.length, geometries: 2 };
  }

  dispose(): void {
    this.fragmentGeometry.dispose();
    this.flashGeometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    const flashMaterials = new Set<THREE.Material>();
    for (const flash of this.flashes) {
      const material = flash.mesh.material;
      if (Array.isArray(material)) material.forEach((entry) => flashMaterials.add(entry));
      else flashMaterials.add(material);
    }
    for (const material of flashMaterials) material.dispose();
    this.group.clear();
  }
}

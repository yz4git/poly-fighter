import * as THREE from "three";
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
  private readonly fragmentGeometry = new THREE.TetrahedronGeometry(0.085, 0);
  private readonly flashGeometry = new THREE.IcosahedronGeometry(0.18, 1);
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
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending }),
      );
      mesh.visible = false;
      this.group.add(mesh);
      this.flashes.push({ mesh, life: 0 });
    }
  }

  hit(event: HitEvent): void {
    const color = event.blocked ? 0x63e9ff : event.counter ? 0xffd45c : event.attacker === "p1" ? 0xff405d : 0x58e7ff;
    const tier = event.blocked ? 1 : impactTier(event);
    const tierScale = tier === 3 ? 1.42 : tier === 2 ? 1.18 : 1;
    const strength = event.move.power * (event.blocked ? 0.72 : 1) * tierScale;
    let remaining = Math.min(22, Math.round(5 + strength * (tier === 3 ? 6 : 4.5)));
    for (const particle of this.fragments) {
      if (remaining <= 0) break;
      if (particle.life > 0) continue;
      particle.mesh.visible = true;
      particle.mesh.material = this.materialFor(color);
      particle.mesh.position.set(event.position.x, event.position.y, event.position.z);
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3.6 * strength;
      particle.velocity.set(Math.cos(angle) * speed, 1 + Math.random() * 3.2 * strength, Math.sin(angle) * speed * 0.65);
      particle.life = 0.22 + Math.random() * 0.3 + (tier - 1) * 0.035;
      particle.maxLife = particle.life;
      particle.mesh.scale.setScalar((0.65 + Math.random() * 1.25 * strength) * (tier === 3 ? 1.12 : 1));
      remaining -= 1;
    }
    const flash = this.flashes.find((item) => item.life <= 0);
    if (flash) {
      flash.mesh.visible = true;
      flash.mesh.position.set(event.position.x, event.position.y, event.position.z);
      flash.mesh.scale.setScalar((0.7 + strength * 0.56) * (tier === 3 ? 1.18 : 1));
      const flashMaterial = flash.mesh.material as THREE.MeshBasicMaterial;
      flashMaterial.color.setHex(color);
      flashMaterial.opacity = event.blocked ? 0.62 : tier === 3 ? 1 : 0.94;
      flash.life = 0.16 + strength * 0.04 + (tier - 1) * 0.02;
    }
    const shake = event.blocked ? 0.035 : (0.07 + strength * 0.04) * (tier === 3 ? 1.22 : tier === 2 ? 1.08 : 1);
    this.onShake?.(shake);
  }

  private materialFor(color: number): THREE.MeshStandardMaterial {
    const existing = this.materials.get(color);
    if (existing) return existing;
    const created = new THREE.MeshStandardMaterial({ color, flatShading: true, emissive: color, emissiveIntensity: 0.3 });
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
      particle.mesh.scale.multiplyScalar(0.985);
      if (particle.life <= 0) particle.mesh.visible = false;
    }
    for (const flash of this.flashes) {
      if (flash.life <= 0) continue;
      flash.life -= deltaSeconds;
      flash.mesh.scale.multiplyScalar(1.12);
      const material = flash.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = Math.max(0, flash.life * 5);
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

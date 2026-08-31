import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import type { HitEvent } from "./types";

export const TPS_GRAPHICS_PROFILE = Object.freeze({
  contactShadows: true,
  localRimLights: 2,
  impactWavePool: 8,
  toneMapping: "ACESFilmic",
  lowAtmospherePoints: 42,
  mediumAtmospherePoints: 72,
  highAtmospherePoints: 108,
});

type GraphicsQuality = "LOW" | "MEDIUM" | "HIGH" | string;

interface ImpactWave {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  life: number;
  maxLife: number;
}

function pointCount(quality: GraphicsQuality): number {
  if (quality === "LOW") return TPS_GRAPHICS_PROFILE.lowAtmospherePoints;
  if (quality === "HIGH") return TPS_GRAPHICS_PROFILE.highAtmospherePoints;
  return TPS_GRAPHICS_PROFILE.mediumAtmospherePoints;
}

export class TpsGraphicsDirector {
  readonly group = new THREE.Group();
  private readonly shadowGeometry = new THREE.CircleGeometry(0.62, 28);
  private readonly p1ShadowMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });
  private readonly p2ShadowMaterial = this.p1ShadowMaterial.clone();
  private readonly p1Shadow = new THREE.Mesh(this.shadowGeometry, this.p1ShadowMaterial);
  private readonly p2Shadow = new THREE.Mesh(this.shadowGeometry, this.p2ShadowMaterial);
  private readonly playerGroundGeometry = new THREE.RingGeometry(0.53, 0.61, 40);
  private readonly playerGroundMaterial = new THREE.MeshBasicMaterial({
    color: 0xff5374,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  private readonly playerGroundRing = new THREE.Mesh(this.playerGroundGeometry, this.playerGroundMaterial);
  private readonly arenaGlowGeometry: THREE.RingGeometry;
  private readonly arenaGlowMaterial = new THREE.MeshBasicMaterial({
    color: 0x38cfff,
    transparent: true,
    opacity: 0.11,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  private readonly arenaGlow: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly centerGlowGeometry = new THREE.RingGeometry(1.05, 1.15, 56);
  private readonly centerGlowMaterial = new THREE.MeshBasicMaterial({
    color: 0x4ddcff,
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  private readonly centerGlow = new THREE.Mesh(this.centerGlowGeometry, this.centerGlowMaterial);
  private readonly p1Rim = new THREE.PointLight(0xff476a, 0.9, 4.6, 2);
  private readonly p2Rim = new THREE.PointLight(0x54caff, 0.9, 4.6, 2);
  private readonly impactLight = new THREE.PointLight(0xffffff, 0, 4.2, 2);
  private readonly atmosphereGeometry = new THREE.BufferGeometry();
  private readonly atmosphereMaterial = new THREE.PointsMaterial({
    color: 0x70dfff,
    size: 0.045,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
  });
  private readonly atmosphere: THREE.Points;
  private readonly waveGeometry = new THREE.RingGeometry(0.18, 0.25, 32);
  private readonly waves: ImpactWave[] = [];
  private quality: GraphicsQuality;
  private impactLightLife = 0;

  constructor(
    scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
    arenaRadius: number,
    quality: GraphicsQuality,
  ) {
    this.quality = quality;
    this.group.name = "tps-graphics-director";
    scene.add(this.group);

    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = quality === "HIGH" ? 1.12 : quality === "LOW" ? 1.02 : 1.08;

    this.p1Shadow.name = "tps-contact-shadow-p1";
    this.p2Shadow.name = "tps-contact-shadow-p2";
    for (const shadow of [this.p1Shadow, this.p2Shadow]) {
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.018;
      shadow.renderOrder = 2;
    }
    this.playerGroundRing.name = "tps-player-ground-ring";
    this.playerGroundRing.rotation.x = -Math.PI / 2;
    this.playerGroundRing.position.y = 0.028;

    this.arenaGlowGeometry = new THREE.RingGeometry(arenaRadius - 0.36, arenaRadius - 0.20, 96);
    this.arenaGlow = new THREE.Mesh(this.arenaGlowGeometry, this.arenaGlowMaterial);
    this.arenaGlow.name = "tps-arena-energy-ring";
    this.arenaGlow.rotation.x = -Math.PI / 2;
    this.arenaGlow.position.y = 0.022;

    this.centerGlow.name = "tps-center-energy-ring";
    this.centerGlow.rotation.x = -Math.PI / 2;
    this.centerGlow.position.y = 0.025;

    this.p1Rim.name = "tps-rim-light-p1";
    this.p2Rim.name = "tps-rim-light-p2";
    this.impactLight.name = "tps-impact-light";

    const count = pointCount(quality);
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const angle = index * 2.399963229728653;
      const radius = arenaRadius + 3.0 + (index % 13) * 0.72;
      positions[index * 3] = Math.cos(angle) * radius;
      positions[index * 3 + 1] = 1.2 + ((index * 17) % 31) * 0.22;
      positions[index * 3 + 2] = Math.sin(angle) * radius;
    }
    this.atmosphereGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.atmosphere = new THREE.Points(this.atmosphereGeometry, this.atmosphereMaterial);
    this.atmosphere.name = "tps-atmosphere-points";

    this.group.add(
      this.p1Shadow,
      this.p2Shadow,
      this.playerGroundRing,
      this.arenaGlow,
      this.centerGlow,
      this.p1Rim,
      this.p2Rim,
      this.impactLight,
      this.atmosphere,
    );

    for (let index = 0; index < TPS_GRAPHICS_PROFILE.impactWavePool; index += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.waveGeometry, material);
      mesh.name = `tps-impact-wave-${index}`;
      mesh.visible = false;
      mesh.renderOrder = 24;
      this.group.add(mesh);
      this.waves.push({ mesh, life: 0, maxLife: 0 });
    }
  }

  setQuality(quality: GraphicsQuality): void {
    this.quality = quality;
    this.renderer.toneMappingExposure = quality === "HIGH" ? 1.12 : quality === "LOW" ? 1.02 : 1.08;
    const low = quality === "LOW";
    this.atmosphere.visible = !low;
    this.p1Rim.intensity = low ? 0.46 : 0.9;
    this.p2Rim.intensity = low ? 0.46 : 0.9;
  }

  hit(event: HitEvent, camera: THREE.Camera): void {
    const color = event.blocked ? 0x62e8ff : event.counter ? 0xffd85d : event.attacker === "p1" ? 0xff4f70 : 0x58d9ff;
    const strength = Math.max(0.7, event.move.power * (event.blocked ? 0.7 : 1));
    const wave = this.waves.find((item) => item.life <= 0) ?? this.waves[0];
    wave.life = 0.18 + strength * 0.035;
    wave.maxLife = wave.life;
    wave.mesh.visible = true;
    wave.mesh.position.set(event.position.x, event.position.y, event.position.z);
    wave.mesh.scale.setScalar(0.72 + strength * 0.22);
    wave.mesh.material.color.setHex(color);
    wave.mesh.material.opacity = event.blocked ? 0.45 : 0.78;
    const facing = camera.position.clone().sub(wave.mesh.position).normalize();
    wave.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), facing);

    this.impactLight.position.set(event.position.x, event.position.y, event.position.z);
    this.impactLight.color.setHex(color);
    this.impactLight.intensity = this.quality === "LOW" ? 1.1 : 3.8 + strength * 1.4;
    this.impactLightLife = 0.12 + strength * 0.025;
  }

  update(p1: FighterRuntime, p2: FighterRuntime, time: number, delta: number): void {
    this.updateFighterShadow(this.p1Shadow, this.p1ShadowMaterial, p1, time);
    this.updateFighterShadow(this.p2Shadow, this.p2ShadowMaterial, p2, time + 0.37);

    this.playerGroundRing.position.set(p1.position.x, 0.028, p1.position.z);
    const playerPulse = 0.96 + Math.sin(time * 5.2) * 0.045;
    this.playerGroundRing.scale.setScalar(playerPulse);
    this.playerGroundMaterial.opacity = p1.state === "SIDESTEP" ? 0.36 : p1.state === "ATTACK" ? 0.28 : 0.17;

    this.p1Rim.position.set(p1.position.x - 0.15, 1.28, p1.position.z + 0.15);
    this.p2Rim.position.set(p2.position.x + 0.15, 1.28, p2.position.z - 0.15);
    const rimPulse = 0.88 + Math.sin(time * 4.4) * 0.08;
    if (this.quality !== "LOW") {
      this.p1Rim.intensity = (p1.state === "ATTACK" ? 1.35 : 0.82) * rimPulse;
      this.p2Rim.intensity = (p2.state === "ATTACK" ? 1.35 : 0.82) * rimPulse;
    }

    this.arenaGlowMaterial.opacity = 0.09 + Math.sin(time * 1.7) * 0.025;
    this.centerGlowMaterial.opacity = 0.055 + Math.sin(time * 2.3 + 0.8) * 0.025;
    const arenaPulse = 1 + Math.sin(time * 1.55) * 0.0025;
    this.arenaGlow.scale.setScalar(arenaPulse);
    this.atmosphere.rotation.y = time * 0.012;

    for (const wave of this.waves) {
      if (wave.life <= 0) continue;
      wave.life -= delta;
      const progress = 1 - Math.max(0, wave.life) / Math.max(1e-4, wave.maxLife);
      wave.mesh.scale.multiplyScalar(1 + delta * (4.6 + progress * 2.2));
      wave.mesh.material.opacity = Math.max(0, (1 - progress) * 0.78);
      if (wave.life <= 0) {
        wave.mesh.visible = false;
        wave.mesh.material.opacity = 0;
      }
    }

    if (this.impactLightLife > 0) {
      this.impactLightLife -= delta;
      this.impactLight.intensity *= Math.exp(-18 * delta);
      if (this.impactLightLife <= 0) this.impactLight.intensity = 0;
    }
  }

  reset(): void {
    this.impactLight.intensity = 0;
    this.impactLightLife = 0;
    for (const wave of this.waves) {
      wave.life = 0;
      wave.maxLife = 0;
      wave.mesh.visible = false;
      wave.mesh.material.opacity = 0;
    }
  }

  private updateFighterShadow(
    shadow: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>,
    material: THREE.MeshBasicMaterial,
    fighter: FighterRuntime,
    time: number,
  ): void {
    shadow.position.set(fighter.position.x, 0.018, fighter.position.z);
    const airborne = fighter.state === "JUMP" || fighter.position.y > 0.08;
    const evadeStretch = fighter.state === "SIDESTEP" ? 1.18 : 1;
    shadow.scale.set(evadeStretch, 1, 1);
    material.opacity = airborne ? 0.11 : 0.25 + Math.sin(time * 3.7) * 0.018;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.shadowGeometry.dispose();
    this.p1ShadowMaterial.dispose();
    this.p2ShadowMaterial.dispose();
    this.playerGroundGeometry.dispose();
    this.playerGroundMaterial.dispose();
    this.arenaGlowGeometry.dispose();
    this.arenaGlowMaterial.dispose();
    this.centerGlowGeometry.dispose();
    this.centerGlowMaterial.dispose();
    this.atmosphereGeometry.dispose();
    this.atmosphereMaterial.dispose();
    this.waveGeometry.dispose();
    for (const wave of this.waves) wave.mesh.material.dispose();
    this.group.clear();
  }
}

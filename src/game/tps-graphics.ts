import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import type { HitEvent } from "./types";

export const TPS_GRAPHICS_PROFILE = Object.freeze({
  contactShadows: true,
  localRimLights: 2,
  impactWavePool: 8,
  attackTrailPool: 6,
  quickstepGhostPool: 4,
  skylineMonoliths: 8,
  floorAccentArcs: 12,
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

interface AttackTrail {
  mesh: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  life: number;
  maxLife: number;
}

interface GhostPulse {
  group: THREE.Group;
  material: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
}

function pointCount(quality: GraphicsQuality): number {
  if (quality === "LOW") return TPS_GRAPHICS_PROFILE.lowAtmospherePoints;
  if (quality === "HIGH") return TPS_GRAPHICS_PROFILE.highAtmospherePoints;
  return TPS_GRAPHICS_PROFILE.mediumAtmospherePoints;
}

function horizontalDirection(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3 {
  const result = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);
  return result.lengthSq() > 1e-8 ? result.normalize() : new THREE.Vector3(0, 0, 1);
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
  private readonly floorCoreGeometry = new THREE.CircleGeometry(1.28, 56);
  private readonly floorCoreMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x0a2036,
    emissive: 0x02101d,
    emissiveIntensity: 0.42,
    metalness: 0.34,
    roughness: 0.48,
    clearcoat: 0.34,
    clearcoatRoughness: 0.72,
  });
  private readonly floorCore = new THREE.Mesh(this.floorCoreGeometry, this.floorCoreMaterial);
  private readonly floorAccentMaterial = new THREE.MeshBasicMaterial({
    color: 0x3ccfff,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  private readonly floorAccentGeometries: THREE.RingGeometry[] = [];
  private readonly p1Rim = new THREE.PointLight(0xff8ca3, 0.68, 5.8, 2);
  private readonly p2Rim = new THREE.PointLight(0x8edfff, 0.68, 5.8, 2);
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
  private readonly skylineGeometry = new THREE.BoxGeometry(0.52, 1, 0.52);
  private readonly skylineMaterial = new THREE.MeshStandardMaterial({
    color: 0x07182a,
    emissive: 0x04182a,
    emissiveIntensity: 0.72,
    roughness: 0.68,
    metalness: 0.32,
  });
  private readonly skylineBeaconGeometry = new THREE.OctahedronGeometry(0.085, 0);
  private readonly skylineBeaconMaterial = new THREE.MeshBasicMaterial({
    color: 0x75e9ff,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
  });
  private readonly waveGeometry = new THREE.RingGeometry(0.18, 0.25, 32);
  private readonly waves: ImpactWave[] = [];
  private readonly attackTrailGeometry = new THREE.TorusGeometry(0.48, 0.018, 6, 28, Math.PI * 0.48);
  private readonly attackTrails: AttackTrail[] = [];
  private readonly ghostBodyGeometry = new THREE.CylinderGeometry(0.28, 0.35, 1.02, 8);
  private readonly ghostHeadGeometry = new THREE.SphereGeometry(0.2, 8, 6);
  private readonly ghosts: GhostPulse[] = [];
  private quality: GraphicsQuality;
  private impactLightLife = 0;
  private lastP1TrailSpawn = -Infinity;
  private lastP2TrailSpawn = -Infinity;
  private lastGhostSpawn = -Infinity;
  private readonly previousP1Position = new THREE.Vector3();
  private hasPreviousP1Position = false;

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

    this.floorCore.name = "tps-floor-core";
    this.floorCore.rotation.x = -Math.PI / 2;
    this.floorCore.position.y = -0.002;

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
      this.floorCore,
      this.playerGroundRing,
      this.arenaGlow,
      this.centerGlow,
      this.p1Rim,
      this.p2Rim,
      this.impactLight,
      this.atmosphere,
    );

    for (let index = 0; index < TPS_GRAPHICS_PROFILE.floorAccentArcs; index += 1) {
      const layer = index % 3;
      const radius = 2.12 + layer * 1.34;
      const thetaStart = index * (Math.PI * 2 / TPS_GRAPHICS_PROFILE.floorAccentArcs) + layer * 0.085;
      const geometry = new THREE.RingGeometry(radius, radius + 0.052, 18, 1, thetaStart, 0.42);
      const accent = new THREE.Mesh(geometry, this.floorAccentMaterial);
      accent.name = `tps-floor-accent-${index}`;
      accent.rotation.x = -Math.PI / 2;
      accent.position.y = 0.013;
      this.floorAccentGeometries.push(geometry);
      this.group.add(accent);
    }

    for (let index = 0; index < TPS_GRAPHICS_PROFILE.skylineMonoliths; index += 1) {
      const angle = index * (Math.PI * 2 / TPS_GRAPHICS_PROFILE.skylineMonoliths) + Math.PI / 8;
      const radius = arenaRadius + 6.1;
      const height = 4.2 + (index % 4) * 0.72;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const tower = new THREE.Mesh(this.skylineGeometry, this.skylineMaterial);
      tower.name = `tps-skyline-monolith-${index}`;
      tower.position.set(x, height * 0.5 - 0.18, z);
      tower.scale.y = height;
      tower.rotation.y = -angle + Math.PI / 4;
      const beacon = new THREE.Mesh(this.skylineBeaconGeometry, this.skylineBeaconMaterial);
      beacon.name = `tps-skyline-beacon-${index}`;
      beacon.position.set(x, height + 0.06, z);
      this.group.add(tower, beacon);
    }

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

    for (let index = 0; index < TPS_GRAPHICS_PROFILE.attackTrailPool; index += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.attackTrailGeometry, material);
      mesh.name = `tps-attack-trail-${index}`;
      mesh.visible = false;
      mesh.renderOrder = 18;
      this.group.add(mesh);
      this.attackTrails.push({ mesh, life: 0, maxLife: 0 });
    }

    for (let index = 0; index < TPS_GRAPHICS_PROFILE.quickstepGhostPool; index += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xff6f8b,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
      });
      const ghost = new THREE.Group();
      ghost.name = `tps-quickstep-ghost-${index}`;
      const body = new THREE.Mesh(this.ghostBodyGeometry, material);
      body.position.y = 0.78;
      const head = new THREE.Mesh(this.ghostHeadGeometry, material);
      head.position.y = 1.47;
      ghost.add(body, head);
      ghost.visible = false;
      this.group.add(ghost);
      this.ghosts.push({ group: ghost, material, life: 0, maxLife: 0 });
    }
  }

  setQuality(quality: GraphicsQuality): void {
    this.quality = quality;
    this.renderer.toneMappingExposure = quality === "HIGH" ? 1.12 : quality === "LOW" ? 1.02 : 1.08;
    const low = quality === "LOW";
    this.atmosphere.visible = !low;
    this.floorAccentMaterial.opacity = low ? 0.11 : 0.2;
    this.skylineMaterial.emissiveIntensity = low ? 0.42 : 0.72;
    this.skylineBeaconMaterial.opacity = low ? 0.45 : 0.72;
    this.p1Rim.intensity = low ? 0.32 : 0.68;
    this.p2Rim.intensity = low ? 0.32 : 0.68;
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
    this.impactLight.intensity = this.quality === "LOW" ? 0.72 : 2.25 + strength * 0.78;
    this.impactLightLife = 0.12 + strength * 0.025;
  }

  update(p1: FighterRuntime, p2: FighterRuntime, time: number, delta: number): void {
    this.updateFighterShadow(this.p1Shadow, this.p1ShadowMaterial, p1, time);
    this.updateFighterShadow(this.p2Shadow, this.p2ShadowMaterial, p2, time + 0.37);

    this.playerGroundRing.position.set(p1.position.x, 0.028, p1.position.z);
    const playerPulse = 0.96 + Math.sin(time * 5.2) * 0.045;
    this.playerGroundRing.scale.setScalar(playerPulse);
    this.playerGroundMaterial.opacity = p1.state === "SIDESTEP" ? 0.36 : p1.state === "ATTACK" ? 0.28 : 0.17;

    const fighterForward = horizontalDirection(p1.position, p2.position);
    const fighterRight = new THREE.Vector3(-fighterForward.z, 0, fighterForward.x);
    this.p1Rim.position.copy(p1.position).addScaledVector(fighterForward, -1.18).addScaledVector(fighterRight, 0.92);
    this.p1Rim.position.y = 1.58;
    this.p2Rim.position.copy(p2.position).addScaledVector(fighterForward, 1.18).addScaledVector(fighterRight, -0.92);
    this.p2Rim.position.y = 1.58;
    const rimPulse = 0.92 + Math.sin(time * 4.4) * 0.055;
    if (this.quality !== "LOW") {
      this.p1Rim.intensity = (p1.state === "ATTACK" ? 1.08 : 0.68) * rimPulse;
      this.p2Rim.intensity = (p2.state === "ATTACK" ? 1.08 : 0.68) * rimPulse;
    }

    this.spawnAttackTrail(p1, p2, time, true);
    this.spawnAttackTrail(p2, p1, time, false);
    const p1Motion = this.hasPreviousP1Position ? p1.position.clone().sub(this.previousP1Position) : new THREE.Vector3();
    if (p1.state === "SIDESTEP" && time - this.lastGhostSpawn >= 0.055) {
      this.spawnQuickstepGhost(p1, p2, p1Motion);
      this.lastGhostSpawn = time;
    }
    this.previousP1Position.copy(p1.position);
    this.hasPreviousP1Position = true;

    this.arenaGlowMaterial.opacity = 0.09 + Math.sin(time * 1.7) * 0.025;
    this.centerGlowMaterial.opacity = 0.055 + Math.sin(time * 2.3 + 0.8) * 0.025;
    this.floorAccentMaterial.opacity = (this.quality === "LOW" ? 0.095 : 0.17) + Math.sin(time * 1.35) * 0.035;
    this.floorCoreMaterial.emissiveIntensity = 0.38 + Math.sin(time * 1.9) * 0.06;
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

    for (const trail of this.attackTrails) {
      if (trail.life <= 0) continue;
      trail.life -= delta;
      const progress = 1 - Math.max(0, trail.life) / Math.max(1e-4, trail.maxLife);
      trail.mesh.material.opacity = Math.max(0, (1 - progress) * 0.24);
      trail.mesh.scale.multiplyScalar(1 + delta * 1.35);
      if (trail.life <= 0) {
        trail.mesh.visible = false;
        trail.mesh.material.opacity = 0;
      }
    }

    for (const ghost of this.ghosts) {
      if (ghost.life <= 0) continue;
      ghost.life -= delta;
      const progress = 1 - Math.max(0, ghost.life) / Math.max(1e-4, ghost.maxLife);
      ghost.material.opacity = Math.max(0, (1 - progress) * 0.19);
      ghost.group.scale.setScalar(1 + progress * 0.045);
      if (ghost.life <= 0) {
        ghost.group.visible = false;
        ghost.material.opacity = 0;
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
    this.lastP1TrailSpawn = -Infinity;
    this.lastP2TrailSpawn = -Infinity;
    this.lastGhostSpawn = -Infinity;
    this.hasPreviousP1Position = false;
    for (const wave of this.waves) {
      wave.life = 0;
      wave.maxLife = 0;
      wave.mesh.visible = false;
      wave.mesh.material.opacity = 0;
    }
    for (const trail of this.attackTrails) {
      trail.life = 0;
      trail.maxLife = 0;
      trail.mesh.visible = false;
      trail.mesh.material.opacity = 0;
    }
    for (const ghost of this.ghosts) {
      ghost.life = 0;
      ghost.maxLife = 0;
      ghost.group.visible = false;
      ghost.material.opacity = 0;
    }
  }

  private spawnAttackTrail(attacker: FighterRuntime, defender: FighterRuntime, time: number, p1: boolean): void {
    const move = attacker.currentMove;
    if (attacker.state !== "ATTACK" || !move) return;
    const lastSpawn = p1 ? this.lastP1TrailSpawn : this.lastP2TrailSpawn;
    if (time - lastSpawn < 0.09) return;
    if (move.animation === "throw") return;
    if (attacker.moveTick > move.startup + move.active + 1) return;
    if (p1) this.lastP1TrailSpawn = time;
    else this.lastP2TrailSpawn = time;

    const trail = this.attackTrails.find((item) => item.life <= 0) ?? this.attackTrails[0];
    const forward = horizontalDirection(attacker.position, defender.position);
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const kick = move.animation === "kick" || move.visualContact === "LEFT_FOOT" || move.visualContact === "RIGHT_FOOT";
    const active = attacker.isActive();
    trail.life = active ? 0.11 : 0.08;
    trail.maxLife = trail.life;
    trail.mesh.visible = true;
    const contactSide = move.visualContact === "LEFT_FIST" || move.visualContact === "LEFT_FOOT" ? -1 : move.visualContact === "RIGHT_FIST" || move.visualContact === "RIGHT_FOOT" ? 1 : 0;
    trail.mesh.position.copy(attacker.position)
      .addScaledVector(forward, kick ? 0.78 : 0.76)
      .addScaledVector(right, contactSide * (kick ? 0.28 : 0.34));
    trail.mesh.position.y = kick ? 0.78 : 1.42;
    trail.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), right);
    trail.mesh.rotateZ((attacker.moveTick / Math.max(1, move.startup + move.active)) * 0.55 - 0.26);
    trail.mesh.scale.set(kick ? 1.08 : 0.74, kick ? 0.74 : 0.52, 1);
    trail.mesh.material.color.setHex(attacker.definition.colors.glow);
    trail.mesh.material.opacity = active ? 0.24 : 0.12;
  }

  private spawnQuickstepGhost(fighter: FighterRuntime, opponent: FighterRuntime, motion: THREE.Vector3): void {
    const ghost = this.ghosts.find((item) => item.life <= 0) ?? this.ghosts[0];
    const forward = horizontalDirection(fighter.position, opponent.position);
    ghost.life = 0.26;
    ghost.maxLife = ghost.life;
    ghost.group.visible = true;
    const fallbackRight = new THREE.Vector3(-forward.z, 0, forward.x);
    const motionDirection = motion.clone().setY(0);
    if (motionDirection.lengthSq() < 1e-5) {
      const sideSign = fighter.input.right ? 1 : fighter.input.left ? -1 : 1;
      motionDirection.copy(fallbackRight).multiplyScalar(sideSign);
    } else {
      motionDirection.normalize();
    }
    ghost.group.position.copy(fighter.position).addScaledVector(motionDirection, -0.58);
    ghost.group.rotation.set(0, Math.atan2(forward.x, forward.z), 0);
    ghost.group.scale.setScalar(0.96);
    ghost.material.color.setHex(fighter.definition.colors.glow);
    ghost.material.opacity = 0.22;
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
    material.opacity = airborne ? 0.13 : 0.32 + Math.sin(time * 3.7) * 0.020;
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
    this.floorCoreGeometry.dispose();
    this.floorCoreMaterial.dispose();
    for (const geometry of this.floorAccentGeometries) geometry.dispose();
    this.floorAccentMaterial.dispose();
    this.atmosphereGeometry.dispose();
    this.atmosphereMaterial.dispose();
    this.skylineGeometry.dispose();
    this.skylineMaterial.dispose();
    this.skylineBeaconGeometry.dispose();
    this.skylineBeaconMaterial.dispose();
    this.waveGeometry.dispose();
    for (const wave of this.waves) wave.mesh.material.dispose();
    this.attackTrailGeometry.dispose();
    for (const trail of this.attackTrails) trail.mesh.material.dispose();
    this.ghostBodyGeometry.dispose();
    this.ghostHeadGeometry.dispose();
    for (const ghost of this.ghosts) ghost.material.dispose();
    this.group.clear();
  }
}

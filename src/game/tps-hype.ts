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
  impactRingBaseLife: 0.12,
  impactRingTierLife: 0.03,
  impactRingLayerLife: 0.01,
  impactRingExpansion: 1.34,
  heavyBurstScale: 0.38,
  impactDepthBias: 0.07,
  perfectStepFovRush: 4.8,
  dashFovRush: 3.8,
  heavyImpactFovPunch: -3.8,
  counterImpactFovPunch: -4.6,
  lightImpactCameraSide: 0.040,
  mediumImpactCameraSide: 0.088,
  heavyImpactCameraSide: 0.180,
  counterImpactCameraSide: 0.235,
  lightImpactAimWeight: 0.22,
  mediumImpactAimWeight: 0.38,
  heavyImpactAimWeight: 0.58,
  counterImpactAimWeight: 0.72,
});

type ImpactTier = 1 | 2 | 3;
type ShockRingSource = "NONE" | "IMPACT" | "STEP";

interface ShockRing {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  life: number;
  maxLife: number;
  startScale: number;
  baseOpacity: number;
  source: ShockRingSource;
}

interface BurstSpokes {
  lines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  life: number;
  maxLife: number;
  startScale: number;
  aspect: number;
  baseOpacity: number;
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

function impactBurstAspect(tier: ImpactTier, blocked: boolean): number {
  if (blocked) return 1.12;
  if (tier === 3) return 2.25;
  if (tier === 2) return 1.82;
  return 1.52;
}

function impactBurstAngle(event: HitEvent): number {
  if (event.blocked) return 0;
  const contact = event.move.visualContact ?? "";
  const limbSide = contact.startsWith("LEFT") ? -1 : 1;
  const attackerMirror = event.attacker === "p1" ? 1 : -1;
  const kickLike = contact.includes("FOOT");
  const baseTilt = kickLike ? 0.42 : 0.22;
  const counterAccent = event.counter ? 0.10 : 0;
  return attackerMirror * limbSide * (baseTilt + counterAccent);
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
  private readonly impactFocus = new THREE.Vector3();
  private impactFocusLife = 0;
  private impactFocusDuration = 0;
  private impactAimWeight = 0;

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
      this.rings.push({ mesh, life: 0, maxLife: 0, startScale: 1, baseOpacity: 0, source: "NONE" });
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
      this.bursts.push({ lines, life: 0, maxLife: 0, startScale: 1, aspect: 1, baseOpacity: 0 });
    }
  }

  private retirePreviousImpactFx(): void {
    let retiredRings = 0;
    let retiredBursts = 0;
    for (const ring of this.rings) {
      if (ring.life <= 0 || ring.source !== "IMPACT") continue;
      ring.life = 0;
      ring.baseOpacity = 0;
      ring.source = "NONE";
      ring.mesh.visible = false;
      ring.mesh.material.opacity = 0;
      retiredRings += 1;
    }
    for (const burst of this.bursts) {
      if (burst.life <= 0) continue;
      burst.life = 0;
      burst.baseOpacity = 0;
      burst.lines.visible = false;
      burst.lines.material.opacity = 0;
      retiredBursts += 1;
    }
    this.group.userData.lastHypeRetiredImpactRings = retiredRings;
    this.group.userData.lastHypeRetiredBursts = retiredBursts;
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
    const visualPoint = point.clone().addScaledVector(facing, -TPS_HYPE_PROFILE.impactDepthBias);
    const ringCount = event.blocked ? 1 : tier === 3 ? TPS_HYPE_PROFILE.heavyImpactRingCount : tier === 2 ? TPS_HYPE_PROFILE.mediumImpactRingCount : TPS_HYPE_PROFILE.lightImpactRingCount;

    // Keep a short-lived authored contact focus. The final camera can translate
    // laterally and partially re-aim at this point, producing a tiny orbit around
    // the actual strike instead of sliding the whole composition sideways. This
    // creates parallax between overlapping fighters without touching gameplay.
    if (!event.blocked) {
      this.impactFocus.copy(point);
      this.impactFocusDuration = event.counter ? 0.22 : tier === 3 ? 0.19 : tier === 2 ? 0.15 : 0.11;
      this.impactFocusLife = this.impactFocusDuration;
      this.impactAimWeight = event.counter
        ? TPS_HYPE_PROFILE.counterImpactAimWeight
        : tier === 3
          ? TPS_HYPE_PROFILE.heavyImpactAimWeight
          : tier === 2
            ? TPS_HYPE_PROFILE.mediumImpactAimWeight
            : TPS_HYPE_PROFILE.lightImpactAimWeight;
    }

    // One combo beat should have one visual center. Retire only prior hit-created
    // rings/bursts before allocating this strike; STEP ground rings are tagged
    // separately and keep their authored lifetime. Heavy strikes can still own
    // two concentric rings from this same hit, preserving their extra weight.
    this.retirePreviousImpactFx();

    for (let index = 0; index < ringCount; index += 1) {
      const ring = this.rings.find((entry) => entry.life <= 0) ?? this.rings[index % this.rings.length];
      ring.life = TPS_HYPE_PROFILE.impactRingBaseLife
        + tier * TPS_HYPE_PROFILE.impactRingTierLife
        + index * TPS_HYPE_PROFILE.impactRingLayerLife;
      ring.maxLife = ring.life;
      ring.startScale = 0.56 + tier * 0.14 + index * 0.10;
      ring.source = "IMPACT";
      ring.mesh.visible = true;
      ring.mesh.position.copy(visualPoint);
      ring.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), facing);
      ring.mesh.rotateZ(index * 0.44 + tier * 0.11);
      ring.mesh.scale.setScalar(ring.startScale);
      ring.mesh.material.color.setHex(color);
      ring.baseOpacity = event.blocked
        ? 0.26
        : tier === 3
          ? Math.max(0.34, 0.46 - index * 0.08)
          : tier === 2
            ? 0.35
            : 0.29;
      ring.mesh.material.opacity = ring.baseOpacity;
    }

    const burst = this.bursts.find((entry) => entry.life <= 0) ?? this.bursts[0];
    burst.life = event.blocked ? 0.10 : tier === 3 ? 0.20 : tier === 2 ? 0.15 : 0.11;
    burst.maxLife = burst.life;
    burst.startScale = event.blocked ? 0.28 : tier === 3 ? TPS_HYPE_PROFILE.heavyBurstScale : tier === 2 ? 0.35 : 0.30;
    burst.aspect = impactBurstAspect(tier, event.blocked);
    burst.lines.visible = true;
    burst.lines.position.copy(visualPoint);
    burst.lines.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), facing);
    const burstAngle = impactBurstAngle(event);
    burst.lines.rotateZ(burstAngle);
    const initialCrossScale = burst.startScale / Math.sqrt(burst.aspect);
    burst.lines.scale.set(burst.startScale * burst.aspect, initialCrossScale, burst.startScale);
    burst.lines.material.color.setHex(color);
    burst.baseOpacity = event.blocked ? 0.22 : tier === 3 ? 0.46 : tier === 2 ? 0.37 : 0.29;
    burst.lines.material.opacity = burst.baseOpacity;

    if (event.blocked) {
      this.fovOffset = Math.max(this.fovOffset, 0.65);
      this.cameraKick = Math.max(this.cameraKick, 0.018);
      this.cameraShake = Math.max(this.cameraShake, 0.018);
      return;
    }

    const tierFov = tier === 3 ? TPS_HYPE_PROFILE.heavyImpactFovPunch : tier === 2 ? -2.6 : -1.1;
    const tierSide = tier === 3
      ? TPS_HYPE_PROFILE.heavyImpactCameraSide
      : tier === 2
        ? TPS_HYPE_PROFILE.mediumImpactCameraSide
        : TPS_HYPE_PROFILE.lightImpactCameraSide;
    this.fovOffset = Math.min(this.fovOffset, tierFov);
    this.cameraKick = Math.max(this.cameraKick, tier === 3 ? 0.20 : tier === 2 ? 0.098 : 0.042);
    this.cameraSide = (event.attacker === "p1" ? 1 : -1)
      * Math.max(Math.abs(this.cameraSide), tierSide);
    this.cameraRoll = (event.attacker === "p1" ? -1 : 1)
      * Math.max(Math.abs(this.cameraRoll), tier === 3 ? 0.010 : tier === 2 ? 0.005 : 0.0025);
    this.cameraShake = Math.max(this.cameraShake, tier === 3 ? 0.110 : tier === 2 ? 0.058 : 0.028);

    if (event.counter) {
      this.fovOffset = Math.min(this.fovOffset, TPS_HYPE_PROFILE.counterImpactFovPunch);
      this.cameraKick = Math.max(this.cameraKick, 0.24);
      this.cameraSide = (event.attacker === "p1" ? 1 : -1)
        * Math.max(Math.abs(this.cameraSide), TPS_HYPE_PROFILE.counterImpactCameraSide);
      this.cameraShake = Math.max(this.cameraShake, 0.135);
    }

    this.group.userData.lastHypeImpactTier = tier;
    this.group.userData.lastHypeMove = event.move.id;
    this.group.userData.lastHypeCounter = event.counter;
    this.group.userData.lastHypeBurstAspect = burst.aspect;
    this.group.userData.lastHypeBurstAngle = burstAngle;
    this.group.userData.lastHypeCameraSide = this.cameraSide;
    this.group.userData.lastHypeFovOffset = this.fovOffset;
    this.group.userData.lastHypeImpactAimWeight = this.impactAimWeight;
  }

  step(fighter: FighterRuntime, opponent: FighterRuntime, perfect: boolean): void {
    const forward = horizontalDirection(fighter.position, opponent.position);
    const ring = this.rings.find((entry) => entry.life <= 0) ?? this.rings[0];
    ring.life = perfect ? 0.28 : 0.20;
    ring.maxLife = ring.life;
    ring.startScale = perfect ? 1.18 : 0.90;
    ring.source = "STEP";
    ring.mesh.visible = true;
    ring.mesh.position.copy(fighter.position).add(new THREE.Vector3(0, 0.05, 0));
    ring.mesh.rotation.set(-Math.PI / 2, 0, Math.atan2(forward.z, forward.x));
    ring.mesh.scale.setScalar(ring.startScale);
    ring.mesh.material.color.setHex(perfect ? 0x79ffc0 : fighter.definition.colors.glow);
    ring.baseOpacity = perfect ? 0.62 : 0.38;
    ring.mesh.material.opacity = ring.baseOpacity;

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
      ring.mesh.material.opacity = Math.max(0, (1 - progress) * ring.baseOpacity);
      if (ring.life <= 0) {
        ring.source = "NONE";
        ring.mesh.visible = false;
        ring.mesh.material.opacity = 0;
      }
    }

    for (const burst of this.bursts) {
      if (burst.life <= 0) continue;
      burst.life -= delta;
      const progress = 1 - Math.max(0, burst.life) / Math.max(1e-4, burst.maxLife);
      const scale = burst.startScale * (1 + progress * 1.20);
      const crossScale = scale / Math.sqrt(burst.aspect);
      burst.lines.scale.set(scale * burst.aspect, crossScale, scale);
      burst.lines.material.opacity = Math.max(0, (1 - progress) * burst.baseOpacity);
      if (burst.life <= 0) {
        burst.lines.visible = false;
        burst.lines.material.opacity = 0;
      }
    }

    // Match the final TPS camera's compact-landscape lens so the hype director
    // does not pull the camera back toward the retired 52-degree framing.
    const baseFov = camera.aspect < 2.4 && camera.aspect > 1 ? 49 : 47;
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
      if (this.impactFocusLife > 0 && this.impactFocusDuration > 0) {
        const currentOrientation = camera.quaternion.clone();
        camera.lookAt(this.impactFocus);
        const contactOrientation = camera.quaternion.clone();
        const remaining = THREE.MathUtils.clamp(this.impactFocusLife / this.impactFocusDuration, 0, 1);
        const eased = remaining * remaining * (3 - 2 * remaining);
        camera.quaternion.copy(currentOrientation).slerp(contactOrientation, this.impactAimWeight * eased);
      }
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

    if (this.impactFocusLife > 0) {
      this.impactFocusLife = Math.max(0, this.impactFocusLife - delta);
    }
  }

  reset(camera: THREE.PerspectiveCamera): void {
    this.fovOffset = 0;
    this.cameraKick = 0;
    this.cameraSide = 0;
    this.cameraRoll = 0;
    this.cameraShake = 0;
    this.impactFocusLife = 0;
    this.impactFocusDuration = 0;
    this.impactAimWeight = 0;
    const baseFov = camera.aspect < 2.4 && camera.aspect > 1 ? 49 : 47;
    camera.fov = baseFov;
    camera.updateProjectionMatrix();
    for (const ring of this.rings) {
      ring.life = 0;
      ring.baseOpacity = 0;
      ring.source = "NONE";
      ring.mesh.visible = false;
      ring.mesh.material.opacity = 0;
    }
    for (const burst of this.bursts) {
      burst.life = 0;
      burst.aspect = 1;
      burst.baseOpacity = 0;
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
import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import type { HitEvent, MoveDefinition } from "./types";
import { getVisualContactPoint } from "./visual";

const TRAIL_SAMPLES = 9;
const METEOR_WAIT_SECONDS = 1.45;
const METEOR_FLASH_SECONDS = 0.44;

type TrailMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

type MotionTrail = {
  meshes: readonly [TrailMesh, TrailMesh];
  samples: THREE.Vector3[];
  count: number;
  lastMove: string | null;
  lastTick: number;
  release: number;
  width: number;
  color: number;
};

function makeTrailGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(TRAIL_SAMPLES * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage),
  );
  const indices: number[] = [];
  for (let index = 0; index < TRAIL_SAMPLES - 1; index += 1) {
    const start = index * 2;
    indices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2);
  }
  geometry.setIndex(indices);
  geometry.setDrawRange(0, 0);
  return geometry;
}

function makeGroundShards(): THREE.BufferGeometry {
  const triangles: number[] = [];
  for (let index = 0; index < 16; index += 1) {
    const angle = index * Math.PI * 2 / 16;
    const x = Math.cos(angle);
    const z = Math.sin(angle);
    const tx = -z;
    const tz = x;
    const inner = 0.38 + (index % 3) * .07;
    const outer = 1.04 + (index % 4) * .13;
    const width = .045 + (index % 3) * .014;
    triangles.push(
      x * inner + tx * width, .035, z * inner + tz * width,
      x * inner - tx * width, .035, z * inner - tz * width,
      x * outer, .035 + (index % 2) * .03, z * outer,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(triangles, 3));
  return geometry;
}

function tintFor(fighter: FighterRuntime, role: MoveDefinition["cinematicRole"]): number {
  if (role === "meteorSlam" && fighter.id === "p1") return 0xff984c;
  if (role === "airPivot") return fighter.id === "p1" ? 0xff8cce : 0x70e5ff;
  return fighter.definition.colors.glow;
}

/** This visual-only tier is readable even without bloom or dynamic lights. */
export function signatureMotionTrailWidth(role: MoveDefinition["cinematicRole"]): number {
  switch (role) {
    case "skyBreaker": return .24;
    case "airChase": return .19;
    case "airCarry": return .24;
    case "airPivot": return .29;
    case "meteorSlam": return .32;
    case "cycloneSweep": return .27;
    case "powerRush": return .27;
    default: return 0;
  }
}

export function isSignatureMotionTrailWindow(
  move: Pick<MoveDefinition, "startup" | "active" | "cinematicRole"> | null,
  moveTick: number,
): boolean {
  return Boolean(
    move?.cinematicRole
    && moveTick >= Math.max(0, move.startup - 5)
    && moveTick <= move.startup + move.active + 3,
  );
}

/**
 * Dynamic ribbons follow the *rendered striking fist/foot*, not an invented
 * projectile between opponents. Two tapered strips per fighter are rebuilt
 * into fixed vertex buffers: no per-hit meshes, materials or GPU allocations.
 * A real meteor landing earns a separate low-opacity floor stamp.
 */
export class TpsSignatureMotionVfx {
  readonly group = new THREE.Group();
  private readonly trails: MotionTrail[] = [];
  private readonly rimGeometry = new THREE.RingGeometry(.84, 1, 56);
  private readonly sparkGeometry = makeGroundShards();
  private readonly impactRims: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly impactShards: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly scratch = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();
  private readonly view = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private meteorDefender: string | null = null;
  private meteorAttacker: string | null = null;
  private meteorWait = 0;
  private impactRemaining = 0;
  private impactCenter = new THREE.Vector3();
  private landings = 0;

  constructor(parent: THREE.Group) {
    this.group.name = "tps-signature-motion-vfx";
    parent.add(this.group);
    for (let actor = 0; actor < 2; actor += 1) {
      const meshes: TrailMesh[] = [];
      for (let layer = 0; layer < 2; layer += 1) {
        const material = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          depthTest: true,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(makeTrailGeometry(), material);
        mesh.name = "tps-striking-limb-ribbon-" + actor + "-" + layer;
        mesh.visible = false;
        mesh.frustumCulled = false; // dynamic world-space vertices
        mesh.renderOrder = layer === 0 ? 21 : 22;
        this.group.add(mesh);
        meshes.push(mesh);
      }
      this.trails.push({
        meshes: meshes as [TrailMesh, TrailMesh],
        samples: Array.from({ length: TRAIL_SAMPLES }, () => new THREE.Vector3()),
        count: 0,
        lastMove: null,
        lastTick: -1,
        release: 0,
        width: 0,
        color: 0xffffff,
      });
    }
    for (let index = 0; index < 2; index += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: index === 0 ? 0xff9b5d : 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(this.rimGeometry, material);
      ring.name = "tps-meteor-floor-rim-" + index;
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      ring.renderOrder = 19;
      this.group.add(ring);
      this.impactRims.push(ring);
    }
    this.impactShards = new THREE.Mesh(this.sparkGeometry, new THREE.MeshBasicMaterial({
      color: 0xffad76,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }));
    this.impactShards.name = "tps-meteor-ground-fracture";
    this.impactShards.visible = false;
    this.impactShards.renderOrder = 20;
    this.group.add(this.impactShards);
  }

  hit(event: HitEvent): void {
    // Damage is already confirmed by the game, and only a non-guarded meteor
    // can arm the *later* floor strike. No fake impact at airborne contact.
    if (event.blocked || event.move.cinematicRole !== "meteorSlam") return;
    this.meteorDefender = event.defender;
    this.meteorAttacker = event.attacker;
    this.meteorWait = METEOR_WAIT_SECONDS;
    this.group.userData.tpsMeteorPending = true;
  }

  private appendSample(trail: MotionTrail, point: THREE.Vector3): void {
    if (trail.count > 0) {
      const distance = trail.samples[trail.count - 1].distanceTo(point);
      if (distance > 1.05) trail.count = 0; // skip teleports/round transitions
      else if (distance < .025) return; // avoid zero-length strips in hitstop
    }
    if (trail.count === TRAIL_SAMPLES) {
      const oldest = trail.samples[0];
      for (let index = 0; index < TRAIL_SAMPLES - 1; index += 1) trail.samples[index] = trail.samples[index + 1];
      trail.samples[TRAIL_SAMPLES - 1] = oldest;
      trail.count -= 1;
    }
    trail.samples[trail.count].copy(point);
    trail.count += 1;
    trail.release = .19;
  }

  private setRibbon(
    trail: MotionTrail,
    camera: THREE.PerspectiveCamera,
    width: number,
    opacity: number,
    color: number,
  ): void {
    if (trail.count < 2 || trail.release <= 0) {
      for (const mesh of trail.meshes) mesh.visible = false;
      return;
    }

    for (let layer = 0; layer < 2; layer += 1) {
      const mesh = trail.meshes[layer];
      const vertices = mesh.geometry.attributes.position as THREE.BufferAttribute;
      for (let index = 0; index < trail.count; index += 1) {
        const point = trail.samples[index];
        const prev = trail.samples[Math.max(0, index - 1)];
        const next = trail.samples[Math.min(trail.count - 1, index + 1)];
        this.tangent.copy(next).sub(prev).normalize();
        this.view.copy(camera.position).sub(point).normalize();
        this.normal.crossVectors(this.tangent, this.view).normalize();
        if (this.normal.lengthSq() <= 1e-6) this.normal.set(0, 1, 0);
        const progress = index / Math.max(1, trail.count - 1);
        const taper = Math.sin(Math.PI * (.05 + progress * .88)) * Math.pow(progress, .55);
        const radius = width * (layer === 0 ? 1 : .32) * taper;
        this.scratch.copy(point).addScaledVector(this.normal, radius);
        vertices.setXYZ(index * 2, this.scratch.x, this.scratch.y, this.scratch.z);
        this.scratch.copy(point).addScaledVector(this.normal, -radius);
        vertices.setXYZ(index * 2 + 1, this.scratch.x, this.scratch.y, this.scratch.z);
      }
      vertices.needsUpdate = true;
      mesh.geometry.setDrawRange(0, (trail.count - 1) * 6);
      mesh.material.color.setHex(layer === 0 ? color : 0xfff4e9);
      mesh.material.opacity = opacity * (layer === 0 ? .36 : .58);
      mesh.visible = true;
    }
  }

  private updateFighter(
    fighter: FighterRuntime,
    index: number,
    camera: THREE.PerspectiveCamera,
    delta: number,
  ): void {
    const trail = this.trails[index];
    const move = fighter.state === "ATTACK" ? fighter.currentMove : null;
    const role = move?.cinematicRole;
    if (move?.id !== trail.lastMove) {
      trail.lastMove = move?.id ?? null;
      trail.lastTick = -1;
      // The last committed strike needs a real follow-through tail when it
      // returns to idle; only a different new attack resets its history.
      if (move) {
        trail.count = 0;
        trail.release = 0;
      }
    }
    const active = Boolean(move && isSignatureMotionTrailWindow(move, fighter.moveTick));
    if (active && move && trail.lastTick !== fighter.moveTick && fighter.hitStop <= 0) {
      trail.lastTick = fighter.moveTick;
      trail.width = signatureMotionTrailWidth(move.cinematicRole) * Math.min(1.2, fighter.visual.root.scale.x);
      trail.color = tintFor(fighter, move.cinematicRole);
      this.appendSample(trail, getVisualContactPoint(fighter.visual, move.visualContact));
    }
    if (!active) trail.release = Math.max(0, trail.release - delta);
    if (active && trail.release > 0) {
      // While frozen on a confirmed contact, keep the ribbon at the authored
      // frame instead of accumulating duplicate vertices.
      trail.release = Math.max(trail.release, .10);
    }
    const opacity = Math.min(1, trail.release / .13);
    this.setRibbon(trail, camera, trail.width, opacity, trail.color);
    this.group.userData["tpsTrailSamples" + index] = trail.count;
    this.group.userData["tpsTrailVisible" + index] = trail.meshes.some(mesh => mesh.visible);
  }

  private spawnGroundImpact(position: THREE.Vector3, attackerId: string): void {
    this.impactRemaining = METEOR_FLASH_SECONDS;
    this.impactCenter.copy(position).setY(.045);
    const color = attackerId === "p1" ? 0xffa160 : 0x76ddff;
    for (let index = 0; index < this.impactRims.length; index += 1) {
      const rim = this.impactRims[index];
      rim.position.copy(this.impactCenter);
      rim.position.y += index * .008;
      rim.material.color.setHex(index === 0 ? color : 0xffffff);
      rim.visible = true;
    }
    this.impactShards.position.copy(this.impactCenter).setY(.012);
    this.impactShards.material.color.setHex(color);
    this.impactShards.visible = true;
    this.landings += 1;
    this.group.userData.tpsMeteorLandingCount = this.landings;
    this.group.userData.tpsMeteorPending = false;
  }

  private animateGroundImpact(delta: number): void {
    if (this.impactRemaining <= 0) return;
    this.impactRemaining = Math.max(0, this.impactRemaining - delta);
    const progress = 1 - this.impactRemaining / METEOR_FLASH_SECONDS;
    for (let index = 0; index < this.impactRims.length; index += 1) {
      const rim = this.impactRims[index];
      rim.scale.setScalar(.46 + progress * (index === 0 ? 3.4 : 4.1));
      rim.material.opacity = Math.pow(1 - progress, 1.6) * (index === 0 ? .32 : .17);
      rim.visible = this.impactRemaining > 0;
    }
    this.impactShards.scale.setScalar(.66 + progress * 1.8);
    this.impactShards.material.opacity = Math.pow(1 - progress, 1.3) * .30;
    this.impactShards.visible = this.impactRemaining > 0;
  }

  /** Returns true once, on the *real* defender floor contact after a slam. */
  update(p1: FighterRuntime, p2: FighterRuntime, camera: THREE.PerspectiveCamera, delta: number): boolean {
    this.updateFighter(p1, 0, camera, delta);
    this.updateFighter(p2, 1, camera, delta);

    let landed = false;
    if (this.meteorDefender) {
      const defender = this.meteorDefender === p1.id ? p1 : p2;
      if (defender.grounded && defender.position.y <= .075) {
        this.spawnGroundImpact(defender.position, this.meteorAttacker ?? "p1");
        this.meteorDefender = null;
        this.meteorAttacker = null;
        this.meteorWait = 0;
        landed = true;
      } else {
        this.meteorWait = Math.max(0, this.meteorWait - delta);
        if (this.meteorWait <= 0 || defender.health <= 0 && defender.state === "RING_OUT") {
          this.meteorDefender = null;
          this.meteorAttacker = null;
          this.group.userData.tpsMeteorPending = false;
        }
      }
    }
    this.animateGroundImpact(delta);
    return landed;
  }

  reset(): void {
    for (const trail of this.trails) {
      trail.count = 0;
      trail.release = 0;
      trail.width = 0;
      trail.color = 0xffffff;
      trail.lastMove = null;
      trail.lastTick = -1;
      for (const mesh of trail.meshes) {
        mesh.visible = false;
        mesh.material.opacity = 0;
        mesh.geometry.setDrawRange(0, 0);
      }
    }
    this.meteorDefender = null;
    this.meteorAttacker = null;
    this.meteorWait = 0;
    this.impactRemaining = 0;
    for (const rim of this.impactRims) rim.visible = false;
    this.impactShards.visible = false;
    this.group.userData.tpsMeteorPending = false;
    this.group.userData.tpsTrailSamples0 = 0;
    this.group.userData.tpsTrailSamples1 = 0;
    this.group.userData.tpsTrailVisible0 = false;
    this.group.userData.tpsTrailVisible1 = false;
  }

  dispose(): void {
    this.reset();
    for (const trail of this.trails) for (const mesh of trail.meshes) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.rimGeometry.dispose();
    this.sparkGeometry.dispose();
    for (const rim of this.impactRims) rim.material.dispose();
    this.impactShards.material.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}

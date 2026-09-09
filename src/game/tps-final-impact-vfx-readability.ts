import * as THREE from "three";
import { TpsHypeDirector } from "./tps-hype";
import type { HitEvent } from "./types";

type RuntimeRing = {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  life: number;
  maxLife: number;
  startScale: number;
  baseOpacity: number;
  source: "NONE" | "IMPACT" | "STEP";
};

type RuntimeBurst = {
  lines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  life: number;
  maxLife: number;
  startScale: number;
  aspect: number;
  baseOpacity: number;
};

type HypeRuntime = TpsHypeDirector & {
  rings: RuntimeRing[];
  bursts: RuntimeBurst[];
};

let installed = false;

function pushBehindContact(object: THREE.Object3D, camera: THREE.PerspectiveCamera, amount: number): void {
  const awayFromCamera = object.position.clone().sub(camera.position);
  if (awayFromCamera.lengthSq() <= 1e-8) return;
  object.position.addScaledVector(awayFromCamera.normalize(), amount);
}

function cleanFinalImpactFx(director: HypeRuntime, camera: THREE.PerspectiveCamera): void {
  const activeRings = director.rings.filter((ring) => ring.life > 0 && ring.source === "IMPACT");
  // Heavy hits normally use two concentric TPS rings. FINAL IMPACT already owns
  // a dedicated FOV hold, HUD beat, shared contact torus, hit-stop and reaction,
  // so keep only the larger outer TPS ring instead of stacking both over the
  // defender's face/chest. A light/medium lethal hit simply keeps its one ring.
  const keeper = activeRings.length > 0 ? activeRings[activeRings.length - 1] : null;
  for (const ring of activeRings) {
    if (ring === keeper) continue;
    ring.life = 0;
    ring.baseOpacity = 0;
    ring.source = "NONE";
    ring.mesh.visible = false;
    ring.mesh.material.opacity = 0;
  }

  if (keeper) {
    // Let depth testing turn the ring into a halo around the silhouettes instead
    // of a sticker over the contact anatomy. Preserve its scale/lifetime so the
    // finishing hit remains broader than an ordinary impact.
    pushBehindContact(keeper.mesh, camera, 0.11);
    keeper.baseOpacity = Math.min(keeper.baseOpacity, 0.31);
    keeper.mesh.material.opacity = Math.min(keeper.mesh.material.opacity, keeper.baseOpacity);
  }

  const activeBursts = director.bursts.filter((burst) => burst.life > 0);
  for (const burst of activeBursts) {
    pushBehindContact(burst.lines, camera, 0.06);
    burst.baseOpacity = Math.min(burst.baseOpacity, 0.38);
    burst.lines.material.opacity = Math.min(burst.lines.material.opacity, burst.baseOpacity);
  }

  director.group.userData.lastFinalImpactFxReadability = 1;
  director.group.userData.lastFinalImpactActiveRings = activeRings.length;
  director.group.userData.lastFinalImpactVisibleRings = keeper ? 1 : 0;
  director.group.userData.lastFinalImpactBurstCount = activeBursts.length;
}

export function installTpsFinalImpactVfxReadability(): void {
  if (installed) return;
  installed = true;

  const baseHit = TpsHypeDirector.prototype.hit;
  TpsHypeDirector.prototype.hit = function hitWithReadableFinalImpact(
    event: HitEvent,
    camera: THREE.PerspectiveCamera,
  ): void {
    // tps-game marks the lethal contact as HOLD before dispatching this same hit
    // to the Hype director. Read that presentation flag only; no health, damage,
    // hit-stop, camera timing or combat state is written here.
    const finalImpact = camera.userData.tpsFinalImpactStage === "HOLD";
    baseHit.call(this, event, camera);
    if (!finalImpact || event.blocked) return;
    cleanFinalImpactFx(this as unknown as HypeRuntime, camera);
  };
}

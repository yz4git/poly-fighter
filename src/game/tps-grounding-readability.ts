import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { TpsGraphicsDirector } from "./tps-graphics";

type ShadowMesh = THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
type RingMesh = THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;

type GroundingNodes = {
  p1Shadow: ShadowMesh | null;
  p2Shadow: ShadowMesh | null;
  playerRing: RingMesh | null;
};

const nodes = new WeakMap<TpsGraphicsDirector, GroundingNodes>();
let installed = false;

function resolveNodes(director: TpsGraphicsDirector): GroundingNodes {
  const cached = nodes.get(director);
  if (cached) return cached;
  const resolved: GroundingNodes = {
    p1Shadow: director.group.getObjectByName("tps-contact-shadow-p1") as ShadowMesh | null,
    p2Shadow: director.group.getObjectByName("tps-contact-shadow-p2") as ShadowMesh | null,
    playerRing: director.group.getObjectByName("tps-player-ground-ring") as RingMesh | null,
  };
  nodes.set(director, resolved);
  return resolved;
}

function tuneShadow(shadow: ShadowMesh | null, fighter: FighterRuntime): void {
  if (!shadow) return;
  const height = THREE.MathUtils.clamp(fighter.position.y, 0, 1.6);
  const airborne = THREE.MathUtils.smoothstep(height, 0.06, 1.35);
  const groundedScale = THREE.MathUtils.lerp(1, 0.68, airborne);
  const actionStretch = fighter.state === "SIDESTEP"
    ? 1.24
    : fighter.state === "ATTACK"
      ? 1.10
      : fighter.state === "HIT" || fighter.state === "BLOCK_STUN"
        ? 1.08
        : 1;
  const depthScale = fighter.state === "SIDESTEP" ? 0.50 : fighter.state === "ATTACK" ? 0.58 : 0.62;

  // The old contact shadow was a full circle, which read like another target
  // marker beside the actual lock-on rings. Flatten it into a soft footprint and
  // shrink it as the fighter leaves the floor so jumps/kicks feel physically lifted.
  shadow.scale.set(groundedScale * actionStretch, groundedScale * depthScale, 1);
  shadow.material.opacity = THREE.MathUtils.lerp(0.285, 0.065, airborne);
  shadow.userData.tpsGroundingAirborne = airborne;
  shadow.userData.tpsGroundingStretch = actionStretch;
}

function tunePlayerRing(ring: RingMesh | null, fighter: FighterRuntime): void {
  if (!ring) return;
  const opacity = fighter.state === "SIDESTEP"
    ? 0.29
    : fighter.state === "ATTACK"
      ? 0.19
      : fighter.state === "HIT" || fighter.state === "BLOCK_STUN"
        ? 0.10
        : 0.055;
  ring.material.opacity = opacity;
  ring.userData.tpsGroundingIdleRingReduced = fighter.state === "IDLE" || fighter.state === "WALK";
}

export function installTpsGroundingReadabilityPresentation(): void {
  if (installed) return;
  installed = true;

  const baseUpdate = TpsGraphicsDirector.prototype.update;
  TpsGraphicsDirector.prototype.update = function updateWithGroundingReadability(
    p1: FighterRuntime,
    p2: FighterRuntime,
    time: number,
    delta: number,
  ): void {
    baseUpdate.call(this, p1, p2, time, delta);
    const grounding = resolveNodes(this);
    tuneShadow(grounding.p1Shadow, p1);
    tuneShadow(grounding.p2Shadow, p2);
    tunePlayerRing(grounding.playerRing, p1);
  };
}

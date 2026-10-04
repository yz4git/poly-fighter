import * as THREE from "three";
import { TPS_ARENA_RADIUS } from "./tps-arena-factory";

export function horizontalDirection(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3 {
  const result = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);
  return result.lengthSq() > 1e-8 ? result.normalize() : new THREE.Vector3(1, 0, 0);
}

export function horizontalDistance(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

export function horizontalRadius(position: THREE.Vector3): number {
  return Math.hypot(position.x, position.z);
}

export function clampToArena(position: THREE.Vector3, margin = 0.72): void {
  const radial = new THREE.Vector2(position.x, position.z);
  const maximum = TPS_ARENA_RADIUS - margin;
  if (radial.lengthSq() <= maximum * maximum) return;
  radial.setLength(maximum);
  position.x = radial.x;
  position.z = radial.y;
}

export function ease(
  current: THREE.Vector3,
  target: THREE.Vector3,
  rate: number,
  delta: number,
): void {
  current.lerp(target, 1 - Math.exp(-rate * delta));
}

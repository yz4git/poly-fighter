import * as THREE from "three";

export const TPS_ARENA_RADIUS = 6.8;

export function createCircularArena(): { group: THREE.Group; disposables: Array<THREE.BufferGeometry | THREE.Material> } {
  const group = new THREE.Group();
  group.name = "tps-circular-arena";
  const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];

  const floorGeometry = new THREE.CircleGeometry(TPS_ARENA_RADIUS, 72);
  const floorMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x081827,
  emissive: 0x02070e,
  emissiveIntensity: 0.34,
  roughness: 0.62,
  metalness: 0.28,
  clearcoat: 0.32,
  clearcoatRoughness: 0.78,
});
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.012;
  group.add(floor);
  disposables.push(floorGeometry, floorMaterial);

  const boundaryGeometry = new THREE.TorusGeometry(TPS_ARENA_RADIUS, 0.055, 8, 96);
  const boundaryMaterial = new THREE.MeshBasicMaterial({ color: 0x4bd7ff, transparent: true, opacity: 0.9 });
  const boundary = new THREE.Mesh(boundaryGeometry, boundaryMaterial);
  boundary.rotation.x = Math.PI / 2;
  boundary.position.y = 0.025;
  group.add(boundary);
  disposables.push(boundaryGeometry, boundaryMaterial);

  // A faint elevated rail gives the shoulder camera a stable horizon reference.
  // It also fills the otherwise empty upper half of the TPS composition without
  // placing opaque scenery between the camera and the fighters.
  const horizonGeometry = new THREE.TorusGeometry(TPS_ARENA_RADIUS + 2.15, 0.018, 6, 96);
  const horizonMaterial = new THREE.MeshBasicMaterial({
    color: 0x2d8dbf,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  });
  const horizon = new THREE.Mesh(horizonGeometry, horizonMaterial);
  horizon.rotation.x = Math.PI / 2;
  horizon.position.y = 1.45;
  group.add(horizon);
  disposables.push(horizonGeometry, horizonMaterial);

  for (let radius = 1.7; radius < TPS_ARENA_RADIUS; radius += 1.7) {
    const geometry = new THREE.TorusGeometry(radius, 0.012, 4, 64);
    const material = new THREE.MeshBasicMaterial({ color: 0x173a5a, transparent: true, opacity: 0.58 });
    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.004;
    group.add(ring);
    disposables.push(geometry, material);
  }

  const spokeMaterial = new THREE.LineBasicMaterial({ color: 0x173a5a, transparent: true, opacity: 0.52 });
  disposables.push(spokeMaterial);
  for (let index = 0; index < 12; index += 1) {
    const angle = index * Math.PI / 6;
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.008, 0),
      new THREE.Vector3(Math.cos(angle) * TPS_ARENA_RADIUS, 0.008, Math.sin(angle) * TPS_ARENA_RADIUS),
    ]);
    group.add(new THREE.Line(geometry, spokeMaterial));
    disposables.push(geometry);
  }

  // Keep scenery outside the shoulder-camera orbit. The previous pillar ring
  // sat directly between the camera and fighters and produced large foreground
  // slabs during strafing. These thinner beacons preserve depth without blocking play.
  const pillarGeometry = new THREE.CylinderGeometry(0.07, 0.12, 1.45, 8);
  const pillarMaterial = new THREE.MeshStandardMaterial({ color: 0x143454, emissive: 0x07365d, emissiveIntensity: 0.9, roughness: 0.7 });
  const beaconGeometry = new THREE.OctahedronGeometry(0.11, 0);
  const beaconMaterial = new THREE.MeshBasicMaterial({ color: 0x61ddff, transparent: true, opacity: 0.72 });
  disposables.push(pillarGeometry, pillarMaterial, beaconGeometry, beaconMaterial);
  for (let index = 0; index < 12; index += 1) {
    const angle = index * Math.PI / 6;
    const x = Math.cos(angle) * (TPS_ARENA_RADIUS + 2.15);
    const z = Math.sin(angle) * (TPS_ARENA_RADIUS + 2.15);
    const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
    pillar.position.set(x, 0.725, z);
    const beacon = new THREE.Mesh(beaconGeometry, beaconMaterial);
    beacon.position.set(x, 1.5, z);
    group.add(pillar, beacon);
  }

  return { group, disposables };
}

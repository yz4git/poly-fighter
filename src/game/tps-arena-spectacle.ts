import * as THREE from "three";
import { TpsFightGame } from "./tps-game";

type SpectacleState = {
  group: THREE.Group;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
};

const states = new WeakMap<TpsFightGame, SpectacleState>();
let installed = false;

function makeSpectacle(): SpectacleState {
  const group = new THREE.Group();
  group.name = "tps-arena-spectacle";
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  // Three dim concentric spectator tiers give the shoulder camera a continuous
  // horizon instead of a black void. They sit well outside the gameplay radius
  // and are intentionally transparent so fighters and hit FX stay dominant.
  const tierMaterial = new THREE.MeshBasicMaterial({
    color: 0x0a1a2a,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  materials.push(tierMaterial);
  const tiers = [
    { radius: 8.55, y: 0.28, height: 0.34 },
    { radius: 9.20, y: 0.66, height: 0.36 },
    { radius: 9.85, y: 1.05, height: 0.38 },
  ];
  for (const tier of tiers) {
    const geometry = new THREE.CylinderGeometry(tier.radius, tier.radius, tier.height, 48, 1, true);
    const mesh = new THREE.Mesh(geometry, tierMaterial);
    mesh.position.y = tier.y;
    mesh.name = "tps-spectator-tier";
    mesh.renderOrder = -4;
    group.add(mesh);
    geometries.push(geometry);
  }

  // One instanced crowd silhouette draw call adds fine parallax at the back of
  // the ring without individual characters or animation cost.
  const crowdGeometry = new THREE.BoxGeometry(0.12, 0.28, 0.10);
  const crowdMaterial = new THREE.MeshBasicMaterial({ color: 0x102638 });
  const crowd = new THREE.InstancedMesh(crowdGeometry, crowdMaterial, 48);
  crowd.name = "tps-crowd-silhouettes";
  crowd.frustumCulled = false;
  const crowdDummy = new THREE.Object3D();
  for (let index = 0; index < 48; index += 1) {
    const angle = index * Math.PI * 2 / 48;
    const row = index % 3;
    const radius = 8.25 + row * 0.38;
    crowdDummy.position.set(Math.cos(angle) * radius, 0.38 + row * 0.22, Math.sin(angle) * radius);
    crowdDummy.rotation.set(0, -angle + Math.PI / 2, 0);
    crowdDummy.scale.set(0.85 + (index % 4) * 0.06, 0.82 + (index % 5) * 0.07, 1);
    crowdDummy.updateMatrix();
    crowd.setMatrixAt(index, crowdDummy.matrix);
  }
  crowd.instanceMatrix.needsUpdate = true;
  group.add(crowd);
  geometries.push(crowdGeometry);
  materials.push(crowdMaterial);

  // Repeating light pylons make every orbit angle feel authored. Instancing keeps
  // both the CPU and GPU cost bounded for iPhone Safari.
  const pylonGeometry = new THREE.BoxGeometry(0.14, 1.72, 0.14);
  const pylonMaterial = new THREE.MeshStandardMaterial({
    color: 0x102a44,
    emissive: 0x0b4564,
    emissiveIntensity: 1.25,
    roughness: 0.72,
    metalness: 0.24,
  });
  const pylons = new THREE.InstancedMesh(pylonGeometry, pylonMaterial, 16);
  pylons.name = "tps-spectacle-pylons";
  const pylonDummy = new THREE.Object3D();
  for (let index = 0; index < 16; index += 1) {
    const angle = index * Math.PI * 2 / 16;
    const radius = 10.25;
    pylonDummy.position.set(Math.cos(angle) * radius, 1.18, Math.sin(angle) * radius);
    pylonDummy.rotation.set(0, -angle, 0);
    pylonDummy.scale.set(1, 0.90 + (index % 4) * 0.07, 1);
    pylonDummy.updateMatrix();
    pylons.setMatrixAt(index, pylonDummy.matrix);
  }
  pylons.instanceMatrix.needsUpdate = true;
  group.add(pylons);
  geometries.push(pylonGeometry);
  materials.push(pylonMaterial);

  const capGeometry = new THREE.BoxGeometry(0.54, 0.045, 0.075);
  const capMaterial = new THREE.MeshBasicMaterial({
    color: 0x66e8ff,
    transparent: true,
    opacity: 0.64,
    depthWrite: false,
  });
  const caps = new THREE.InstancedMesh(capGeometry, capMaterial, 16);
  caps.name = "tps-spectacle-pylon-caps";
  const capDummy = new THREE.Object3D();
  for (let index = 0; index < 16; index += 1) {
    const angle = index * Math.PI * 2 / 16;
    const radius = 10.22;
    capDummy.position.set(Math.cos(angle) * radius, 2.12, Math.sin(angle) * radius);
    capDummy.rotation.set(0, -angle, 0);
    capDummy.updateMatrix();
    caps.setMatrixAt(index, capDummy.matrix);
  }
  caps.instanceMatrix.needsUpdate = true;
  group.add(caps);
  geometries.push(capGeometry);
  materials.push(capMaterial);

  // Sparse holographic score panels fill the middle distance. Their low opacity
  // prevents them from competing with the fighters or the existing HUD.
  const panelGeometry = new THREE.BoxGeometry(1.12, 0.34, 0.025);
  const panelMaterial = new THREE.MeshBasicMaterial({
    color: 0x2e8fbd,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  });
  const panels = new THREE.InstancedMesh(panelGeometry, panelMaterial, 8);
  panels.name = "tps-spectacle-holo-panels";
  const panelDummy = new THREE.Object3D();
  for (let index = 0; index < 8; index += 1) {
    const angle = index * Math.PI * 2 / 8 + Math.PI / 8;
    const radius = 9.72;
    panelDummy.position.set(Math.cos(angle) * radius, 2.48, Math.sin(angle) * radius);
    panelDummy.rotation.set(0, -angle + Math.PI / 2, 0);
    panelDummy.updateMatrix();
    panels.setMatrixAt(index, panelDummy.matrix);
  }
  panels.instanceMatrix.needsUpdate = true;
  group.add(panels);
  geometries.push(panelGeometry);
  materials.push(panelMaterial);

  // A thin elevated halo stays in the upper third of the shot and gives the
  // arena a large architectural scale without introducing foreground occluders.
  const haloGeometry = new THREE.TorusGeometry(9.25, 0.022, 5, 96);
  const haloMaterial = new THREE.MeshBasicMaterial({
    color: 0x4fdfff,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
  const halo = new THREE.Mesh(haloGeometry, haloMaterial);
  halo.name = "tps-spectacle-overhead-halo";
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 3.18;
  group.add(halo);
  geometries.push(haloGeometry);
  materials.push(haloMaterial);

  group.userData.tpsArenaSpectacle = true;
  group.userData.tpsArenaSpectacleDrawGroups = 8;
  group.userData.tpsArenaSpectacleCrowdInstances = 48;
  group.userData.tpsArenaSpectaclePylonInstances = 16;

  return { group, geometries, materials };
}

function ensureSpectacle(game: TpsFightGame): void {
  if (states.has(game)) return;
  const state = makeSpectacle();
  states.set(game, state);
  game.scene.add(state.group);
}

function disposeSpectacle(game: TpsFightGame): void {
  const state = states.get(game);
  if (!state) return;
  state.group.removeFromParent();
  state.group.clear();
  for (const geometry of state.geometries) geometry.dispose();
  for (const material of state.materials) material.dispose();
  states.delete(game);
}

export function installTpsArenaSpectaclePresentation(): void {
  if (installed) return;
  installed = true;

  const prototype = TpsFightGame.prototype;
  const baseStart = prototype.start;
  const baseDestroy = prototype.destroy;

  prototype.start = function startWithArenaSpectacle(): void {
    ensureSpectacle(this);
    baseStart.call(this);
  };

  prototype.destroy = function destroyWithArenaSpectacle(): void {
    disposeSpectacle(this);
    baseDestroy.call(this);
  };
}

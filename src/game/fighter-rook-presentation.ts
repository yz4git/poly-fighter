import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { registerRookFighter } from "./fighter-rook";
import { TpsFightGame } from "./tps-game";

type RookLayer = {
  group: THREE.Group;
  core: THREE.Mesh;
  chest: THREE.Mesh;
  shoulderPlates: THREE.Mesh[];
  gauntlets: THREE.Mesh[];
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
};

const layers = new WeakMap<FighterRuntime, RookLayer>();
let installed = false;

function isRook(fighter: FighterRuntime): boolean {
  return fighter.definition.name.toUpperCase() === "ROOK";
}

function material(color: number, emissive = 0x000000): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: emissive === 0x000000 ? 0 : 0.58,
    metalness: 0.38,
    roughness: 0.5,
    flatShading: true,
  });
}

function publishDiagnostics(fighter: FighterRuntime, layer: RookLayer): void {
  fighter.visual.root.userData.tpsRookVisual = "ROOK_V1";
  fighter.visual.root.userData.tpsRookArmorPieces = 1 + layer.shoulderPlates.length + layer.gauntlets.length;
  fighter.visual.root.userData.tpsRookFighterName = fighter.definition.name;
  if (typeof document === "undefined") return;
  document.body.dataset.rookFighterVisual = "ROOK_V1";
  document.body.dataset.rookFighterName = fighter.definition.name;
  document.body.dataset.rookFighterArmorPieces = String(1 + layer.shoulderPlates.length + layer.gauntlets.length);
  document.body.dataset.rookFighterPalette = "AMBER_GUNMETAL_STEEL";
}

function makeLayer(fighter: FighterRuntime): RookLayer {
  const group = new THREE.Group();
  group.name = "rook-gravity-frame-v1";
  const layout = fighter.visual.layout;

  const amber = material(0xd4772d, 0x3e1907);
  const steel = material(0xe7c46c, 0x2c2109);
  const dark = material(0x111319);
  const glow = new THREE.MeshBasicMaterial({
    color: 0xff9f43,
    transparent: true,
    opacity: 0.74,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const materials: THREE.Material[] = [amber, steel, dark, glow];

  const chestGeometry = new THREE.BoxGeometry(0.33, 0.19, 0.075);
  const coreGeometry = new THREE.OctahedronGeometry(0.047, 0);
  const shoulderGeometry = new THREE.BoxGeometry(0.19, 0.095, 0.16);
  const gauntletGeometry = new THREE.BoxGeometry(0.105, 0.20, 0.10);
  const geometries = [chestGeometry, coreGeometry, shoulderGeometry, gauntletGeometry];

  const chest = new THREE.Mesh(chestGeometry, dark);
  chest.position.set(0, layout.ribY + 0.025, 0.12);
  chest.rotation.x = -0.06;
  group.add(chest);

  const core = new THREE.Mesh(coreGeometry, glow);
  core.position.set(0, layout.ribY + 0.03, 0.168);
  group.add(core);

  const shoulderPlates: THREE.Mesh[] = [];
  for (const side of [-1, 1] as const) {
    const plate = new THREE.Mesh(shoulderGeometry, side < 0 ? amber : steel);
    plate.position.set(side * layout.shoulderWidth * 0.53, layout.shoulderY - 0.015, 0.055);
    plate.rotation.z = side * -0.12;
    plate.rotation.y = side * 0.08;
    group.add(plate);
    shoulderPlates.push(plate);
  }

  const gauntlets: THREE.Mesh[] = [];
  for (const side of [-1, 1] as const) {
    const guard = new THREE.Mesh(gauntletGeometry, amber);
    guard.position.set(side * layout.shoulderWidth * 0.72, layout.ribY - 0.16, 0.035);
    guard.rotation.z = side * 0.08;
    group.add(guard);
    gauntlets.push(guard);
  }

  fighter.visual.root.add(group);
  const layer = { group, core, chest, shoulderPlates, gauntlets, geometries, materials };
  publishDiagnostics(fighter, layer);
  return layer;
}

function ensureLayer(fighter: FighterRuntime): RookLayer | null {
  if (!isRook(fighter)) return null;
  const existing = layers.get(fighter);
  if (existing) return existing;
  const layer = makeLayer(fighter);
  layers.set(fighter, layer);
  return layer;
}

function updateLayer(fighter: FighterRuntime, time: number): void {
  const layer = ensureLayer(fighter);
  if (!layer) return;
  const statePressure = fighter.state === "ATTACK" || fighter.state === "GUARD" ? 1 : 0;
  const pulse = 0.92 + Math.sin(time * 4.2) * 0.08 + statePressure * 0.08;
  layer.core.scale.setScalar(pulse);
  layer.chest.rotation.z = Math.sin(time * 1.7) * 0.012;
  layer.shoulderPlates.forEach((plate, index) => {
    plate.position.y += Math.sin(time * 2.1 + index * Math.PI) * 0.0007;
  });
}

function disposeLayer(fighter: FighterRuntime): void {
  const layer = layers.get(fighter);
  if (!layer) return;
  layer.group.removeFromParent();
  layer.geometries.forEach((geometry) => geometry.dispose());
  layer.materials.forEach((entry) => entry.dispose());
  layers.delete(fighter);
}

export function installRookFighterPresentation(): void {
  if (installed) return;
  installed = true;
  registerRookFighter();

  const prototype = TpsFightGame.prototype as unknown as {
    updateVisual(fighter: FighterRuntime, opponent: FighterRuntime, time: number): void;
    destroy(): void;
  };
  const baseUpdateVisual = prototype.updateVisual;
  const baseDestroy = prototype.destroy;

  prototype.updateVisual = function updateVisualWithRook(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    time: number,
  ): void {
    baseUpdateVisual.call(this, fighter, opponent, time);
    updateLayer(fighter, time);
  };

  prototype.destroy = function destroyWithRook(): void {
    const game = this as unknown as { p1: FighterRuntime; p2: FighterRuntime };
    disposeLayer(game.p1);
    disposeLayer(game.p2);
    baseDestroy.call(this);
  };
}

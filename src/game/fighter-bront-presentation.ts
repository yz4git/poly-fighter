import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { registerBrontCircuitRival } from "./fighter-bront-circuit";
import { TpsFightGame } from "./tps-game";

type BrontLayer = {
  group: THREE.Group;
  core: THREE.Mesh;
  shoulderPlates: THREE.Mesh[];
  forearmGuards: THREE.Mesh[];
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  modelStyled: boolean;
};

const layers = new WeakMap<FighterRuntime, BrontLayer>();
let installed = false;

function isBront(fighter: FighterRuntime): boolean {
  return fighter.definition.name.toUpperCase() === "BRONT";
}

function material(color: number, emissive = 0x000000): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: emissive === 0 ? 0 : 0.56,
    metalness: 0.46,
    roughness: 0.48,
    flatShading: true,
  });
}

function publishDiagnostics(fighter: FighterRuntime, plates: number): void {
  fighter.visual.root.userData.tpsBrontVisual = "BRONT_V1";
  fighter.visual.root.userData.tpsBrontPlateCount = plates;
  fighter.visual.root.userData.tpsBrontFighterName = fighter.definition.name;
  if (typeof document === "undefined") return;
  document.body.dataset.brontFighterVisual = "BRONT_V1";
  document.body.dataset.brontFighterName = fighter.definition.name;
  document.body.dataset.brontFighterPlates = String(plates);
  document.body.dataset.brontFighterPalette = "AMBER_BLACK_STEEL";
}

function styleLoadedModel(fighter: FighterRuntime, layer: BrontLayer): void {
  if (layer.modelStyled) return;
  const host = fighter.visual.root.getObjectByName("quaternius-ubc-male-runtime")
    ?? fighter.visual.root.getObjectByName("quaternius-ubc-female-runtime");
  if (!host) return;

  const primary = new THREE.Color(fighter.definition.colors.primary);
  const secondary = new THREE.Color(fighter.definition.colors.secondary);
  const accent = new THREE.Color(fighter.definition.colors.accent);
  const skin = new THREE.Color(fighter.definition.colors.skin);
  const hair = new THREE.Color(fighter.definition.colors.hair);
  const seen = new Set<THREE.Material>();

  host.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const item of list) {
      if (seen.has(item) || !(item instanceof THREE.MeshStandardMaterial)) continue;
      seen.add(item);
      const name = item.name.toLowerCase();
      if (name.includes("hair")) item.color.copy(hair);
      else if (name.includes("skin") || name.includes("face")) item.color.copy(skin);
      else if (name.includes("metal") || name.includes("trim") || name.includes("accent")) item.color.copy(accent);
      else if (name.includes("black") || name.includes("dark") || name.includes("boot") || name.includes("shoe") || name.includes("glove") || name.includes("pant")) item.color.copy(secondary);
      else item.color.copy(primary);
      item.flatShading = true;
      item.roughness = 0.68;
      item.metalness = name.includes("metal") ? 0.32 : 0.08;
      item.needsUpdate = true;
    }
  });

  layer.modelStyled = true;
  fighter.visual.root.userData.tpsBrontModelPaletteApplied = true;
  if (typeof document !== "undefined") document.body.dataset.brontFighterModelPalette = "APPLIED";
}

function createLayer(fighter: FighterRuntime): BrontLayer {
  const group = new THREE.Group();
  group.name = "bront-heavy-identity-v2";
  const layout = fighter.visual.layout;

  const amber = material(0xd58b2d, 0x4b2607);
  const steel = material(0xc8d0d8);
  const black = material(0x111217);
  const glow = new THREE.MeshBasicMaterial({
    color: 0xffb64d,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const materials: THREE.Material[] = [amber, steel, black, glow];

  // Keep the armor close to the authored body instead of replacing its silhouette.
  // BRONT should read as heavy because of mass/proportions and compact armor caps,
  // not because large boxes occlude his limbs during close-range combat.
  const chestGeometry = new THREE.BoxGeometry(0.19, 0.15, 0.055);
  const shoulderGeometry = new THREE.BoxGeometry(0.115, 0.072, 0.095);
  const forearmGeometry = new THREE.BoxGeometry(0.060, 0.145, 0.068);
  const coreGeometry = new THREE.IcosahedronGeometry(0.032, 0);
  const spineGeometry = new THREE.BoxGeometry(0.040, 0.20, 0.035);
  const geometries = [chestGeometry, shoulderGeometry, forearmGeometry, coreGeometry, spineGeometry];

  const chest = new THREE.Mesh(chestGeometry, black);
  chest.position.set(0, layout.ribY, 0.052);
  chest.rotation.x = -0.03;
  group.add(chest);

  const core = new THREE.Mesh(coreGeometry, glow);
  core.position.set(0, layout.ribY + 0.012, 0.086);
  group.add(core);

  const spine = new THREE.Mesh(spineGeometry, steel);
  spine.position.set(0, layout.waistY + 0.07, -0.052);
  group.add(spine);

  const shoulderPlates: THREE.Mesh[] = [];
  const forearmGuards: THREE.Mesh[] = [];
  for (const side of [-1, 1] as const) {
    const shoulder = new THREE.Mesh(shoulderGeometry, side < 0 ? amber : steel);
    shoulder.position.set(side * layout.shoulderWidth * 0.50, layout.shoulderY - 0.025, 0.010);
    shoulder.rotation.z = side * -0.16;
    shoulder.rotation.y = side * 0.06;
    group.add(shoulder);
    shoulderPlates.push(shoulder);

    const guard = new THREE.Mesh(forearmGeometry, amber);
    guard.position.set(side * layout.shoulderWidth * 0.64, layout.elbowY - 0.055, 0.025);
    guard.rotation.z = side * 0.10;
    group.add(guard);
    forearmGuards.push(guard);
  }

  fighter.visual.root.add(group);
  publishDiagnostics(fighter, shoulderPlates.length + forearmGuards.length + 2);
  return { group, core, shoulderPlates, forearmGuards, geometries, materials, modelStyled: false };
}

function ensureLayer(fighter: FighterRuntime): BrontLayer | null {
  if (!isBront(fighter)) return null;
  const existing = layers.get(fighter);
  if (existing) return existing;
  const layer = createLayer(fighter);
  layers.set(fighter, layer);
  return layer;
}

function updateLayer(fighter: FighterRuntime, time: number): void {
  const layer = ensureLayer(fighter);
  if (!layer) return;
  styleLoadedModel(fighter, layer);
  const pulse = 0.95 + Math.sin(time * 3.2) * 0.07;
  layer.core.scale.setScalar(pulse);
  layer.shoulderPlates.forEach((plate, index) => {
    plate.rotation.y = (index === 0 ? -0.06 : 0.06) + Math.sin(time * 1.25 + index) * 0.025;
  });
  layer.forearmGuards.forEach((guard, index) => {
    guard.rotation.x = Math.sin(time * 1.6 + index * 0.7) * 0.020;
  });
}

function disposeLayer(fighter: FighterRuntime): void {
  const layer = layers.get(fighter);
  if (!layer) return;
  layer.group.removeFromParent();
  layer.geometries.forEach((geometry) => geometry.dispose());
  layer.materials.forEach((item) => item.dispose());
  layers.delete(fighter);
}

export function installBrontFighterPresentation(): void {
  if (installed) return;
  installed = true;
  registerBrontCircuitRival();

  const prototype = TpsFightGame.prototype as unknown as {
    updateVisual(fighter: FighterRuntime, opponent: FighterRuntime, time: number): void;
    destroy(): void;
  };
  const baseUpdateVisual = prototype.updateVisual;
  const baseDestroy = prototype.destroy;

  prototype.updateVisual = function updateVisualWithBront(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    time: number,
  ): void {
    baseUpdateVisual.call(this, fighter, opponent, time);
    updateLayer(fighter, time);
  };

  prototype.destroy = function destroyWithBront(): void {
    const game = this as unknown as { p1: FighterRuntime; p2: FighterRuntime };
    disposeLayer(game.p1);
    disposeLayer(game.p2);
    baseDestroy.call(this);
  };
}

import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { registerAxionCircuitRival } from "./fighter-axion-circuit";
import { TpsFightGame } from "./tps-game";

type AxionLayer = {
  group: THREE.Group;
  core: THREE.Mesh;
  halo: THREE.Mesh;
  shoulderPlates: THREE.Mesh[];
  anchors: THREE.Mesh[];
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  modelStyled: boolean;
};

const layers = new WeakMap<FighterRuntime, AxionLayer>();
let installed = false;

function isAxion(fighter: FighterRuntime): boolean {
  return fighter.definition.name.toUpperCase() === "AXION";
}

function material(color: number, emissive = 0x000000): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: emissive === 0x000000 ? 0 : 0.62,
    metalness: 0.42,
    roughness: 0.38,
    flatShading: true,
  });
}

function publishDiagnostics(fighter: FighterRuntime, anchorCount: number): void {
  fighter.visual.root.userData.tpsAxionVisual = "AXION_V1";
  fighter.visual.root.userData.tpsAxionAnchorCount = anchorCount;
  fighter.visual.root.userData.tpsAxionFighterName = fighter.definition.name;
  if (typeof document === "undefined") return;
  document.body.dataset.axionFighterVisual = "AXION_V1";
  document.body.dataset.axionFighterName = fighter.definition.name;
  document.body.dataset.axionFighterAnchors = String(anchorCount);
  document.body.dataset.axionFighterPalette = "AMBER_GRAPHITE_GOLD";
}

function styleLoadedAxionModel(fighter: FighterRuntime, layer: AxionLayer): void {
  if (layer.modelStyled) return;
  const host = fighter.visual.root.getObjectByName("quaternius-ubc-male-runtime");
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
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const entry of materials) {
      if (seen.has(entry) || !(entry instanceof THREE.MeshStandardMaterial)) continue;
      seen.add(entry);
      const name = entry.name.toLowerCase();
      if (name.includes("hair")) entry.color.copy(hair);
      else if (name.includes("skin") || name.includes("face")) entry.color.copy(skin);
      else if (name.includes("eye") || name.includes("trim") || name.includes("accent") || name.includes("metal")) entry.color.copy(accent);
      else if (name.includes("dark") || name.includes("black") || name.includes("boot") || name.includes("shoe") || name.includes("glove") || name.includes("pant")) entry.color.copy(secondary);
      else entry.color.copy(primary);
      entry.flatShading = true;
      entry.roughness = 0.68;
      entry.metalness = name.includes("metal") ? 0.32 : 0.08;
      entry.needsUpdate = true;
    }
  });

  layer.modelStyled = true;
  fighter.visual.root.userData.tpsAxionModelPaletteApplied = true;
  if (typeof document !== "undefined") document.body.dataset.axionFighterModelPalette = "APPLIED";
}

function makeLayer(fighter: FighterRuntime): AxionLayer {
  const group = new THREE.Group();
  group.name = "axion-identity-v1";
  const layout = fighter.visual.layout;

  const amber = material(0xd77a25, 0x351405);
  const gold = material(0xf2c35f, 0x3c2a08);
  const graphite = material(0x111318);
  const glow = new THREE.MeshBasicMaterial({
    color: 0xffb65f,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const materials: THREE.Material[] = [amber, gold, graphite, glow];

  const coreGeometry = new THREE.IcosahedronGeometry(0.052, 0);
  const haloGeometry = new THREE.TorusGeometry(0.09, 0.012, 6, 16);
  const shoulderGeometry = new THREE.BoxGeometry(0.18, 0.075, 0.13);
  const collarGeometry = new THREE.CylinderGeometry(0.055, 0.073, 0.19, 6);
  const anchorGeometry = new THREE.OctahedronGeometry(0.038, 0);
  const geometries = [coreGeometry, haloGeometry, shoulderGeometry, collarGeometry, anchorGeometry];

  const core = new THREE.Mesh(coreGeometry, glow);
  core.position.set(0, layout.ribY + 0.015, 0.145);
  group.add(core);

  const halo = new THREE.Mesh(haloGeometry, gold);
  halo.position.copy(core.position);
  halo.rotation.x = Math.PI * 0.5;
  group.add(halo);

  const shoulderPlates: THREE.Mesh[] = [];
  for (const side of [-1, 1] as const) {
    const shoulder = new THREE.Mesh(shoulderGeometry, side < 0 ? amber : gold);
    shoulder.position.set(side * layout.shoulderWidth * 0.58, layout.shoulderY - 0.025, 0.035);
    shoulder.rotation.z = side * -0.13;
    group.add(shoulder);
    shoulderPlates.push(shoulder);

    const collar = new THREE.Mesh(collarGeometry, graphite);
    collar.position.set(side * layout.shoulderWidth * 0.35, layout.shoulderY - 0.08, 0.03);
    collar.rotation.z = side * 0.16;
    group.add(collar);
  }

  const anchors: THREE.Mesh[] = [];
  for (let index = 0; index < 4; index += 1) {
    const anchor = new THREE.Mesh(anchorGeometry, index % 2 === 0 ? amber : gold);
    group.add(anchor);
    anchors.push(anchor);
  }

  fighter.visual.root.add(group);
  publishDiagnostics(fighter, anchors.length);
  return { group, core, halo, shoulderPlates, anchors, geometries, materials, modelStyled: false };
}

function ensureLayer(fighter: FighterRuntime): AxionLayer | null {
  if (!isAxion(fighter)) return null;
  const existing = layers.get(fighter);
  if (existing) return existing;
  const layer = makeLayer(fighter);
  layers.set(fighter, layer);
  return layer;
}

function updateLayer(fighter: FighterRuntime, time: number): void {
  const layer = ensureLayer(fighter);
  if (!layer) return;
  styleLoadedAxionModel(fighter, layer);
  const layout = fighter.visual.layout;
  const pulse = 0.95 + Math.sin(time * 4.2) * 0.08;
  layer.core.scale.setScalar(pulse);
  layer.halo.rotation.z = time * 1.05;
  layer.shoulderPlates.forEach((plate, index) => {
    plate.rotation.y = Math.sin(time * 1.7 + index * Math.PI) * 0.055;
  });

  layer.anchors.forEach((anchor, index) => {
    const angle = time * 0.72 + index * ((Math.PI * 2) / layer.anchors.length);
    const radius = 0.17 + (index % 2) * 0.016;
    anchor.position.set(
      Math.cos(angle) * radius,
      layout.waistY + 0.015 + Math.sin(angle * 1.2) * 0.022,
      Math.sin(angle) * radius * 0.62,
    );
    anchor.rotation.x = angle * 0.8;
    anchor.rotation.y = angle * 1.15;
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

export function installAxionFighterPresentation(): void {
  if (installed) return;
  installed = true;
  registerAxionCircuitRival();

  const prototype = TpsFightGame.prototype as unknown as {
    updateVisual(fighter: FighterRuntime, opponent: FighterRuntime, time: number): void;
    destroy(): void;
  };
  const baseUpdateVisual = prototype.updateVisual;
  const baseDestroy = prototype.destroy;

  prototype.updateVisual = function updateVisualWithAxion(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    time: number,
  ): void {
    baseUpdateVisual.call(this, fighter, opponent, time);
    updateLayer(fighter, time);
  };

  prototype.destroy = function destroyWithAxion(): void {
    const game = this as unknown as { p1: FighterRuntime; p2: FighterRuntime };
    disposeLayer(game.p1);
    disposeLayer(game.p2);
    baseDestroy.call(this);
  };
}

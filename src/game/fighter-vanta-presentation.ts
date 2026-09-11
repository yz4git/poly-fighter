import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { registerVantaCircuitRival } from "./fighter-vanta-circuit";
import { TpsFightGame } from "./tps-game";

type VantaLayer = {
  group: THREE.Group;
  core: THREE.Mesh;
  ring: THREE.Mesh;
  visor: THREE.Mesh;
  orbiters: THREE.Mesh[];
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  modelStyled: boolean;
};

const layers = new WeakMap<FighterRuntime, VantaLayer>();
let installed = false;

function isVanta(fighter: FighterRuntime): boolean {
  return fighter.definition.name.toUpperCase() === "VANTA";
}

function makeMaterial(color: number, emissive = 0x000000): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: emissive === 0x000000 ? 0 : 0.72,
    metalness: 0.34,
    roughness: 0.42,
    flatShading: true,
  });
}

function publishVantaDiagnostics(fighter: FighterRuntime, orbiterCount: number): void {
  fighter.visual.root.userData.tpsVantaVisual = "VANTA_V2";
  fighter.visual.root.userData.tpsVantaOrbiterCount = orbiterCount;
  fighter.visual.root.userData.tpsVantaFighterName = fighter.definition.name;
  if (typeof document === "undefined") return;
  document.body.dataset.vantaFighterVisual = "VANTA_V2";
  document.body.dataset.vantaFighterName = fighter.definition.name;
  document.body.dataset.vantaFighterOrbiters = String(orbiterCount);
  document.body.dataset.vantaFighterPalette = "VIOLET_BLACK_GOLD";
}

function styleLoadedVantaModel(fighter: FighterRuntime, layer: VantaLayer): void {
  if (layer.modelStyled) return;
  const host = fighter.visual.root.getObjectByName("quaternius-ubc-female-runtime");
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
    for (const material of materials) {
      if (seen.has(material) || !(material instanceof THREE.MeshStandardMaterial)) continue;
      seen.add(material);
      const name = material.name.toLowerCase();
      if (name.includes("hair")) material.color.copy(hair);
      else if (name.includes("skin") || name.includes("face")) material.color.copy(skin);
      else if (name.includes("eye") || name.includes("trim") || name.includes("accent") || name.includes("metal")) material.color.copy(accent);
      else if (name.includes("dark") || name.includes("black") || name.includes("boot") || name.includes("shoe") || name.includes("glove") || name.includes("pant")) material.color.copy(secondary);
      else material.color.copy(primary);
      material.flatShading = true;
      material.roughness = 0.72;
      material.metalness = name.includes("metal") ? 0.24 : 0.06;
      material.needsUpdate = true;
    }
  });

  layer.modelStyled = true;
  fighter.visual.root.userData.tpsVantaModelPaletteApplied = true;
  if (typeof document !== "undefined") document.body.dataset.vantaFighterModelPalette = "APPLIED";
}

function makeVantaLayer(fighter: FighterRuntime): VantaLayer {
  const group = new THREE.Group();
  group.name = "vanta-identity-v2";
  const layout = fighter.visual.layout;

  const violet = makeMaterial(0x6f45d7, 0x241047);
  const gold = makeMaterial(0xd7aa45, 0x3f2a09);
  const dark = makeMaterial(0x08070d);
  const glow = new THREE.MeshBasicMaterial({
    color: 0xb88cff,
    transparent: true,
    opacity: 0.68,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const materials: THREE.Material[] = [violet, gold, dark, glow];

  const coreGeometry = new THREE.OctahedronGeometry(0.044, 0);
  const ringGeometry = new THREE.TorusGeometry(0.072, 0.011, 5, 14);
  const visorGeometry = new THREE.BoxGeometry(0.16, 0.032, 0.03);
  const finGeometry = new THREE.ConeGeometry(0.036, 0.19, 4);
  const collarGeometry = new THREE.BoxGeometry(0.050, 0.20, 0.070);
  const orbiterGeometry = new THREE.TetrahedronGeometry(0.033, 0);
  const geometries = [coreGeometry, ringGeometry, visorGeometry, finGeometry, collarGeometry, orbiterGeometry];

  const core = new THREE.Mesh(coreGeometry, glow);
  core.position.set(0, layout.ribY + 0.02, 0.135);
  group.add(core);

  const ring = new THREE.Mesh(ringGeometry, gold);
  ring.position.copy(core.position);
  ring.rotation.x = Math.PI * 0.5;
  group.add(ring);

  const visor = new THREE.Mesh(visorGeometry, violet);
  visor.position.set(0, layout.headBottom + layout.headHeight * 0.56, 0.102);
  visor.rotation.z = -0.04;
  group.add(visor);

  for (const side of [-1, 1] as const) {
    const collar = new THREE.Mesh(collarGeometry, dark);
    collar.position.set(side * layout.shoulderWidth * 0.43, layout.shoulderY - 0.085, 0.055);
    collar.rotation.z = side * 0.10;
    group.add(collar);

    const fin = new THREE.Mesh(finGeometry, side < 0 ? violet : gold);
    fin.position.set(side * layout.shoulderWidth * 0.57, layout.shoulderY - 0.012, 0.018);
    fin.rotation.z = side * -Math.PI * 0.47;
    fin.rotation.x = side * 0.08;
    group.add(fin);
  }

  const orbiters: THREE.Mesh[] = [];
  for (let index = 0; index < 3; index += 1) {
    const orbiter = new THREE.Mesh(orbiterGeometry, index === 1 ? gold : violet);
    group.add(orbiter);
    orbiters.push(orbiter);
  }

  fighter.visual.root.add(group);
  publishVantaDiagnostics(fighter, orbiters.length);
  return { group, core, ring, visor, orbiters, geometries, materials, modelStyled: false };
}

function ensureLayer(fighter: FighterRuntime): VantaLayer | null {
  if (!isVanta(fighter)) return null;
  const existing = layers.get(fighter);
  if (existing) return existing;
  const layer = makeVantaLayer(fighter);
  layers.set(fighter, layer);
  return layer;
}

function updateLayer(fighter: FighterRuntime, time: number): void {
  const layer = ensureLayer(fighter);
  if (!layer) return;
  styleLoadedVantaModel(fighter, layer);
  const layout = fighter.visual.layout;
  const pulse = 0.94 + Math.sin(time * 5.4) * 0.10;
  layer.core.scale.setScalar(pulse);
  layer.ring.rotation.z = time * 1.65;
  layer.visor.rotation.y = Math.sin(time * 1.8) * 0.06;

  layer.orbiters.forEach((orbiter, index) => {
    const angle = time * (1.0 + index * 0.08) + index * ((Math.PI * 2) / layer.orbiters.length);
    const radius = 0.13 + index * 0.014;
    orbiter.position.set(
      Math.cos(angle) * radius,
      layout.waistY + 0.01 + Math.sin(angle * 1.7) * 0.028,
      Math.sin(angle) * radius * 0.72,
    );
    orbiter.rotation.x = angle * 1.3;
    orbiter.rotation.y = angle * 0.9;
  });
}

function disposeLayer(fighter: FighterRuntime): void {
  const layer = layers.get(fighter);
  if (!layer) return;
  layer.group.removeFromParent();
  layer.geometries.forEach((geometry) => geometry.dispose());
  layer.materials.forEach((material) => material.dispose());
  layers.delete(fighter);
}

export function installVantaFighterPresentation(): void {
  if (installed) return;
  installed = true;
  registerVantaCircuitRival();

  const prototype = TpsFightGame.prototype as unknown as {
    updateVisual(fighter: FighterRuntime, opponent: FighterRuntime, time: number): void;
    destroy(): void;
  };
  const baseUpdateVisual = prototype.updateVisual;
  const baseDestroy = prototype.destroy;

  prototype.updateVisual = function updateVisualWithVanta(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    time: number,
  ): void {
    baseUpdateVisual.call(this, fighter, opponent, time);
    updateLayer(fighter, time);
  };

  prototype.destroy = function destroyWithVanta(): void {
    const game = this as unknown as { p1: FighterRuntime; p2: FighterRuntime };
    disposeLayer(game.p1);
    disposeLayer(game.p2);
    baseDestroy.call(this);
  };
}

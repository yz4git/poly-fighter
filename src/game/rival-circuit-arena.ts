import * as THREE from "three";
import { TpsFightGame } from "./tps-game";

export type RivalCircuitArenaId = "GLASSLINE" | "OFFSET" | "COLD" | "REDLINE" | "APEX";

export interface RivalCircuitArenaProfile {
  stage: number;
  id: RivalCircuitArenaId;
  label: string;
  accent: number;
  secondary: number;
  backdrop: number;
  propCount: number;
  propHeight: number;
  ringCount: number;
  tilt: number;
}

export const RIVAL_CIRCUIT_ARENAS: readonly RivalCircuitArenaProfile[] = Object.freeze([
  Object.freeze({ stage: 1, id: "GLASSLINE", label: "RING 01 // GLASSLINE", accent: 0x68e8ff, secondary: 0x2d7fa4, backdrop: 0x03111d, propCount: 12, propHeight: 1.7, ringCount: 2, tilt: 0.08 }),
  Object.freeze({ stage: 2, id: "OFFSET", label: "RING 02 // OFFSET", accent: 0xd06cff, secondary: 0x4ecdf2, backdrop: 0x10091b, propCount: 10, propHeight: 2.05, ringCount: 3, tilt: 0.34 }),
  Object.freeze({ stage: 3, id: "COLD", label: "RING 03 // COLD", accent: 0xc7f5ff, secondary: 0x4a74ff, backdrop: 0x03091a, propCount: 14, propHeight: 1.35, ringCount: 2, tilt: 0 }),
  Object.freeze({ stage: 4, id: "REDLINE", label: "RING 04 // REDLINE", accent: 0xff4867, secondary: 0xffaa55, backdrop: 0x160509, propCount: 16, propHeight: 2.15, ringCount: 3, tilt: 0.16 }),
  Object.freeze({ stage: 5, id: "APEX", label: "RING 05 // APEX", accent: 0xffd85f, secondary: 0x75eaff, backdrop: 0x0b0a12, propCount: 8, propHeight: 2.75, ringCount: 4, tilt: 0.22 }),
]);

type ArenaState = {
  group: THREE.Group;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  previousBackground: THREE.Color | THREE.Texture | null;
  previousFogColor: THREE.Color | null;
};

const states = new WeakMap<TpsFightGame, ArenaState>();
let installed = false;

export function rivalCircuitArenaForStage(stage: number): RivalCircuitArenaProfile {
  const safe = Math.max(1, Math.min(RIVAL_CIRCUIT_ARENAS.length, Math.floor(stage || 1)));
  return RIVAL_CIRCUIT_ARENAS[safe - 1] ?? RIVAL_CIRCUIT_ARENAS[0];
}

export function rivalCircuitStageFromLabel(label: string): number | null {
  const match = label.toUpperCase().match(/CIRCUIT\s+(\d+)\s*\/\s*5/);
  if (!match) return null;
  const stage = Number(match[1]);
  return Number.isFinite(stage) && stage >= 1 && stage <= 5 ? stage : null;
}

function stageFromDom(): number | null {
  if (typeof document === "undefined") return null;
  const strip = document.querySelector<HTMLElement>(".circuit-run-strip");
  return rivalCircuitStageFromLabel(strip?.textContent ?? "");
}

function makeTheme(profile: RivalCircuitArenaProfile): Pick<ArenaState, "group" | "geometries" | "materials"> {
  const group = new THREE.Group();
  group.name = "rival-circuit-arena-theme";
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const floorMaterial = new THREE.MeshBasicMaterial({
    color: profile.secondary,
    transparent: true,
    opacity: profile.id === "APEX" ? 0.24 : 0.16,
    depthWrite: false,
  });
  materials.push(floorMaterial);
  for (let index = 0; index < profile.ringCount; index += 1) {
    const radius = 3.25 + index * 1.05;
    const geometry = new THREE.TorusGeometry(radius, profile.id === "REDLINE" ? 0.024 : 0.014, 5, 72);
    const ring = new THREE.Mesh(geometry, floorMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.018 + index * 0.002;
    ring.name = `rival-circuit-floor-ring-${index + 1}`;
    group.add(ring);
    geometries.push(geometry);
  }

  const propGeometry = profile.id === "GLASSLINE"
    ? new THREE.BoxGeometry(0.045, profile.propHeight, 0.62)
    : profile.id === "APEX"
      ? new THREE.CylinderGeometry(0.12, 0.30, profile.propHeight, 5)
      : new THREE.BoxGeometry(0.12, profile.propHeight, 0.22);
  const propMaterial = new THREE.MeshStandardMaterial({
    color: profile.secondary,
    emissive: profile.accent,
    emissiveIntensity: profile.id === "REDLINE" || profile.id === "APEX" ? 1.25 : 0.82,
    roughness: profile.id === "GLASSLINE" ? 0.18 : 0.62,
    metalness: profile.id === "GLASSLINE" ? 0.48 : 0.22,
    transparent: profile.id === "GLASSLINE",
    opacity: profile.id === "GLASSLINE" ? 0.46 : 0.86,
    depthWrite: profile.id !== "GLASSLINE",
  });
  materials.push(propMaterial);
  const props = new THREE.InstancedMesh(propGeometry, propMaterial, profile.propCount);
  props.name = "rival-circuit-arena-props";
  props.frustumCulled = false;
  const dummy = new THREE.Object3D();
  for (let index = 0; index < profile.propCount; index += 1) {
    const angle = index * Math.PI * 2 / profile.propCount + (profile.id === "OFFSET" ? Math.PI / 12 : 0);
    const radius = profile.id === "APEX" ? 9.1 : 8.45 + (index % 2) * 0.34;
    const heightScale = profile.id === "COLD" ? 0.78 + (index % 3) * 0.12 : 0.88 + (index % 4) * 0.08;
    dummy.position.set(Math.cos(angle) * radius, profile.propHeight * 0.5 * heightScale, Math.sin(angle) * radius);
    dummy.rotation.set(profile.tilt * (index % 2 === 0 ? 1 : -1), -angle + Math.PI / 2, profile.id === "OFFSET" ? profile.tilt * (index % 2 === 0 ? 1 : -1) : 0);
    dummy.scale.set(1, heightScale, 1);
    dummy.updateMatrix();
    props.setMatrixAt(index, dummy.matrix);
  }
  props.instanceMatrix.needsUpdate = true;
  group.add(props);
  geometries.push(propGeometry);

  const haloMaterial = new THREE.MeshBasicMaterial({
    color: profile.accent,
    transparent: true,
    opacity: profile.id === "APEX" ? 0.44 : 0.28,
    depthWrite: false,
  });
  materials.push(haloMaterial);
  const haloLevels = profile.id === "APEX" ? [2.7, 3.15, 3.6] : profile.id === "REDLINE" ? [2.65, 3.25] : [3.05];
  for (let index = 0; index < haloLevels.length; index += 1) {
    const geometry = new THREE.TorusGeometry(8.72 + index * 0.28, 0.022 + index * 0.005, 5, 96);
    const halo = new THREE.Mesh(geometry, haloMaterial);
    halo.rotation.x = Math.PI / 2 + (profile.id === "OFFSET" ? 0.08 * (index + 1) : 0);
    halo.rotation.z = profile.id === "OFFSET" ? 0.12 : 0;
    halo.position.y = haloLevels[index];
    halo.name = `rival-circuit-halo-${index + 1}`;
    group.add(halo);
    geometries.push(geometry);
  }

  if (profile.id === "REDLINE") {
    const gateGeometry = new THREE.BoxGeometry(1.45, 0.05, 0.08);
    const gateMaterial = new THREE.MeshBasicMaterial({ color: profile.accent, transparent: true, opacity: 0.62, depthWrite: false });
    geometries.push(gateGeometry);
    materials.push(gateMaterial);
    const gates = new THREE.InstancedMesh(gateGeometry, gateMaterial, 8);
    const gateDummy = new THREE.Object3D();
    for (let index = 0; index < 8; index += 1) {
      const angle = index * Math.PI / 4;
      gateDummy.position.set(Math.cos(angle) * 8.65, 2.42, Math.sin(angle) * 8.65);
      gateDummy.rotation.set(0, -angle + Math.PI / 2, index % 2 === 0 ? 0.18 : -0.18);
      gateDummy.updateMatrix();
      gates.setMatrixAt(index, gateDummy.matrix);
    }
    gates.instanceMatrix.needsUpdate = true;
    gates.name = "rival-circuit-redline-gates";
    group.add(gates);
  }

  group.userData.rivalCircuitArenaTheme = true;
  group.userData.rivalCircuitArenaStage = profile.stage;
  group.userData.rivalCircuitArenaId = profile.id;
  group.userData.rivalCircuitArenaLabel = profile.label;
  group.userData.rivalCircuitArenaPropCount = profile.propCount;
  group.userData.rivalCircuitArenaRingCount = profile.ringCount;

  return { group, geometries, materials };
}

function ensureArenaTheme(game: TpsFightGame): void {
  if (states.has(game)) return;
  const stage = stageFromDom();
  if (!stage) return;
  const profile = rivalCircuitArenaForStage(stage);
  const created = makeTheme(profile);
  const previousBackground = game.scene.background;
  const previousFogColor = game.scene.fog instanceof THREE.FogExp2 || game.scene.fog instanceof THREE.Fog
    ? game.scene.fog.color.clone()
    : null;

  game.scene.background = new THREE.Color(profile.backdrop);
  if (game.scene.fog instanceof THREE.FogExp2 || game.scene.fog instanceof THREE.Fog) {
    game.scene.fog.color.set(profile.backdrop);
  }
  game.scene.add(created.group);
  states.set(game, { ...created, previousBackground, previousFogColor });
}

function disposeArenaTheme(game: TpsFightGame): void {
  const state = states.get(game);
  if (!state) return;
  state.group.removeFromParent();
  state.group.clear();
  for (const geometry of state.geometries) geometry.dispose();
  for (const material of state.materials) material.dispose();
  game.scene.background = state.previousBackground;
  if (state.previousFogColor && (game.scene.fog instanceof THREE.FogExp2 || game.scene.fog instanceof THREE.Fog)) {
    game.scene.fog.color.copy(state.previousFogColor);
  }
  states.delete(game);
}

export function installRivalCircuitArenaPresentation(): void {
  if (installed) return;
  installed = true;

  const prototype = TpsFightGame.prototype;
  const baseStart = prototype.start;
  const baseDestroy = prototype.destroy;

  prototype.start = function startWithRivalCircuitArena(): void {
    baseStart.call(this);
    ensureArenaTheme(this);
  };

  prototype.destroy = function destroyWithRivalCircuitArena(): void {
    disposeArenaTheme(this);
    baseDestroy.call(this);
  };
}

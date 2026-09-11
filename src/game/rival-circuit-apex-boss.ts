import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { TpsFightGame } from "./tps-game";

export type ApexBossPhase = "CALIBRATE" | "ADAPT" | "ZERO";

export interface ApexBossPhaseProfile {
  phase: ApexBossPhase;
  minHealth: number;
  label: string;
  glow: number;
  pulseRate: number;
  bladeRadius: number;
}

export const APEX_BOSS_PHASES: readonly ApexBossPhaseProfile[] = Object.freeze([
  Object.freeze({ phase: "CALIBRATE", minHealth: 61, label: "PHASE 1 // CALIBRATE", glow: 0x7ce8ff, pulseRate: 0.075, bladeRadius: 0.29 }),
  Object.freeze({ phase: "ADAPT", minHealth: 31, label: "PHASE 2 // ADAPT", glow: 0xffd25f, pulseRate: 0.11, bladeRadius: 0.34 }),
  Object.freeze({ phase: "ZERO", minHealth: 0, label: "PHASE 3 // ZERO", glow: 0xff315f, pulseRate: 0.16, bladeRadius: 0.39 }),
]);

export function apexBossPhaseForHealth(health: number): ApexBossPhaseProfile {
  const value = Math.max(0, Math.min(100, health));
  return value >= 61 ? APEX_BOSS_PHASES[0] : value >= 31 ? APEX_BOSS_PHASES[1] : APEX_BOSS_PHASES[2];
}

type ApexRuntime = {
  p2: FighterRuntime;
  simulationTicks: number;
  setCombatBeat(label: string, ticks?: number): void;
};

type ApexVisualState = {
  phase: ApexBossPhase;
  torsoGroup: THREE.Group;
  headGroup: THREE.Group;
  leftShoulderGroup: THREE.Group;
  rightShoulderGroup: THREE.Group;
  bladeGroup: THREE.Group;
  core: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
  coreRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  blades: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshStandardMaterial>[];
  emissiveMaterials: Array<THREE.MeshBasicMaterial | THREE.MeshStandardMaterial>;
  geometries: THREE.BufferGeometry[];
};

const states = new WeakMap<object, ApexVisualState>();
let installed = false;

function apexActive(): boolean {
  if (typeof document === "undefined") return false;
  const strip = document.querySelector<HTMLElement>(".circuit-run-strip");
  const text = strip?.textContent?.toUpperCase() ?? "";
  return text.includes("APEX-0") || text.includes("FINAL RIVAL");
}

function makeArmorMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x10131d,
    emissive: 0x111827,
    emissiveIntensity: 0.55,
    metalness: 0.72,
    roughness: 0.3,
    flatShading: true,
  });
}

function createApexVisual(game: ApexRuntime): ApexVisualState {
  const visual = game.p2.visual;
  const armorMaterial = makeArmorMaterial();
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: 0x20283c,
    emissive: 0x7ce8ff,
    emissiveIntensity: 1.5,
    metalness: 0.58,
    roughness: 0.28,
    flatShading: true,
  });
  const coreMaterial = new THREE.MeshBasicMaterial({ color: 0x7ce8ff, transparent: true, opacity: 0.92 });
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x7ce8ff, transparent: true, opacity: 0.72, depthWrite: false });

  const torsoGroup = new THREE.Group();
  torsoGroup.name = "apex-zero-torso-armor";
  const chestGeometry = new THREE.OctahedronGeometry(0.105, 0);
  const chestPlate = new THREE.Mesh(chestGeometry, armorMaterial);
  chestPlate.scale.set(1.7, 0.62, 0.72);
  chestPlate.position.set(0, 0.02, 0.075);
  torsoGroup.add(chestPlate);

  const coreGeometry = new THREE.IcosahedronGeometry(0.043, 1);
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  core.position.set(0, 0.015, 0.145);
  torsoGroup.add(core);

  const ringGeometry = new THREE.TorusGeometry(0.078, 0.009, 6, 28);
  const coreRing = new THREE.Mesh(ringGeometry, ringMaterial);
  coreRing.position.set(0, 0.015, 0.137);
  coreRing.rotation.x = Math.PI / 2;
  torsoGroup.add(coreRing);
  visual.torso.add(torsoGroup);

  const headGroup = new THREE.Group();
  headGroup.name = "apex-zero-head-armor";
  const visorGeometry = new THREE.BoxGeometry(0.15, 0.034, 0.055, 2, 1, 1);
  const visor = new THREE.Mesh(visorGeometry, accentMaterial);
  visor.position.set(0, 0.005, 0.072);
  const crestGeometry = new THREE.ConeGeometry(0.035, 0.13, 5);
  const crest = new THREE.Mesh(crestGeometry, armorMaterial);
  crest.position.set(0, 0.115, -0.015);
  crest.rotation.z = Math.PI;
  headGroup.add(visor, crest);
  visual.head.add(headGroup);

  const shoulderGeometry = new THREE.OctahedronGeometry(0.07, 0);
  const leftShoulderGroup = new THREE.Group();
  const rightShoulderGroup = new THREE.Group();
  const leftPlate = new THREE.Mesh(shoulderGeometry, armorMaterial);
  const rightPlate = new THREE.Mesh(shoulderGeometry, armorMaterial);
  leftPlate.scale.set(1.55, 0.64, 1.05);
  rightPlate.scale.copy(leftPlate.scale);
  leftPlate.position.set(-0.025, 0.005, 0.02);
  rightPlate.position.set(0.025, 0.005, 0.02);
  leftShoulderGroup.add(leftPlate);
  rightShoulderGroup.add(rightPlate);
  visual.leftArm.root.add(leftShoulderGroup);
  visual.rightArm.root.add(rightShoulderGroup);

  const bladeGroup = new THREE.Group();
  bladeGroup.name = "apex-zero-floating-blades";
  const bladeGeometry = new THREE.OctahedronGeometry(0.05, 0);
  const bladeMaterial = accentMaterial.clone();
  const blades: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshStandardMaterial>[] = [];
  for (let index = 0; index < 4; index += 1) {
    const blade = new THREE.Mesh(bladeGeometry, bladeMaterial);
    blade.scale.set(0.42, 1.9, 0.54);
    bladeGroup.add(blade);
    blades.push(blade);
  }
  visual.root.add(bladeGroup);

  const state: ApexVisualState = {
    phase: "CALIBRATE",
    torsoGroup,
    headGroup,
    leftShoulderGroup,
    rightShoulderGroup,
    bladeGroup,
    core,
    coreRing,
    blades,
    emissiveMaterials: [accentMaterial, bladeMaterial, coreMaterial, ringMaterial],
    geometries: [chestGeometry, coreGeometry, ringGeometry, visorGeometry, crestGeometry, shoulderGeometry, bladeGeometry],
  };
  states.set(game as unknown as object, state);
  visual.root.userData.tpsApexBoss = true;
  return state;
}

function applyPhase(game: ApexRuntime, state: ApexVisualState, profile: ApexBossPhaseProfile): void {
  if (state.phase !== profile.phase) {
    state.phase = profile.phase;
    game.setCombatBeat(`APEX-0 ${profile.label}`, 52);
  }

  const color = new THREE.Color(profile.glow);
  for (const material of state.emissiveMaterials) {
    material.color.copy(color);
    if (material instanceof THREE.MeshStandardMaterial) {
      material.emissive.copy(color);
      material.emissiveIntensity = profile.phase === "ZERO" ? 2.25 : profile.phase === "ADAPT" ? 1.8 : 1.35;
    }
  }

  const pulse = 1 + Math.sin(game.simulationTicks * profile.pulseRate) * (profile.phase === "ZERO" ? 0.16 : 0.09);
  state.core.scale.setScalar(pulse);
  state.coreRing.scale.setScalar(0.92 + pulse * 0.16);
  state.coreRing.rotation.z += profile.phase === "ZERO" ? 0.055 : 0.032;
  state.bladeGroup.rotation.y += profile.phase === "ZERO" ? 0.035 : 0.022;

  const baseHeight = profile.phase === "ZERO" ? 0.67 : 0.64;
  for (let index = 0; index < state.blades.length; index += 1) {
    const blade = state.blades[index];
    const angle = game.simulationTicks * (profile.phase === "ZERO" ? 0.045 : 0.028) + index * Math.PI * 0.5;
    const radius = profile.bladeRadius + (index % 2) * 0.035;
    blade.position.set(
      Math.cos(angle) * radius,
      baseHeight + Math.sin(angle * 1.7) * 0.085,
      Math.sin(angle) * radius,
    );
    blade.rotation.set(angle * 0.35, -angle, angle * 0.22);
  }

  const rootData = game.p2.visual.root.userData;
  rootData.tpsApexBoss = true;
  rootData.tpsApexBossPhase = profile.phase;
  rootData.tpsApexBossPhaseLabel = profile.label;
  rootData.tpsApexBossHealth = game.p2.health;
  rootData.tpsApexBossBladeCount = state.blades.length;
  if (typeof document !== "undefined") {
    document.body.dataset.rivalCircuitApexBoss = "APEX_ZERO_V1";
    document.body.dataset.rivalCircuitApexPhase = profile.phase;
    document.body.dataset.rivalCircuitApexPhaseLabel = profile.label;
    document.body.dataset.rivalCircuitApexBladeCount = String(state.blades.length);
  }
}

function clearDiagnostics(): void {
  if (typeof document === "undefined") return;
  delete document.body.dataset.rivalCircuitApexBoss;
  delete document.body.dataset.rivalCircuitApexPhase;
  delete document.body.dataset.rivalCircuitApexPhaseLabel;
  delete document.body.dataset.rivalCircuitApexBladeCount;
}

function disposeState(game: object): void {
  const state = states.get(game);
  if (!state) return;
  state.torsoGroup.removeFromParent();
  state.headGroup.removeFromParent();
  state.leftShoulderGroup.removeFromParent();
  state.rightShoulderGroup.removeFromParent();
  state.bladeGroup.removeFromParent();
  for (const geometry of state.geometries) geometry.dispose();
  for (const material of state.emissiveMaterials) material.dispose();
  states.delete(game);
}

export function installRivalCircuitApexBossRuntime(): void {
  if (installed) return;
  installed = true;

  const prototype = TpsFightGame.prototype as unknown as {
    updateEnemy(): void;
    resetRound(): void;
    destroy(): void;
  };
  const baseUpdateEnemy = prototype.updateEnemy;
  const baseResetRound = prototype.resetRound;
  const baseDestroy = prototype.destroy;

  prototype.updateEnemy = function updateEnemyWithApexBoss(): void {
    baseUpdateEnemy.call(this);
    const game = this as unknown as ApexRuntime;
    if (!apexActive()) {
      clearDiagnostics();
      return;
    }
    const state = states.get(this as unknown as object) ?? createApexVisual(game);
    applyPhase(game, state, apexBossPhaseForHealth(game.p2.health));
  };

  prototype.resetRound = function resetRoundWithApexBoss(): void {
    baseResetRound.call(this);
    const game = this as unknown as ApexRuntime;
    if (!apexActive()) return;
    const state = states.get(this as unknown as object) ?? createApexVisual(game);
    state.phase = "CALIBRATE";
    applyPhase(game, state, apexBossPhaseForHealth(game.p2.health));
  };

  prototype.destroy = function destroyWithApexBoss(): void {
    disposeState(this as unknown as object);
    clearDiagnostics();
    baseDestroy.call(this);
  };
}

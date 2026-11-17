import * as THREE from "three";
import { createCircularArena, TPS_ARENA_RADIUS } from "./tps-arena-factory";
import { TPS_CAMERA_DEFAULT_FOV } from "./tps-camera-profile";
import { TpsGraphicsDirector } from "./tps-graphics";
import type { Quality } from "./settings";

// One warm key / cool rim pair, not an extra light per decoration. Keeping
// direct-light cost fixed protects iPhone Safari's GPU budget while reducing
// the flat, blown-out whites seen in the last captured fight screenshots.
export const TPS_HERO_LIGHTING_PROFILE = Object.freeze({
  sky: 0xb6d9f2,
  ground: 0x111c2c,
  hemiIntensity: 1.92,
  keyColor: 0xffe9dc,
  keyIntensity: 3.12,
  rimColor: 0x70d1ff,
  rimIntensity: 2.66,
  directLights: 2,
});

export type TpsSceneSetup = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  graphics: TpsGraphicsDirector;
  arenaDisposables: Array<THREE.BufferGeometry | THREE.Material>;
  lockRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  lockStem: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  targetGroundRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
};

export function tpsPixelRatioCap(quality: Quality): number {
  return quality === "LOW" ? 1 : quality === "HIGH" ? 1.75 : 1.35;
}

export function createTpsSceneSetup(input: {
  mount: HTMLElement;
  quality: Quality;
  effectsGroup: THREE.Group;
  onFallback?: (message: string) => void;
}): TpsSceneSetup {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: input.quality !== "LOW",
      alpha: false,
      powerPreference: "high-performance",
      failIfMajorPerformanceCaveat: false,
    });
  } catch {
    input.onFallback?.("TPSモードのWebGLを初期化できませんでした。Safariを再読み込みしてもう一度お試しください。");
    throw new Error("POLY_FIGHTER_TPS_WEBGL_UNAVAILABLE");
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030b16);
  scene.fog = new THREE.FogExp2(0x030b16, 0.032);

  const camera = new THREE.PerspectiveCamera(TPS_CAMERA_DEFAULT_FOV, 1, 0.1, 80);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = false;
  renderer.domElement.setAttribute(
    "aria-label",
    "POLY FIGHTER TPS lock-on battle arena",
  );
  input.mount.replaceChildren(renderer.domElement);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tpsPixelRatioCap(input.quality)));

  const light = TPS_HERO_LIGHTING_PROFILE;
  const hemi = new THREE.HemisphereLight(light.sky, light.ground, light.hemiIntensity);
  const key = new THREE.DirectionalLight(light.keyColor, light.keyIntensity);
  key.position.set(-4, 9, 5);
  const rim = new THREE.DirectionalLight(light.rimColor, light.rimIntensity);
  rim.position.set(5, 4, -6);
  scene.add(hemi, key, rim);

  const arena = createCircularArena();
  const arenaDisposables = arena.disposables;
  scene.add(arena.group, input.effectsGroup);
  const graphics = new TpsGraphicsDirector(
    scene,
    renderer,
    TPS_ARENA_RADIUS,
    input.quality,
  );

  const lockGeometry = new THREE.TorusGeometry(0.38, 0.018, 8, 48);
  const lockMaterial = new THREE.MeshBasicMaterial({
    color: 0x7ce8ff,
    transparent: true,
    opacity: 0.82,
    depthTest: true,
    depthWrite: false,
  });
  const lockRing = new THREE.Mesh(lockGeometry, lockMaterial);
  lockRing.renderOrder = 20;
  scene.add(lockRing);
  arenaDisposables.push(lockGeometry, lockMaterial);

  const stemGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(),
    new THREE.Vector3(0, 0.34, 0),
  ]);
  const stemMaterial = new THREE.LineBasicMaterial({
    color: 0x7ce8ff,
    transparent: true,
    opacity: 0.76,
    depthTest: true,
    depthWrite: false,
  });
  const lockStem = new THREE.Line(stemGeometry, stemMaterial);
  lockStem.renderOrder = 20;
  scene.add(lockStem);
  arenaDisposables.push(stemGeometry, stemMaterial);

  const targetGroundGeometry = new THREE.RingGeometry(0.58, 0.70, 48);
  const targetGroundMaterial = new THREE.MeshBasicMaterial({
    color: 0x7ce8ff,
    transparent: true,
    opacity: 0.3,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const targetGroundRing = new THREE.Mesh(
    targetGroundGeometry,
    targetGroundMaterial,
  );
  targetGroundRing.name = "tps-target-ground-ring";
  targetGroundRing.rotation.x = -Math.PI / 2;
  targetGroundRing.position.y = 0.035;
  scene.add(targetGroundRing);
  arenaDisposables.push(targetGroundGeometry, targetGroundMaterial);

  return {
    renderer,
    scene,
    camera,
    graphics,
    arenaDisposables,
    lockRing,
    lockStem,
    targetGroundRing,
  };
}

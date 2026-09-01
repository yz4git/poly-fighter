import * as THREE from "three";
import type { FighterDefinition } from "./types";
import type { FighterVisual } from "./visual";

export const QUATERNIUS_CHARACTER_GRAPHICS_V2_ID = "QUATERNIUS_CHARACTER_GRAPHICS_V2_FACIAL_SILHOUETTE_LAYERING";

interface V2FollowerSpec {
  name: string;
  boneNames: readonly string[];
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  offset: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  scale?: readonly [number, number, number];
  layer: "FACE" | "HAIR" | "TORSO" | "ARM" | "WAIST" | "LEG";
}

function bladeGeometry(width: number, height: number, depth: number, tipOffset = 0): THREE.BufferGeometry {
  const halfWidth = width * 0.5;
  const halfHeight = height * 0.5;
  const halfDepth = depth * 0.5;
  const positions = [
    -halfWidth, -halfHeight, -halfDepth,
    halfWidth, -halfHeight, -halfDepth,
    tipOffset, halfHeight, -halfDepth * 0.38,
    -halfWidth, -halfHeight, halfDepth,
    halfWidth, -halfHeight, halfDepth,
    tipOffset, halfHeight, halfDepth * 0.38,
  ];
  const indices = [
    0, 1, 2,
    3, 5, 4,
    0, 3, 4, 0, 4, 1,
    1, 4, 5, 1, 5, 2,
    2, 5, 3, 2, 3, 0,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function panelGeometry(
  width: number,
  height: number,
  depth: number,
  topScale = 1,
  bottomScale = 1,
): THREE.BufferGeometry {
  const top = width * topScale * 0.5;
  const bottom = width * bottomScale * 0.5;
  const halfHeight = height * 0.5;
  const halfDepth = depth * 0.5;
  const positions = [
    -bottom, -halfHeight, -halfDepth,
    bottom, -halfHeight, -halfDepth,
    -top, halfHeight, -halfDepth,
    top, halfHeight, -halfDepth,
    -bottom, -halfHeight, halfDepth,
    bottom, -halfHeight, halfDepth,
    -top, halfHeight, halfDepth,
    top, halfHeight, halfDepth,
  ];
  const indices = [
    0, 2, 1, 1, 2, 3,
    4, 5, 6, 5, 7, 6,
    0, 4, 2, 4, 6, 2,
    1, 3, 5, 5, 3, 7,
    2, 6, 3, 3, 6, 7,
    0, 1, 4, 1, 5, 4,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function heroMaterial(
  color: THREE.ColorRepresentation,
  metalness: number,
  roughness: number,
  emissiveBoost = 0,
): THREE.MeshStandardMaterial {
  const base = new THREE.Color(color);
  const material = new THREE.MeshStandardMaterial({
    color: base,
    flatShading: true,
    metalness,
    roughness,
  });
  material.envMapIntensity = metalness > 0.2 ? 1.42 : 1.15;
  material.dithering = true;
  if (emissiveBoost > 0) {
    material.emissive.copy(base).multiplyScalar(0.16);
    material.emissiveIntensity = emissiveBoost;
  }
  return material;
}

function firstNode(root: THREE.Object3D, names: readonly string[]): THREE.Object3D | null {
  for (const name of names) {
    const exact = root.getObjectByName(name);
    if (exact) return exact;
  }
  const lowercase = new Set(names.map((name) => name.toLowerCase()));
  let found: THREE.Object3D | null = null;
  root.traverse((object) => {
    if (!found && lowercase.has(object.name.toLowerCase())) found = object;
  });
  return found;
}

function addFollower(visual: FighterVisual, host: THREE.Object3D, spec: V2FollowerSpec): THREE.Mesh | null {
  const bone = firstNode(host, spec.boneNames);
  if (!bone) {
    spec.geometry.dispose();
    return null;
  }

  const mesh = new THREE.Mesh(spec.geometry, spec.material);
  mesh.name = spec.name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.userData.characterGraphicsDetail = QUATERNIUS_CHARACTER_GRAPHICS_V2_ID;
  mesh.userData.characterGraphicsV2Layer = spec.layer;
  mesh.userData.followerMode = "BIND_TO_ANIMATED_DELTA";
  if (spec.scale) mesh.scale.set(spec.scale[0], spec.scale[1], spec.scale[2]);
  visual.root.add(mesh);

  const worldPosition = new THREE.Vector3();
  const localPosition = new THREE.Vector3();
  const rootWorldQuaternion = new THREE.Quaternion();
  const boneWorldQuaternion = new THREE.Quaternion();
  const currentBoneRootQuaternion = new THREE.Quaternion();
  const bindBoneRootQuaternion = new THREE.Quaternion();
  const inverseBindBoneRootQuaternion = new THREE.Quaternion();
  const poseDelta = new THREE.Quaternion();
  const offset = new THREE.Vector3(spec.offset[0], spec.offset[1], spec.offset[2]);
  const rotatedOffset = new THREE.Vector3();
  const authoredRestRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    spec.rotation?.[0] ?? 0,
    spec.rotation?.[1] ?? 0,
    spec.rotation?.[2] ?? 0,
  ));

  visual.root.updateWorldMatrix(true, false);
  bone.updateWorldMatrix(true, false);
  visual.root.getWorldQuaternion(rootWorldQuaternion);
  bone.getWorldQuaternion(boneWorldQuaternion);
  bindBoneRootQuaternion.copy(rootWorldQuaternion).invert().multiply(boneWorldQuaternion).normalize();
  inverseBindBoneRootQuaternion.copy(bindBoneRootQuaternion).invert();

  const sync = (): void => {
    visual.root.updateWorldMatrix(true, false);
    bone.updateWorldMatrix(true, false);
    bone.getWorldPosition(worldPosition);
    localPosition.copy(worldPosition);
    visual.root.worldToLocal(localPosition);

    visual.root.getWorldQuaternion(rootWorldQuaternion);
    bone.getWorldQuaternion(boneWorldQuaternion);
    currentBoneRootQuaternion.copy(rootWorldQuaternion).invert().multiply(boneWorldQuaternion).normalize();
    poseDelta.copy(currentBoneRootQuaternion).multiply(inverseBindBoneRootQuaternion).normalize();

    rotatedOffset.copy(offset).applyQuaternion(poseDelta);
    mesh.position.copy(localPosition).add(rotatedOffset);
    mesh.quaternion.copy(poseDelta).multiply(authoredRestRotation);
  };

  sync();
  mesh.onBeforeRender = sync;
  return mesh;
}

function buildKairoV2(visual: FighterVisual, host: THREE.Object3D, definition: FighterDefinition): THREE.Mesh[] {
  const hair = heroMaterial(definition.colors.hair, 0.025, 0.30);
  const skin = heroMaterial(definition.colors.skin, 0.0, 0.58);
  const primary = heroMaterial(definition.colors.primary, 0.18, 0.35);
  const accent = heroMaterial(definition.colors.accent, 0.22, 0.31, 0.26);
  const dark = heroMaterial(new THREE.Color(definition.colors.secondary).lerp(new THREE.Color(0x10131a), 0.26), 0.08, 0.48);
  const metal = heroMaterial(new THREE.Color(0xe9eef4).lerp(new THREE.Color(definition.colors.primary), 0.20), 0.46, 0.26);

  const specs: V2FollowerSpec[] = [
    {
      name: "ubc-kairo-v2-left-side-lock",
      boneNames: ["Head", "head"],
      geometry: bladeGeometry(0.019, 0.082, 0.018, -0.004),
      material: hair,
      offset: [-0.052, 0.038, 0.021],
      rotation: [0.10, 0.18, -0.24],
      layer: "HAIR",
    },
    {
      name: "ubc-kairo-v2-right-side-lock",
      boneNames: ["Head", "head"],
      geometry: bladeGeometry(0.018, 0.078, 0.018, 0.004),
      material: hair,
      offset: [0.052, 0.040, 0.021],
      rotation: [0.10, -0.18, 0.22],
      layer: "HAIR",
    },
    {
      name: "ubc-kairo-v2-left-brow",
      boneNames: ["Head", "head"],
      geometry: new THREE.BoxGeometry(0.031, 0.006, 0.010),
      material: dark,
      offset: [-0.020, 0.020, 0.069],
      rotation: [0.03, -0.04, -0.08],
      layer: "FACE",
    },
    {
      name: "ubc-kairo-v2-right-brow",
      boneNames: ["Head", "head"],
      geometry: new THREE.BoxGeometry(0.031, 0.006, 0.010),
      material: dark,
      offset: [0.020, 0.020, 0.069],
      rotation: [0.03, 0.04, 0.08],
      layer: "FACE",
    },
    {
      name: "ubc-kairo-v2-left-cheek-plane",
      boneNames: ["Head", "head"],
      geometry: bladeGeometry(0.016, 0.031, 0.008, -0.003),
      material: skin,
      offset: [-0.040, -0.006, 0.064],
      rotation: [-0.05, 0.21, -0.12],
      layer: "FACE",
    },
    {
      name: "ubc-kairo-v2-right-cheek-plane",
      boneNames: ["Head", "head"],
      geometry: bladeGeometry(0.016, 0.031, 0.008, 0.003),
      material: skin,
      offset: [0.040, -0.006, 0.064],
      rotation: [-0.05, -0.21, 0.12],
      layer: "FACE",
    },
    {
      name: "ubc-kairo-v2-collar-left",
      boneNames: ["spine_03"],
      geometry: bladeGeometry(0.066, 0.050, 0.020, -0.012),
      material: dark,
      offset: [-0.042, 0.038, 0.067],
      rotation: [1.20, 0.03, -0.20],
      layer: "TORSO",
    },
    {
      name: "ubc-kairo-v2-collar-right",
      boneNames: ["spine_03"],
      geometry: bladeGeometry(0.066, 0.050, 0.020, 0.012),
      material: dark,
      offset: [0.042, 0.038, 0.067],
      rotation: [1.20, -0.03, 0.20],
      layer: "TORSO",
    },
    {
      name: "ubc-kairo-v2-chest-chevron",
      boneNames: ["spine_03", "spine_02"],
      geometry: bladeGeometry(0.052, 0.070, 0.014, 0),
      material: accent,
      offset: [0, -0.010, 0.087],
      rotation: [0, 0, Math.PI],
      scale: [0.72, 0.72, 1],
      layer: "TORSO",
    },
    {
      name: "ubc-kairo-v2-left-shoulder-fin",
      boneNames: ["clavicle_l", "upperarm_l"],
      geometry: bladeGeometry(0.042, 0.074, 0.020, -0.010),
      material: metal,
      offset: [-0.032, 0.005, 0.032],
      rotation: [0.16, 0.06, -1.06],
      layer: "ARM",
    },
    {
      name: "ubc-kairo-v2-right-shoulder-fin",
      boneNames: ["clavicle_r", "upperarm_r"],
      geometry: bladeGeometry(0.040, 0.070, 0.019, 0.010),
      material: metal,
      offset: [0.032, 0.005, 0.032],
      rotation: [0.16, -0.06, 1.06],
      layer: "ARM",
    },
    {
      name: "ubc-kairo-v2-left-knuckle-cap",
      boneNames: ["hand_l"],
      geometry: new THREE.BoxGeometry(0.050, 0.024, 0.050),
      material: primary,
      offset: [0, -0.015, 0.022],
      rotation: [0.08, 0, 0],
      layer: "ARM",
    },
    {
      name: "ubc-kairo-v2-right-knuckle-cap",
      boneNames: ["hand_r"],
      geometry: new THREE.BoxGeometry(0.050, 0.024, 0.050),
      material: accent,
      offset: [0, -0.015, 0.022],
      rotation: [0.08, 0, 0],
      layer: "ARM",
    },
    {
      name: "ubc-kairo-v2-left-belt-tab",
      boneNames: ["pelvis"],
      geometry: panelGeometry(0.032, 0.082, 0.012, 0.82, 1.0),
      material: dark,
      offset: [-0.080, 0.030, 0.025],
      rotation: [0.02, -0.35, -0.12],
      layer: "WAIST",
    },
    {
      name: "ubc-kairo-v2-right-belt-tab",
      boneNames: ["pelvis"],
      geometry: panelGeometry(0.032, 0.070, 0.012, 0.82, 1.0),
      material: dark,
      offset: [0.080, 0.035, 0.025],
      rotation: [0.02, 0.35, 0.12],
      layer: "WAIST",
    },
    {
      name: "ubc-kairo-v2-left-thigh-plate",
      boneNames: ["thigh_l"],
      geometry: panelGeometry(0.050, 0.102, 0.013, 0.86, 1.0),
      material: primary,
      offset: [-0.024, -0.072, 0.046],
      rotation: [0, -0.10, -0.03],
      layer: "LEG",
    },
    {
      name: "ubc-kairo-v2-right-thigh-plate",
      boneNames: ["thigh_r"],
      geometry: panelGeometry(0.050, 0.102, 0.013, 0.86, 1.0),
      material: accent,
      offset: [0.024, -0.072, 0.046],
      rotation: [0, 0.10, 0.03],
      layer: "LEG",
    },
    {
      name: "ubc-kairo-v2-left-toe-cap",
      boneNames: ["foot_l"],
      geometry: new THREE.BoxGeometry(0.070, 0.020, 0.062),
      material: metal,
      offset: [0, -0.008, 0.082],
      layer: "LEG",
    },
    {
      name: "ubc-kairo-v2-right-toe-cap",
      boneNames: ["foot_r"],
      geometry: new THREE.BoxGeometry(0.070, 0.020, 0.062),
      material: metal,
      offset: [0, -0.008, 0.082],
      layer: "LEG",
    },
  ];

  return specs.map((spec) => addFollower(visual, host, spec)).filter((value): value is THREE.Mesh => Boolean(value));
}

function buildSeraV2(visual: FighterVisual, host: THREE.Object3D, definition: FighterDefinition): THREE.Mesh[] {
  const hair = heroMaterial(definition.colors.hair, 0.02, 0.29);
  const skin = heroMaterial(definition.colors.skin, 0.0, 0.60);
  const primary = heroMaterial(definition.colors.primary, 0.15, 0.36);
  const accent = heroMaterial(definition.colors.accent, 0.20, 0.32, 0.28);
  const dark = heroMaterial(new THREE.Color(definition.colors.secondary).lerp(new THREE.Color(0x0f141c), 0.24), 0.07, 0.49);
  const light = heroMaterial(new THREE.Color(0xf1f6fb).lerp(new THREE.Color(definition.colors.primary), 0.12), 0.34, 0.31);

  const specs: V2FollowerSpec[] = [
    {
      name: "ubc-sera-v2-left-face-lock",
      boneNames: ["Head", "head"],
      geometry: bladeGeometry(0.017, 0.094, 0.017, -0.004),
      material: hair,
      offset: [-0.050, 0.031, 0.025],
      rotation: [0.08, 0.16, -0.20],
      layer: "HAIR",
    },
    {
      name: "ubc-sera-v2-right-face-lock",
      boneNames: ["Head", "head"],
      geometry: bladeGeometry(0.017, 0.088, 0.017, 0.004),
      material: hair,
      offset: [0.050, 0.034, 0.025],
      rotation: [0.08, -0.16, 0.18],
      layer: "HAIR",
    },
    {
      name: "ubc-sera-v2-ponytail-tip",
      boneNames: ["Head", "head"],
      geometry: bladeGeometry(0.020, 0.105, 0.018, 0.004),
      material: hair,
      offset: [-0.006, -0.070, -0.146],
      rotation: [0.86, 0.08, -0.08],
      layer: "HAIR",
    },
    {
      name: "ubc-sera-v2-left-brow",
      boneNames: ["Head", "head"],
      geometry: new THREE.BoxGeometry(0.028, 0.005, 0.009),
      material: dark,
      offset: [-0.019, 0.019, 0.067],
      rotation: [0.03, -0.03, -0.06],
      layer: "FACE",
    },
    {
      name: "ubc-sera-v2-right-brow",
      boneNames: ["Head", "head"],
      geometry: new THREE.BoxGeometry(0.028, 0.005, 0.009),
      material: dark,
      offset: [0.019, 0.019, 0.067],
      rotation: [0.03, 0.03, 0.06],
      layer: "FACE",
    },
    {
      name: "ubc-sera-v2-left-cheek-plane",
      boneNames: ["Head", "head"],
      geometry: bladeGeometry(0.014, 0.028, 0.007, -0.002),
      material: skin,
      offset: [-0.038, -0.007, 0.062],
      rotation: [-0.04, 0.18, -0.10],
      layer: "FACE",
    },
    {
      name: "ubc-sera-v2-right-cheek-plane",
      boneNames: ["Head", "head"],
      geometry: bladeGeometry(0.014, 0.028, 0.007, 0.002),
      material: skin,
      offset: [0.038, -0.007, 0.062],
      rotation: [-0.04, -0.18, 0.10],
      layer: "FACE",
    },
    {
      name: "ubc-sera-v2-collar-left",
      boneNames: ["spine_03"],
      geometry: bladeGeometry(0.054, 0.044, 0.018, -0.010),
      material: light,
      offset: [-0.036, 0.038, 0.066],
      rotation: [1.20, 0.03, -0.18],
      layer: "TORSO",
    },
    {
      name: "ubc-sera-v2-collar-right",
      boneNames: ["spine_03"],
      geometry: bladeGeometry(0.054, 0.044, 0.018, 0.010),
      material: light,
      offset: [0.036, 0.038, 0.066],
      rotation: [1.20, -0.03, 0.18],
      layer: "TORSO",
    },
    {
      name: "ubc-sera-v2-chest-prism",
      boneNames: ["spine_03", "spine_02"],
      geometry: new THREE.OctahedronGeometry(0.024, 0),
      material: accent,
      offset: [0, 0.006, 0.088],
      rotation: [0, 0, Math.PI * 0.25],
      scale: [0.80, 1.05, 0.46],
      layer: "TORSO",
    },
    {
      name: "ubc-sera-v2-left-shoulder-wing",
      boneNames: ["clavicle_l", "upperarm_l"],
      geometry: bladeGeometry(0.034, 0.064, 0.018, -0.009),
      material: light,
      offset: [-0.028, 0.005, 0.030],
      rotation: [0.16, 0.05, -1.02],
      layer: "ARM",
    },
    {
      name: "ubc-sera-v2-right-shoulder-wing",
      boneNames: ["clavicle_r", "upperarm_r"],
      geometry: bladeGeometry(0.031, 0.057, 0.017, 0.009),
      material: primary,
      offset: [0.028, 0.007, 0.030],
      rotation: [0.16, -0.05, 1.02],
      layer: "ARM",
    },
    {
      name: "ubc-sera-v2-left-waist-sash",
      boneNames: ["pelvis"],
      geometry: panelGeometry(0.038, 0.118, 0.012, 0.78, 1.0),
      material: primary,
      offset: [-0.073, 0.005, 0.033],
      rotation: [0.04, -0.44, -0.16],
      layer: "WAIST",
    },
    {
      name: "ubc-sera-v2-right-waist-tab",
      boneNames: ["pelvis"],
      geometry: panelGeometry(0.032, 0.068, 0.012, 0.82, 1.0),
      material: light,
      offset: [0.073, 0.030, 0.031],
      rotation: [0.02, 0.42, 0.12],
      layer: "WAIST",
    },
    {
      name: "ubc-sera-v2-left-thigh-panel",
      boneNames: ["thigh_l"],
      geometry: panelGeometry(0.042, 0.096, 0.012, 0.82, 1.0),
      material: primary,
      offset: [-0.023, -0.070, 0.043],
      rotation: [0, -0.11, -0.03],
      layer: "LEG",
    },
    {
      name: "ubc-sera-v2-right-thigh-panel",
      boneNames: ["thigh_r"],
      geometry: panelGeometry(0.042, 0.096, 0.012, 0.82, 1.0),
      material: light,
      offset: [0.023, -0.070, 0.043],
      rotation: [0, 0.11, 0.03],
      layer: "LEG",
    },
    {
      name: "ubc-sera-v2-left-toe-cap",
      boneNames: ["foot_l"],
      geometry: new THREE.BoxGeometry(0.064, 0.019, 0.056),
      material: primary,
      offset: [0, -0.008, 0.079],
      layer: "LEG",
    },
    {
      name: "ubc-sera-v2-right-toe-cap",
      boneNames: ["foot_r"],
      geometry: new THREE.BoxGeometry(0.064, 0.019, 0.056),
      material: accent,
      offset: [0, -0.008, 0.079],
      layer: "LEG",
    },
  ];

  return specs.map((spec) => addFollower(visual, host, spec)).filter((value): value is THREE.Mesh => Boolean(value));
}

function triangleCount(mesh: THREE.Mesh): number {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position");
  return geometry.index ? geometry.index.count / 3 : (position?.count ?? 0) / 3;
}

function installOnLoadedHost(visual: FighterVisual, definition: FighterDefinition): boolean {
  let host: THREE.Object3D | null = null;
  visual.root.traverse((object) => {
    if (!host && object.name.startsWith("quaternius-ubc-") && object.name.endsWith("-runtime")) host = object;
  });
  if (!host) return false;
  if (host.userData.characterGraphicsV2 === QUATERNIUS_CHARACTER_GRAPHICS_V2_ID) return true;

  const details = definition.archetype === "POWER"
    ? buildKairoV2(visual, host, definition)
    : buildSeraV2(visual, host, definition);

  visual.allMeshes.push(...details);
  const faceCount = details.filter((mesh) => mesh.userData.characterGraphicsV2Layer === "FACE").length;
  const hairCount = details.filter((mesh) => mesh.userData.characterGraphicsV2Layer === "HAIR").length;
  const triangleBudget = Math.round(details.reduce((sum, mesh) => sum + triangleCount(mesh), 0));

  host.userData.characterGraphicsV2 = QUATERNIUS_CHARACTER_GRAPHICS_V2_ID;
  visual.root.userData.quaterniusCharacterGraphicsV2 = QUATERNIUS_CHARACTER_GRAPHICS_V2_ID;
  visual.root.userData.quaterniusCharacterGraphicsV2DetailCount = details.length;
  visual.root.userData.quaterniusCharacterGraphicsV2FaceDetailCount = faceCount;
  visual.root.userData.quaterniusCharacterGraphicsV2HairDetailCount = hairCount;
  visual.root.userData.quaterniusCharacterGraphicsV2TriangleCount = triangleBudget;
  visual.root.userData.quaterniusCharacterGraphicsV2FollowerMode = "BIND_TO_ANIMATED_DELTA";
  visual.root.userData.quaterniusCharacterGraphicsV2Style = definition.archetype === "POWER"
    ? "KAIRO_FORGE_V2_FACE_FRAME_COLLAR_ARMORED_SILHOUETTE"
    : "SERA_PRISM_V2_FACE_FRAME_ASYMMETRIC_SASH_LAYERED_SILHOUETTE";
  return true;
}

export function scheduleQuaterniusCharacterGraphicsV2(visual: FighterVisual, definition: FighterDefinition): void {
  if (typeof window === "undefined") return;
  if (visual.root.userData.quaterniusCharacterGraphicsV2Scheduled) return;
  visual.root.userData.quaterniusCharacterGraphicsV2Scheduled = true;

  if (installOnLoadedHost(visual, definition)) return;
  let attempts = 0;
  const interval = window.setInterval(() => {
    attempts += 1;
    if (installOnLoadedHost(visual, definition) || attempts >= 160) {
      window.clearInterval(interval);
      visual.root.userData.quaterniusCharacterGraphicsV2Attempts = attempts;
    }
  }, 50);
}

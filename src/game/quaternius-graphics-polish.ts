import * as THREE from "three";
import type { FighterDefinition } from "./types";
import type { FighterVisual } from "./visual";

export const QUATERNIUS_GRAPHICS_POLISH_ID = "QUATERNIUS_HERO_KIT_V4_REFINED_SURFACE";

interface FollowerSpec {
  name: string;
  boneNames: readonly string[];
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Offset authored in fighter-root/model axes, not in the imported bone's bind axes. */
  offset: readonly [number, number, number];
  /** Rest orientation authored in fighter-root/model axes. */
  rotation?: readonly [number, number, number];
  scale?: readonly [number, number, number];
}

function bladeGeometry(width: number, height: number, depth: number, tipOffset = 0): THREE.BufferGeometry {
  const halfWidth = width * 0.5;
  const halfHeight = height * 0.5;
  const halfDepth = depth * 0.5;
  const positions = [
    -halfWidth, -halfHeight, -halfDepth,
    halfWidth, -halfHeight, -halfDepth,
    tipOffset, halfHeight, -halfDepth * 0.40,
    -halfWidth, -halfHeight, halfDepth,
    halfWidth, -halfHeight, halfDepth,
    tipOffset, halfHeight, halfDepth * 0.40,
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

function heroMaterial(color: THREE.ColorRepresentation, metalness: number, roughness: number): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    metalness,
    roughness,
  });
  material.envMapIntensity = metalness > 0.2 ? 1.36 : 1.12;
  material.dithering = true;
  return material;
}

function polishImportedMaterials(host: THREE.Object3D, definition: FighterDefinition): void {
  const skin = new THREE.Color(definition.colors.skin);
  const hair = new THREE.Color(definition.colors.hair);
  const secondary = new THREE.Color(definition.colors.secondary);
  const accent = new THREE.Color(definition.colors.accent);
  const paleArmor = new THREE.Color(0xeaf2fb).lerp(new THREE.Color(definition.colors.primary), 0.16);

  host.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => {
      if (!(material instanceof THREE.MeshStandardMaterial)) return;
      const tag = `${mesh.name} ${material.name}`.toLowerCase();
      material.flatShading = true;
      material.roughness = tag.includes("metal") || tag.includes("armor") ? 0.34 : 0.56;
      material.metalness = tag.includes("metal") || tag.includes("armor") ? 0.34 : 0.065;
      material.envMapIntensity = tag.includes("metal") || tag.includes("armor") ? 1.34 : 1.16;
      material.dithering = true;

      if (tag.includes("hair")) material.color.copy(hair);
      else if (tag.includes("skin") || tag.includes("face")) material.color.copy(skin);
      else if (tag.includes("eye")) material.color.copy(paleArmor).lerp(accent, 0.18);
      else if (tag.includes("boot") || tag.includes("glove") || tag.includes("dark") || tag.includes("black")) material.color.copy(secondary);
      else if (tag.includes("metal") || tag.includes("armor")) material.color.copy(paleArmor);
      else {
        const hsl = { h: 0, s: 0, l: 0 };
        material.color.getHSL(hsl);
        if (hsl.l < 0.23) material.color.lerp(secondary, 0.34);
        else if (hsl.l > 0.74 && hsl.s < 0.22) material.color.lerp(paleArmor, 0.24);
        else material.color.offsetHSL(0, 0.06, hsl.l < 0.46 ? -0.035 : 0.02);
      }
      material.needsUpdate = true;
    });
  });
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

/**
 * Imported UBC bones contain non-trivial bind rotations. Hero parts are authored
 * in POLY FIGHTER's canonical root axes, so following the absolute bone rotation
 * would apply that bind rotation a second time. Capture the bind pose once and
 * follow only the bind->animated delta thereafter.
 */
function addBoneFollower(visual: FighterVisual, host: THREE.Object3D, spec: FollowerSpec): THREE.Mesh | null {
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
  mesh.userData.characterGraphicsDetail = QUATERNIUS_GRAPHICS_POLISH_ID;
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

function buildKairoKit(visual: FighterVisual, host: THREE.Object3D, definition: FighterDefinition): THREE.Mesh[] {
  const hair = heroMaterial(definition.colors.hair, 0.03, 0.31);
  const primary = heroMaterial(definition.colors.primary, 0.18, 0.37);
  const accent = heroMaterial(definition.colors.accent, 0.22, 0.34);
  const metal = heroMaterial(new THREE.Color(0xe8eef4).lerp(new THREE.Color(definition.colors.primary), 0.18), 0.44, 0.28);
  const dark = heroMaterial(definition.colors.secondary, 0.10, 0.46);
  const specs: FollowerSpec[] = [
    {
      name: "ubc-kairo-hair-cap",
      boneNames: ["Head", "head"],
      geometry: new THREE.IcosahedronGeometry(0.082, 1),
      material: hair,
      offset: [0, 0.054, -0.008],
      scale: [0.78, 0.58, 0.80],
    },
    {
      name: "ubc-kairo-hair-crest",
      boneNames: ["Head", "head"],
      geometry: bladeGeometry(0.050, 0.070, 0.038, 0.006),
      material: hair,
      offset: [0.004, 0.082, -0.046],
      rotation: [0.92, -0.05, 0.06],
    },
    {
      name: "ubc-kairo-fringe-left",
      boneNames: ["Head", "head"],
      geometry: bladeGeometry(0.024, 0.060, 0.022, -0.005),
      material: hair,
      offset: [-0.024, 0.068, 0.050],
      rotation: [-0.12, 0.04, -0.20],
    },
    {
      name: "ubc-kairo-fringe-right",
      boneNames: ["Head", "head"],
      geometry: bladeGeometry(0.022, 0.057, 0.022, 0.004),
      material: hair,
      offset: [0.023, 0.069, 0.049],
      rotation: [-0.12, -0.04, 0.18],
    },
    {
      name: "ubc-kairo-torso-core",
      boneNames: ["spine_03", "spine_02", "spine_01"],
      geometry: bladeGeometry(0.118, 0.118, 0.024, 0),
      material: dark,
      offset: [0, -0.014, 0.064],
      rotation: [0, 0, Math.PI],
    },
    {
      name: "ubc-kairo-forge-chest-left",
      boneNames: ["spine_03", "spine_02", "spine_01"],
      geometry: bladeGeometry(0.058, 0.092, 0.024, -0.010),
      material: primary,
      offset: [-0.034, -0.012, 0.077],
      rotation: [-0.04, 0, -0.14],
    },
    {
      name: "ubc-kairo-forge-chest-right",
      boneNames: ["spine_03", "spine_02", "spine_01"],
      geometry: bladeGeometry(0.055, 0.086, 0.023, 0.009),
      material: accent,
      offset: [0.032, -0.016, 0.077],
      rotation: [-0.04, 0, 0.13],
    },
    {
      name: "ubc-kairo-left-shoulder-plate",
      boneNames: ["clavicle_l", "upperarm_l"],
      geometry: new THREE.OctahedronGeometry(0.052, 0),
      material: metal,
      offset: [-0.026, -0.014, 0.016],
      rotation: [0, 0, -0.08],
      scale: [1.14, 0.50, 0.86],
    },
    {
      name: "ubc-kairo-right-shoulder-plate",
      boneNames: ["clavicle_r", "upperarm_r"],
      geometry: new THREE.OctahedronGeometry(0.050, 0),
      material: metal,
      offset: [0.025, -0.014, 0.016],
      rotation: [0, 0, 0.08],
      scale: [1.10, 0.49, 0.84],
    },
    {
      name: "ubc-kairo-left-gauntlet",
      boneNames: ["lowerarm_l", "forearm_l"],
      geometry: new THREE.CylinderGeometry(0.034, 0.040, 0.094, 6, 1),
      material: primary,
      offset: [0, -0.048, 0.008],
      scale: [1.0, 1.0, 0.84],
    },
    {
      name: "ubc-kairo-right-gauntlet",
      boneNames: ["lowerarm_r", "forearm_r"],
      geometry: new THREE.CylinderGeometry(0.034, 0.040, 0.094, 6, 1),
      material: accent,
      offset: [0, -0.048, 0.008],
      scale: [1.0, 1.0, 0.84],
    },
    {
      name: "ubc-kairo-left-shin-guard",
      boneNames: ["calf_l"],
      geometry: new THREE.CylinderGeometry(0.034, 0.041, 0.108, 6, 1),
      material: primary,
      offset: [0, -0.054, 0.010],
      scale: [1.0, 1.0, 0.84],
    },
    {
      name: "ubc-kairo-right-shin-guard",
      boneNames: ["calf_r"],
      geometry: new THREE.CylinderGeometry(0.033, 0.040, 0.106, 6, 1),
      material: accent,
      offset: [0, -0.053, 0.010],
      scale: [1.0, 1.0, 0.84],
    },
    {
      name: "ubc-kairo-belt-core",
      boneNames: ["pelvis"],
      geometry: new THREE.OctahedronGeometry(0.034, 0),
      material: dark,
      offset: [0, 0.080, 0.058],
      rotation: [0, 0, Math.PI * 0.25],
      scale: [1.04, 0.68, 0.40],
    },
  ];
  return specs.map((spec) => addBoneFollower(visual, host, spec)).filter((value): value is THREE.Mesh => Boolean(value));
}

function buildSeraKit(visual: FighterVisual, host: THREE.Object3D, definition: FighterDefinition): THREE.Mesh[] {
  const hair = heroMaterial(definition.colors.hair, 0.025, 0.30);
  const primary = heroMaterial(definition.colors.primary, 0.16, 0.39);
  const accent = heroMaterial(definition.colors.accent, 0.20, 0.36);
  const metal = heroMaterial(new THREE.Color(0xeaf3ff).lerp(new THREE.Color(definition.colors.primary), 0.14), 0.40, 0.30);
  const specs: FollowerSpec[] = [
    {
      name: "ubc-sera-hair-cap",
      boneNames: ["Head", "head"],
      geometry: new THREE.IcosahedronGeometry(0.078, 1),
      material: hair,
      offset: [0, 0.052, -0.008],
      scale: [0.76, 0.58, 0.80],
    },
    {
      name: "ubc-sera-fringe",
      boneNames: ["Head", "head"],
      geometry: bladeGeometry(0.030, 0.068, 0.024, 0.005),
      material: hair,
      offset: [-0.006, 0.071, 0.050],
      rotation: [-0.13, 0.02, -0.10],
    },
    {
      name: "ubc-sera-ponytail-upper",
      boneNames: ["Head", "head"],
      geometry: bladeGeometry(0.030, 0.120, 0.026, 0.004),
      material: hair,
      offset: [0.003, 0.044, -0.086],
      rotation: [0.62, 0.02, 0.02],
    },
    {
      name: "ubc-sera-ponytail-lower",
      boneNames: ["Head", "head"],
      geometry: bladeGeometry(0.025, 0.130, 0.022, -0.003),
      material: hair,
      offset: [0.006, -0.012, -0.124],
      rotation: [0.76, -0.04, -0.04],
    },
    {
      name: "ubc-sera-prism-collar",
      boneNames: ["spine_03", "spine_02", "spine_01"],
      geometry: bladeGeometry(0.116, 0.052, 0.026, 0),
      material: metal,
      offset: [0, 0.032, 0.054],
      rotation: [Math.PI * 0.5, 0, 0],
    },
    {
      name: "ubc-sera-left-forearm-guard",
      boneNames: ["lowerarm_l", "forearm_l"],
      geometry: new THREE.CylinderGeometry(0.030, 0.036, 0.090, 6, 1),
      material: primary,
      offset: [0, -0.047, 0.008],
      scale: [1.0, 1.0, 0.84],
    },
    {
      name: "ubc-sera-right-forearm-guard",
      boneNames: ["lowerarm_r", "forearm_r"],
      geometry: new THREE.CylinderGeometry(0.030, 0.036, 0.090, 6, 1),
      material: primary,
      offset: [0, -0.047, 0.008],
      scale: [1.0, 1.0, 0.84],
    },
    {
      name: "ubc-sera-left-shin-guard",
      boneNames: ["calf_l"],
      geometry: new THREE.CylinderGeometry(0.029, 0.035, 0.102, 6, 1),
      material: primary,
      offset: [0, -0.051, 0.009],
      scale: [1.0, 1.0, 0.84],
    },
    {
      name: "ubc-sera-right-shin-guard",
      boneNames: ["calf_r"],
      geometry: new THREE.CylinderGeometry(0.029, 0.035, 0.102, 6, 1),
      material: accent,
      offset: [0, -0.051, 0.009],
      scale: [1.0, 1.0, 0.84],
    },
  ];
  return specs.map((spec) => addBoneFollower(visual, host, spec)).filter((value): value is THREE.Mesh => Boolean(value));
}

function installOnLoadedHost(visual: FighterVisual, definition: FighterDefinition): boolean {
  let host: THREE.Object3D | null = null;
  visual.root.traverse((object) => {
    if (!host && object.name.startsWith("quaternius-ubc-") && object.name.endsWith("-runtime")) host = object;
  });
  if (!host) return false;
  if (host.userData.characterGraphicsPolish === QUATERNIUS_GRAPHICS_POLISH_ID) return true;

  polishImportedMaterials(host, definition);
  const details = definition.archetype === "POWER"
    ? buildKairoKit(visual, host, definition)
    : buildSeraKit(visual, host, definition);
  visual.allMeshes.push(...details);
  host.userData.characterGraphicsPolish = QUATERNIUS_GRAPHICS_POLISH_ID;
  visual.root.userData.quaterniusGraphicsPolish = QUATERNIUS_GRAPHICS_POLISH_ID;
  visual.root.userData.quaterniusHeroDetailCount = details.length;
  visual.root.userData.quaterniusFollowerMode = "BIND_TO_ANIMATED_DELTA";
  return true;
}

export function scheduleQuaterniusGraphicsPolish(visual: FighterVisual, definition: FighterDefinition): void {
  if (typeof window === "undefined") return;
  if (visual.root.userData.quaterniusGraphicsPolishScheduled) return;
  visual.root.userData.quaterniusGraphicsPolishScheduled = true;

  if (installOnLoadedHost(visual, definition)) return;
  let attempts = 0;
  const interval = window.setInterval(() => {
    attempts += 1;
    if (installOnLoadedHost(visual, definition) || attempts >= 160) {
      window.clearInterval(interval);
      visual.root.userData.quaterniusGraphicsPolishAttempts = attempts;
    }
  }, 50);
}

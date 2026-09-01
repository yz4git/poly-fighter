import * as THREE from "three";
import type { FighterDefinition } from "./types";
import type { FighterVisual } from "./visual";

export const QUATERNIUS_GRAPHICS_POLISH_ID = "QUATERNIUS_HERO_KIT_V5_FITTED_OUTFIT";

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

/** A shallow trapezoid prism: wide enough to read as cloth, thin enough to preserve the body silhouette. */
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

/** Compact faceted glove volume that guarantees a readable fist silhouette. */
function fistGeometry(width: number, height: number, depth: number): THREE.BufferGeometry {
  const geometry = new THREE.DodecahedronGeometry(0.5, 0);
  geometry.scale(width, height, depth);
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

function clothMaterial(color: THREE.ColorRepresentation, roughness = 0.62): THREE.MeshStandardMaterial {
  const material = heroMaterial(color, 0.035, roughness);
  material.envMapIntensity = 1.08;
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
 * Imported UBC bones contain non-trivial bind rotations. Outfit panels are authored
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
  if (spec.name.includes("outfit")) mesh.userData.outfitLayer = "FITTED_SURFACE_PANEL";
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
  const clothLight = clothMaterial(new THREE.Color(0xf2f3f1).lerp(new THREE.Color(definition.colors.primary), 0.08), 0.58);
  const clothPrimary = clothMaterial(new THREE.Color(definition.colors.primary), 0.55);
  const clothDark = clothMaterial(new THREE.Color(definition.colors.secondary).lerp(new THREE.Color(0x20242d), 0.18), 0.67);
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
      name: "ubc-kairo-outfit-jacket-left",
      boneNames: ["spine_03"],
      geometry: panelGeometry(0.086, 0.145, 0.014, 0.84, 1.0),
      material: clothLight,
      offset: [-0.052, -0.018, 0.055],
      rotation: [-0.035, -0.04, -0.045],
    },
    {
      name: "ubc-kairo-outfit-jacket-right",
      boneNames: ["spine_03"],
      geometry: panelGeometry(0.086, 0.145, 0.014, 0.84, 1.0),
      material: clothLight,
      offset: [0.052, -0.018, 0.055],
      rotation: [-0.035, 0.04, 0.045],
    },
    {
      name: "ubc-kairo-outfit-abdomen",
      boneNames: ["spine_02", "spine_01"],
      geometry: panelGeometry(0.128, 0.120, 0.014, 1.0, 0.82),
      material: clothPrimary,
      offset: [0, -0.047, 0.052],
    },
    {
      name: "ubc-kairo-outfit-back-jacket",
      boneNames: ["spine_03"],
      geometry: panelGeometry(0.150, 0.132, 0.012, 0.88, 1.0),
      material: clothDark,
      offset: [0, -0.020, -0.052],
      rotation: [0, Math.PI, 0],
    },
    {
      name: "ubc-kairo-outfit-belt",
      boneNames: ["pelvis"],
      geometry: new THREE.BoxGeometry(0.176, 0.030, 0.070),
      material: clothDark,
      offset: [0, 0.078, 0.004],
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
      name: "ubc-kairo-left-fist",
      boneNames: ["hand_l"],
      geometry: fistGeometry(0.062, 0.050, 0.072),
      material: dark,
      offset: [0, -0.012, 0.030],
      rotation: [-0.05, 0.02, -0.03],
    },
    {
      name: "ubc-kairo-right-fist",
      boneNames: ["hand_r"],
      geometry: fistGeometry(0.062, 0.050, 0.072),
      material: dark,
      offset: [0, -0.012, 0.030],
      rotation: [-0.05, -0.02, 0.03],
    },
    {
      name: "ubc-kairo-outfit-left-trouser",
      boneNames: ["thigh_l"],
      geometry: panelGeometry(0.086, 0.205, 0.016, 1.0, 0.82),
      material: clothDark,
      offset: [0, -0.110, 0.034],
    },
    {
      name: "ubc-kairo-outfit-right-trouser",
      boneNames: ["thigh_r"],
      geometry: panelGeometry(0.086, 0.205, 0.016, 1.0, 0.82),
      material: clothDark,
      offset: [0, -0.110, 0.034],
    },
    {
      name: "ubc-kairo-outfit-left-trouser-stripe",
      boneNames: ["thigh_l"],
      geometry: panelGeometry(0.026, 0.188, 0.012, 0.9, 1.0),
      material: clothPrimary,
      offset: [-0.040, -0.108, 0.027],
      rotation: [0, -0.20, -0.02],
    },
    {
      name: "ubc-kairo-outfit-right-trouser-stripe",
      boneNames: ["thigh_r"],
      geometry: panelGeometry(0.026, 0.188, 0.012, 0.9, 1.0),
      material: clothPrimary,
      offset: [0.040, -0.108, 0.027],
      rotation: [0, 0.20, 0.02],
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
      name: "ubc-kairo-outfit-left-boot-shaft",
      boneNames: ["calf_l"],
      geometry: panelGeometry(0.070, 0.155, 0.015, 0.90, 1.0),
      material: clothDark,
      offset: [0, -0.086, 0.031],
    },
    {
      name: "ubc-kairo-outfit-right-boot-shaft",
      boneNames: ["calf_r"],
      geometry: panelGeometry(0.070, 0.155, 0.015, 0.90, 1.0),
      material: clothDark,
      offset: [0, -0.086, 0.031],
    },
    {
      name: "ubc-kairo-outfit-left-shoe",
      boneNames: ["foot_l"],
      geometry: new THREE.BoxGeometry(0.075, 0.025, 0.118),
      material: clothDark,
      offset: [0, -0.012, 0.045],
    },
    {
      name: "ubc-kairo-outfit-right-shoe",
      boneNames: ["foot_r"],
      geometry: new THREE.BoxGeometry(0.075, 0.025, 0.118),
      material: clothDark,
      offset: [0, -0.012, 0.045],
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
  const clothLight = clothMaterial(new THREE.Color(0xf2f7fb).lerp(new THREE.Color(definition.colors.primary), 0.11), 0.59);
  const clothPrimary = clothMaterial(new THREE.Color(definition.colors.primary), 0.55);
  const clothDark = clothMaterial(new THREE.Color(definition.colors.secondary).lerp(new THREE.Color(0x1c2430), 0.20), 0.68);
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
      name: "ubc-sera-outfit-jacket-left",
      boneNames: ["spine_03"],
      geometry: panelGeometry(0.072, 0.112, 0.013, 0.78, 1.0),
      material: clothLight,
      offset: [-0.044, -0.012, 0.054],
      rotation: [-0.03, -0.03, -0.05],
    },
    {
      name: "ubc-sera-outfit-jacket-right",
      boneNames: ["spine_03"],
      geometry: panelGeometry(0.072, 0.112, 0.013, 0.78, 1.0),
      material: clothLight,
      offset: [0.044, -0.012, 0.054],
      rotation: [-0.03, 0.03, 0.05],
    },
    {
      name: "ubc-sera-outfit-bodysuit",
      boneNames: ["spine_02", "spine_01"],
      geometry: panelGeometry(0.112, 0.145, 0.013, 0.92, 0.76),
      material: clothDark,
      offset: [0, -0.047, 0.049],
    },
    {
      name: "ubc-sera-outfit-back",
      boneNames: ["spine_02", "spine_03"],
      geometry: panelGeometry(0.124, 0.130, 0.012, 0.88, 1.0),
      material: clothDark,
      offset: [0, -0.030, -0.047],
      rotation: [0, Math.PI, 0],
    },
    {
      name: "ubc-sera-outfit-waist",
      boneNames: ["pelvis"],
      geometry: new THREE.BoxGeometry(0.160, 0.037, 0.066),
      material: clothPrimary,
      offset: [0, 0.067, 0.005],
    },
    {
      name: "ubc-sera-outfit-left-hip",
      boneNames: ["pelvis"],
      geometry: panelGeometry(0.052, 0.082, 0.013, 0.88, 1.0),
      material: clothPrimary,
      offset: [-0.068, 0.025, 0.032],
      rotation: [0, -0.40, -0.10],
    },
    {
      name: "ubc-sera-outfit-right-hip",
      boneNames: ["pelvis"],
      geometry: panelGeometry(0.052, 0.082, 0.013, 0.88, 1.0),
      material: clothPrimary,
      offset: [0.068, 0.025, 0.032],
      rotation: [0, 0.40, 0.10],
    },
    {
      name: "ubc-sera-left-fist",
      boneNames: ["hand_l"],
      geometry: fistGeometry(0.055, 0.045, 0.066),
      material: clothDark,
      offset: [0, -0.011, 0.027],
      rotation: [-0.04, 0.02, -0.025],
    },
    {
      name: "ubc-sera-right-fist",
      boneNames: ["hand_r"],
      geometry: fistGeometry(0.055, 0.045, 0.066),
      material: clothDark,
      offset: [0, -0.011, 0.027],
      rotation: [-0.04, -0.02, 0.025],
    },
    {
      name: "ubc-sera-outfit-left-legging",
      boneNames: ["thigh_l"],
      geometry: panelGeometry(0.075, 0.205, 0.015, 1.0, 0.78),
      material: clothDark,
      offset: [0, -0.110, 0.032],
    },
    {
      name: "ubc-sera-outfit-right-legging",
      boneNames: ["thigh_r"],
      geometry: panelGeometry(0.075, 0.205, 0.015, 1.0, 0.78),
      material: clothDark,
      offset: [0, -0.110, 0.032],
    },
    {
      name: "ubc-sera-outfit-left-leg-stripe",
      boneNames: ["thigh_l"],
      geometry: panelGeometry(0.021, 0.185, 0.010, 0.92, 1.0),
      material: clothPrimary,
      offset: [-0.034, -0.108, 0.026],
      rotation: [0, -0.18, -0.01],
    },
    {
      name: "ubc-sera-outfit-right-leg-stripe",
      boneNames: ["thigh_r"],
      geometry: panelGeometry(0.021, 0.185, 0.010, 0.92, 1.0),
      material: clothPrimary,
      offset: [0.034, -0.108, 0.026],
      rotation: [0, 0.18, 0.01],
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
    {
      name: "ubc-sera-outfit-left-boot",
      boneNames: ["calf_l"],
      geometry: panelGeometry(0.064, 0.148, 0.014, 0.90, 1.0),
      material: clothLight,
      offset: [0, -0.083, 0.029],
    },
    {
      name: "ubc-sera-outfit-right-boot",
      boneNames: ["calf_r"],
      geometry: panelGeometry(0.064, 0.148, 0.014, 0.90, 1.0),
      material: clothLight,
      offset: [0, -0.083, 0.029],
    },
    {
      name: "ubc-sera-outfit-left-shoe",
      boneNames: ["foot_l"],
      geometry: new THREE.BoxGeometry(0.068, 0.023, 0.112),
      material: clothPrimary,
      offset: [0, -0.011, 0.043],
    },
    {
      name: "ubc-sera-outfit-right-shoe",
      boneNames: ["foot_r"],
      geometry: new THREE.BoxGeometry(0.068, 0.023, 0.112),
      material: clothPrimary,
      offset: [0, -0.011, 0.043],
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
  const outfitParts = details.filter((mesh) => mesh.name.includes("outfit"));
  visual.allMeshes.push(...details);
  host.userData.characterGraphicsPolish = QUATERNIUS_GRAPHICS_POLISH_ID;
  visual.root.userData.quaterniusGraphicsPolish = QUATERNIUS_GRAPHICS_POLISH_ID;
  visual.root.userData.quaterniusHeroDetailCount = details.length;
  visual.root.userData.quaterniusOutfitPartCount = outfitParts.length;
  visual.root.userData.quaterniusOutfitStyle = definition.archetype === "POWER"
    ? "KAIRO_FITTED_JACKET_TROUSERS_BOOTS"
    : "SERA_CROPPED_JACKET_BODYSUIT_LEGGINGS_BOOTS";
  visual.root.userData.quaterniusOutfitConstruction = "THIN_CONFORMING_BIND_DELTA_PANELS";
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

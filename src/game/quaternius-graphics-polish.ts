import * as THREE from "three";
import type { FighterDefinition } from "./types";
import type { FighterVisual } from "./visual";

export const QUATERNIUS_GRAPHICS_POLISH_ID = "QUATERNIUS_HERO_KIT_V1";

interface FollowerSpec {
  name: string;
  boneNames: readonly string[];
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  offset: readonly [number, number, number];
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
  if (spec.scale) mesh.scale.set(spec.scale[0], spec.scale[1], spec.scale[2]);
  visual.root.add(mesh);

  const worldPosition = new THREE.Vector3();
  const localPosition = new THREE.Vector3();
  const rootWorldQuaternion = new THREE.Quaternion();
  const boneWorldQuaternion = new THREE.Quaternion();
  const localQuaternion = new THREE.Quaternion();
  const offset = new THREE.Vector3(spec.offset[0], spec.offset[1], spec.offset[2]);
  const rotatedOffset = new THREE.Vector3();
  const extraRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    spec.rotation?.[0] ?? 0,
    spec.rotation?.[1] ?? 0,
    spec.rotation?.[2] ?? 0,
  ));

  const sync = (): void => {
    visual.root.updateWorldMatrix(true, false);
    bone.updateWorldMatrix(true, false);
    bone.getWorldPosition(worldPosition);
    localPosition.copy(worldPosition);
    visual.root.worldToLocal(localPosition);
    visual.root.getWorldQuaternion(rootWorldQuaternion);
    bone.getWorldQuaternion(boneWorldQuaternion);
    localQuaternion.copy(rootWorldQuaternion).invert().multiply(boneWorldQuaternion);
    rotatedOffset.copy(offset).applyQuaternion(localQuaternion);
    mesh.position.copy(localPosition).add(rotatedOffset);
    mesh.quaternion.copy(localQuaternion).multiply(extraRotation);
  };

  sync();
  mesh.onBeforeRender = sync;
  return mesh;
}

function buildKairoKit(visual: FighterVisual, host: THREE.Object3D, definition: FighterDefinition): THREE.Mesh[] {
  const hair = heroMaterial(definition.colors.hair, 0.03, 0.32);
  const primary = heroMaterial(definition.colors.primary, 0.18, 0.38);
  const metal = heroMaterial(new THREE.Color(0xe8eef4).lerp(new THREE.Color(definition.colors.primary), 0.18), 0.44, 0.28);
  const dark = heroMaterial(definition.colors.secondary, 0.10, 0.46);
  const specs: FollowerSpec[] = [
    {
      name: "ubc-kairo-hair-cap",
      boneNames: ["head"],
      geometry: new THREE.IcosahedronGeometry(0.085, 1),
      material: hair,
      offset: [0, 0.055, -0.010],
      scale: [0.80, 0.64, 0.84],
    },
    {
      name: "ubc-kairo-hair-crest",
      boneNames: ["head"],
      geometry: bladeGeometry(0.052, 0.112, 0.060, 0.008),
      material: hair,
      offset: [0.004, 0.098, -0.010],
      rotation: [0.12, -0.04, 0.05],
    },
    {
      name: "ubc-kairo-forge-chest",
      boneNames: ["spine_03", "spine_02", "spine_01"],
      geometry: new THREE.BoxGeometry(0.205, 0.150, 0.092),
      material: primary,
      offset: [0, -0.018, 0.018],
      scale: [1.0, 1.0, 0.72],
    },
    {
      name: "ubc-kairo-left-shoulder-plate",
      boneNames: ["clavicle_l", "upperarm_l"],
      geometry: new THREE.OctahedronGeometry(0.070, 0),
      material: metal,
      offset: [-0.006, -0.006, 0.004],
      scale: [1.26, 0.62, 1.06],
    },
    {
      name: "ubc-kairo-right-shoulder-plate",
      boneNames: ["clavicle_r", "upperarm_r"],
      geometry: new THREE.OctahedronGeometry(0.066, 0),
      material: metal,
      offset: [0.006, -0.006, 0.004],
      scale: [1.18, 0.60, 1.02],
    },
    {
      name: "ubc-kairo-belt-core",
      boneNames: ["pelvis"],
      geometry: new THREE.OctahedronGeometry(0.046, 0),
      material: dark,
      offset: [0, 0.092, 0.060],
      rotation: [0, 0, Math.PI * 0.25],
      scale: [1.18, 0.78, 0.50],
    },
  ];
  return specs.map((spec) => addBoneFollower(visual, host, spec)).filter((value): value is THREE.Mesh => Boolean(value));
}

function buildSeraKit(visual: FighterVisual, host: THREE.Object3D, definition: FighterDefinition): THREE.Mesh[] {
  const hair = heroMaterial(definition.colors.hair, 0.025, 0.31);
  const primary = heroMaterial(definition.colors.primary, 0.16, 0.40);
  const metal = heroMaterial(new THREE.Color(0xeaf3ff).lerp(new THREE.Color(definition.colors.primary), 0.14), 0.40, 0.30);
  const specs: FollowerSpec[] = [
    {
      name: "ubc-sera-hair-cap",
      boneNames: ["head"],
      geometry: new THREE.IcosahedronGeometry(0.082, 1),
      material: hair,
      offset: [0, 0.052, -0.010],
      scale: [0.78, 0.64, 0.84],
    },
    {
      name: "ubc-sera-ponytail-upper",
      boneNames: ["head"],
      geometry: bladeGeometry(0.050, 0.168, 0.052, 0.006),
      material: hair,
      offset: [0, 0.070, -0.108],
      rotation: [1.18, 0.02, 0.02],
    },
    {
      name: "ubc-sera-ponytail-lower",
      boneNames: ["head"],
      geometry: bladeGeometry(0.042, 0.185, 0.045, -0.004),
      material: hair,
      offset: [0.008, 0.018, -0.190],
      rotation: [1.34, -0.04, -0.04],
    },
    {
      name: "ubc-sera-prism-collar",
      boneNames: ["spine_03", "spine_02", "spine_01"],
      geometry: new THREE.BoxGeometry(0.170, 0.082, 0.078),
      material: metal,
      offset: [0, 0.026, 0.014],
      scale: [1.0, 0.80, 0.74],
    },
    {
      name: "ubc-sera-left-forearm-guard",
      boneNames: ["forearm_l"],
      geometry: new THREE.CylinderGeometry(0.043, 0.050, 0.118, 6, 1),
      material: primary,
      offset: [0, -0.048, 0.004],
      scale: [1.0, 1.0, 0.86],
    },
    {
      name: "ubc-sera-right-forearm-guard",
      boneNames: ["forearm_r"],
      geometry: new THREE.CylinderGeometry(0.043, 0.050, 0.118, 6, 1),
      material: primary,
      offset: [0, -0.048, 0.004],
      scale: [1.0, 1.0, 0.86],
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

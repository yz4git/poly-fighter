import * as THREE from "three";
import type { FighterDefinition } from "./types";
import type { ClothingAttachment, FighterVisual } from "./visual";

export const CHARACTER_GRAPHICS_POLISH_ID = "CHARACTER_GRAPHICS_POLISH_V1";

interface CharacterGraphicsPolishOptions {
  addKairoDetails?: boolean;
}

interface MaterialTuning {
  roughness?: number;
  metalness?: number;
  envMapIntensity?: number;
}

function standardMaterials(material: THREE.Material | THREE.Material[]): THREE.MeshStandardMaterial[] {
  const values = Array.isArray(material) ? material : [material];
  return values.filter((value): value is THREE.MeshStandardMaterial => value instanceof THREE.MeshStandardMaterial);
}

function tuneStandardMaterial(material: THREE.MeshStandardMaterial, tuning: MaterialTuning): void {
  if (tuning.roughness !== undefined) material.roughness = tuning.roughness;
  if (tuning.metalness !== undefined) material.metalness = tuning.metalness;
  if (tuning.envMapIntensity !== undefined) material.envMapIntensity = tuning.envMapIntensity;
  material.dithering = true;
  material.needsUpdate = true;
}

function tuneKairoBodyMaterials(visual: FighterVisual): void {
  const materials = Array.isArray(visual.bodyMesh.material)
    ? visual.bodyMesh.material
    : [visual.bodyMesh.material];
  const tuning: MaterialTuning[] = [
    { roughness: 0.43, metalness: 0.10, envMapIntensity: 1.24 },
    { roughness: 0.56, metalness: 0.07, envMapIntensity: 1.16 },
    { roughness: 0.41, metalness: 0.14, envMapIntensity: 1.28 },
    { roughness: 0.66, metalness: 0.00, envMapIntensity: 0.92 },
    { roughness: 0.34, metalness: 0.025, envMapIntensity: 1.02 },
    { roughness: 0.42, metalness: 0.00, envMapIntensity: 1.08 },
    { roughness: 0.68, metalness: 0.00, envMapIntensity: 0.86 },
    { roughness: 0.28, metalness: 0.48, envMapIntensity: 1.42 },
  ];
  materials.forEach((material, index) => {
    if (!(material instanceof THREE.MeshStandardMaterial)) return;
    tuneStandardMaterial(material, tuning[index] ?? { envMapIntensity: 1.16 });
  });
}

function tuneSeraMaterials(visual: FighterVisual): void {
  visual.root.traverse((object) => {
    const candidate = object as THREE.Mesh;
    if (!candidate.isMesh) return;
    for (const material of standardMaterials(candidate.material)) {
      if (material.vertexColors) {
        tuneStandardMaterial(material, {
          roughness: 0.60,
          metalness: 0.028,
          envMapIntensity: 1.18,
        });
      } else {
        tuneStandardMaterial(material, {
          roughness: Math.min(material.roughness, 0.66),
          metalness: Math.min(material.metalness, 0.12),
          envMapIntensity: 1.10,
        });
      }
    }
  });
}

function tuneKairoNamedMaterials(visual: FighterVisual): void {
  visual.root.traverse((object) => {
    const candidate = object as THREE.Mesh;
    if (!candidate.isMesh) return;
    const name = candidate.name.toLowerCase();
    for (const material of standardMaterials(candidate.material)) {
      if (name.includes("hair")) {
        tuneStandardMaterial(material, { roughness: 0.34, metalness: 0.025, envMapIntensity: 1.02 });
      } else if (name.includes("eye") || name.includes("iris")) {
        tuneStandardMaterial(material, { roughness: 0.40, metalness: 0, envMapIntensity: 1.12 });
      } else if (name.includes("metal") || name.includes("knuckle") || name.includes("clavicle")) {
        tuneStandardMaterial(material, { roughness: 0.28, metalness: 0.48, envMapIntensity: 1.42 });
      }
    }
  });
}

function refineKairoExistingForms(visual: FighterVisual): void {
  const transform = (
    name: string,
    scale: readonly [number, number, number],
    offset: readonly [number, number, number] = [0, 0, 0],
  ): void => {
    const object = visual.root.getObjectByName(name);
    if (!(object instanceof THREE.Mesh)) return;
    object.scale.multiply(new THREE.Vector3(scale[0], scale[1], scale[2]));
    object.position.add(new THREE.Vector3(offset[0], offset[1], offset[2]));
  };

  transform("kairo-v1-hair-crown", [1.07, 1.06, 1.09], [0, 0.002, -0.002]);
  for (let index = 0; index < 7; index += 1) {
    transform(`kairo-v1-hair-blade-${index}`, [1.03, 1.07, 1.05]);
  }
  for (const side of ["left", "right"] as const) {
    transform(`kairo-v1-${side}-brow`, [1.06, 0.68, 0.88], [0, 0.0025, 0.002]);
    transform(`kairo-v1-${side}-eye`, [1.10, 0.86, 0.92], [0, 0, 0.0025]);
    transform(`kairo-v1-${side}-iris`, [1.13, 1.08, 0.88], [0, 0, 0.003]);
    transform(`kairo-v1-${side}-cheek-plane`, [0.90, 1.05, 0.88], [0, -0.001, -0.001]);
    transform(`kairo-v1-${side}-shoulder-armor`, [1.04, 0.98, 1.04], [0, 0.001, 0.002]);
    transform(`kairo-v1-${side}-forge-gauntlet`, [1.02, 1.01, 1.04], [0, 0, 0.002]);
    transform(`kairo-v1-${side}-shin-armor`, [1.01, 1.02, 1.04], [0, 0, 0.002]);
  }
  transform("kairo-v1-nose-bridge", [0.88, 1.02, 0.92], [0, 0, 0.0015]);
  transform("kairo-v1-mouth", [0.91, 0.72, 0.90], [0, -0.0005, 0.0015]);
  transform("kairo-v1-jaw-plane", [0.96, 0.92, 0.90], [0, 0, -0.001]);
  transform("kairo-v1-clavicle-armor", [1.05, 0.82, 0.96], [0, 0.001, 0.002]);
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

function materialFromMesh(visual: FighterVisual, name: string, fallback: THREE.Material): THREE.Material {
  const object = visual.root.getObjectByName(name);
  if (object instanceof THREE.Mesh) {
    return Array.isArray(object.material) ? (object.material[0] ?? fallback) : object.material;
  }
  return fallback;
}

function makeDetailMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  name: string,
  parent: THREE.Object3D,
  position: readonly [number, number, number],
  rotation: readonly [number, number, number] = [0, 0, 0],
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(position[0], position[1], position[2]);
  mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.characterGraphicsDetail = CHARACTER_GRAPHICS_POLISH_ID;
  parent.add(mesh);
  return mesh;
}

function attachment(
  mesh: THREE.Mesh,
  parent: THREE.Object3D,
  category: ClothingAttachment["category"],
): ClothingAttachment {
  return {
    name: mesh.name,
    category,
    parentBone: parent.name,
    localPosition: mesh.position.clone(),
    localRotation: mesh.rotation.clone(),
    mesh,
  };
}

function triangleCount(mesh: THREE.Mesh): number {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position");
  return geometry.index ? geometry.index.count / 3 : (position?.count ?? 0) / 3;
}

function addKairoHeroDetails(visual: FighterVisual): void {
  if (visual.root.userData.characterGraphicsDetailMeshCount) return;
  const fallbackMaterial = Array.isArray(visual.bodyMesh.material)
    ? (visual.bodyMesh.material[0] ?? new THREE.MeshStandardMaterial())
    : visual.bodyMesh.material;
  const hairMaterial = Array.isArray(visual.hair.material)
    ? (visual.hair.material[0] ?? fallbackMaterial)
    : visual.hair.material;
  const metalMaterial = materialFromMesh(visual, "kairo-v1-clavicle-armor", fallbackMaterial);

  const leftTemple = makeDetailMesh(
    bladeGeometry(0.025, 0.112, 0.030, -0.004),
    hairMaterial,
    "kairo-polish-left-temple-lock",
    visual.head,
    [-0.050, 0.061, 0.007],
    [-0.04, 0.15, -0.15],
  );
  const rightTemple = makeDetailMesh(
    bladeGeometry(0.025, 0.108, 0.030, 0.004),
    hairMaterial,
    "kairo-polish-right-temple-lock",
    visual.head,
    [0.050, 0.063, 0.009],
    [-0.04, -0.15, 0.15],
  );
  const rearHair = makeDetailMesh(
    bladeGeometry(0.034, 0.122, 0.032, 0.006),
    hairMaterial,
    "kairo-polish-rear-hair-ridge",
    visual.head,
    [0.010, 0.095, -0.050],
    [0.20, -0.08, 0.06],
  );

  const chestSigil = makeDetailMesh(
    new THREE.OctahedronGeometry(0.028, 0),
    metalMaterial,
    "kairo-polish-chest-sigil",
    visual.rig.bones.chest,
    [0, -0.058, 0.132],
    [0.06, 0, Math.PI * 0.25],
  );
  chestSigil.scale.set(0.82, 1.16, 0.42);

  const leftShoulderEdge = makeDetailMesh(
    new THREE.BoxGeometry(0.086, 0.014, 0.036),
    metalMaterial,
    "kairo-polish-left-shoulder-edge",
    visual.rig.bones.leftShoulder,
    [0, -0.018, 0.086],
    [0.04, 0, 0.16],
  );
  const rightShoulderEdge = makeDetailMesh(
    new THREE.BoxGeometry(0.076, 0.013, 0.034),
    metalMaterial,
    "kairo-polish-right-shoulder-edge",
    visual.rig.bones.rightShoulder,
    [0, -0.018, 0.075],
    [0.04, 0, -0.10],
  );

  const details = [leftTemple, rightTemple, rearHair, chestSigil, leftShoulderEdge, rightShoulderEdge];
  visual.hairMasses.push(leftTemple, rightTemple, rearHair);
  visual.clothingAttachments.push(
    attachment(chestSigil, visual.rig.bones.chest, "CHEST"),
    attachment(leftShoulderEdge, visual.rig.bones.leftShoulder, "SHOULDER"),
    attachment(rightShoulderEdge, visual.rig.bones.rightShoulder, "SHOULDER"),
  );
  visual.allMeshes.push(...details);

  visual.stats.meshCount += details.length;
  visual.stats.vertexCount += details.reduce(
    (total, mesh) => total + (mesh.geometry.getAttribute("position")?.count ?? 0),
    0,
  );
  visual.stats.triangleCount += Math.round(details.reduce((total, mesh) => total + triangleCount(mesh), 0));
  visual.root.userData.characterGraphicsDetailMeshCount = details.length;
  visual.root.userData.characterGraphicsDetailBudget = "58_MESH_IPHONE_CAP";
}

function materialSignature(material: THREE.Material | THREE.Material[]): string {
  const values = Array.isArray(material) ? material : [material];
  return values.map((value) => value.uuid).join("|");
}

function tuneVisualMaterials(visual: FighterVisual, definition: FighterDefinition): void {
  if (definition.archetype === "POWER") {
    tuneKairoBodyMaterials(visual);
    tuneKairoNamedMaterials(visual);
  } else {
    tuneSeraMaterials(visual);
  }
}

function installRuntimeMaterialRefresh(visual: FighterVisual, definition: FighterDefinition): void {
  visual.bodyMesh.userData.characterGraphicsMaterialSignature = materialSignature(visual.bodyMesh.material);
  visual.bodyMesh.onBeforeRender = () => {
    const current = materialSignature(visual.bodyMesh.material);
    if (current === visual.bodyMesh.userData.characterGraphicsMaterialSignature) return;
    tuneVisualMaterials(visual, definition);
    visual.bodyMesh.userData.characterGraphicsMaterialSignature = materialSignature(visual.bodyMesh.material);
    visual.root.userData.characterGraphicsRuntimeRefreshes =
      (Number(visual.root.userData.characterGraphicsRuntimeRefreshes) || 0) + 1;
  };
}

export function applyCharacterGraphicsPolish(
  visual: FighterVisual,
  definition: FighterDefinition,
  options: CharacterGraphicsPolishOptions = {},
): FighterVisual {
  if (visual.root.userData.characterGraphicsPolish === CHARACTER_GRAPHICS_POLISH_ID) return visual;

  tuneVisualMaterials(visual, definition);
  if (definition.archetype === "POWER") {
    refineKairoExistingForms(visual);
    if (options.addKairoDetails !== false) addKairoHeroDetails(visual);
  }
  installRuntimeMaterialRefresh(visual, definition);

  visual.root.userData.characterGraphicsPolish = CHARACTER_GRAPHICS_POLISH_ID;
  visual.root.userData.characterGraphicsMaterialModel = definition.archetype === "POWER"
    ? "KAIRO_FACET_MATERIAL_V2"
    : "SERA_REFERENCE_PRESERVING_MATERIAL_V2";
  return visual;
}

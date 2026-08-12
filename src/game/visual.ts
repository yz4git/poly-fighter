import * as THREE from "three";
import type { FighterDefinition } from "./types";

interface LimbVisual {
  root: THREE.Group;
  upper: THREE.Group;
  lower: THREE.Group;
  end: THREE.Mesh;
}

export interface FighterVisual {
  root: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  chest: THREE.Mesh;
  head: THREE.Group;
  hair: THREE.Mesh;
  leftArm: LimbVisual;
  rightArm: LimbVisual;
  leftLeg: LimbVisual;
  rightLeg: LimbVisual;
  panels: THREE.Group;
  aura: THREE.Mesh;
  allMeshes: THREE.Mesh[];
}

interface MaterialSet {
  primary: THREE.MeshStandardMaterial;
  secondary: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
  hair: THREE.MeshStandardMaterial;
  glow: THREE.MeshBasicMaterial;
}

function materials(definition: FighterDefinition): MaterialSet {
  const standard = (color: number, metalness = 0.18) =>
    new THREE.MeshStandardMaterial({
      color,
      flatShading: true,
      metalness,
      roughness: 0.44,
    });
  return {
    primary: standard(definition.colors.primary, 0.25),
    secondary: standard(definition.colors.secondary, 0.42),
    accent: standard(definition.colors.accent, 0.3),
    skin: standard(definition.colors.skin, 0.04),
    hair: standard(definition.colors.hair, 0.35),
    glow: new THREE.MeshBasicMaterial({
      color: definition.colors.glow,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  };
}

function sectionedGeometry(
  sections: Array<{ y: number; rx: number; rz: number; offset?: number }>,
  radialSegments = 12,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const section of sections) {
    for (let index = 0; index < radialSegments; index += 1) {
      const angle =
        (index / radialSegments) * Math.PI * 2 + (section.offset ?? 0);
      positions.push(
        Math.cos(angle) * section.rx,
        section.y,
        Math.sin(angle) * section.rz,
      );
    }
  }
  for (let row = 0; row < sections.length - 1; row += 1) {
    for (let index = 0; index < radialSegments; index += 1) {
      const next = (index + 1) % radialSegments;
      const a = row * radialSegments + index;
      const b = row * radialSegments + next;
      const c = (row + 1) * radialSegments + next;
      const d = (row + 1) * radialSegments + index;
      indices.push(a, b, d, b, c, d);
    }
  }
  const bottom = positions.length / 3;
  positions.push(0, sections[0]?.y ?? 0, 0);
  const top = positions.length / 3;
  positions.push(0, sections.at(-1)?.y ?? 0, 0);
  for (let index = 0; index < radialSegments; index += 1) {
    const next = (index + 1) % radialSegments;
    indices.push(bottom, next, index);
    const topStart = (sections.length - 1) * radialSegments;
    indices.push(top, topStart + index, topStart + next);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function part(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  name: string,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function limb(
  length: number,
  radius: number,
  material: THREE.Material,
  name: string,
): LimbVisual {
  const root = new THREE.Group();
  root.name = `${name}-root`;
  const upper = new THREE.Group();
  upper.name = `${name}-upper`;
  const lower = new THREE.Group();
  lower.name = `${name}-lower`;
  const upperLength = length * 0.54;
  const lowerLength = length * 0.46;
  const upperMesh = part(
    sectionedGeometry([
      { y: 0, rx: radius * 1.2, rz: radius * 1.08 },
      { y: -upperLength * 0.62, rx: radius, rz: radius * 0.92 },
      { y: -upperLength, rx: radius * 0.84, rz: radius * 0.84 },
    ], 10),
    material,
    `${name}-upper-mesh`,
  );
  const lowerMesh = part(
    sectionedGeometry([
      { y: 0, rx: radius * 0.88, rz: radius * 0.88 },
      { y: -lowerLength * 0.58, rx: radius * 0.74, rz: radius * 0.75 },
      { y: -lowerLength, rx: radius * 0.62, rz: radius * 0.65 },
    ], 10),
    material,
    `${name}-lower-mesh`,
  );
  const end = part(
    new THREE.IcosahedronGeometry(radius * 1.08, 1),
    material,
    `${name}-end`,
  );
  end.scale.set(1.22, 0.75, 1.05);
  upper.add(upperMesh);
  lower.position.y = -upperLength;
  lower.add(lowerMesh);
  end.position.y = -lowerLength;
  lower.add(end);
  upper.add(lower);
  root.add(upper);
  return { root, upper, lower, end };
}

function collectMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  return meshes;
}

export function createFighterVisual(definition: FighterDefinition): FighterVisual {
  const body = definition.body;
  const mat = materials(definition);
  const root = new THREE.Group();
  root.name = `fighter-${definition.id}`;
  root.scale.setScalar(1.22);

  const hips = new THREE.Group();
  hips.name = "hips";
  hips.position.y = 1.04;
  const hipMesh = part(
    sectionedGeometry([
      { y: -0.22, rx: body.hipWidth * 0.44, rz: 0.29 },
      { y: 0.08, rx: body.hipWidth * 0.5, rz: 0.32 },
      { y: 0.32, rx: body.waistWidth * 0.44, rz: 0.28 },
    ], 14),
    mat.secondary,
    "hip-armor",
  );
  hips.add(hipMesh);

  const torso = new THREE.Group();
  torso.name = "torso";
  torso.position.y = 1.5;
  const chest = part(
    sectionedGeometry([
      { y: -0.45, rx: body.waistWidth * 0.43, rz: body.chestDepth * 0.58 },
      { y: -0.16, rx: body.waistWidth * 0.51, rz: body.chestDepth * 0.68 },
      { y: 0.22, rx: body.shoulderWidth * 0.48, rz: body.chestDepth * 0.75 },
      { y: 0.48, rx: body.shoulderWidth * 0.44, rz: body.chestDepth * 0.68 },
    ], 16),
    mat.primary,
    "high-density-jacket-torso",
  );
  chest.scale.y = 1.04 * body.muscle;
  torso.add(chest);
  const chestPlate = part(
    new THREE.OctahedronGeometry(0.48, 2),
    mat.secondary,
    "chest-plate",
  );
  chestPlate.scale.set(body.shoulderWidth * 0.9, 0.68, body.chestDepth * 0.62);
  chestPlate.position.set(0, 0.05, 0.3);
  torso.add(chestPlate);

  const head = new THREE.Group();
  head.name = "head-and-face";
  head.position.y = 2.37;
  const neck = part(
    sectionedGeometry([
      { y: -0.18, rx: 0.18, rz: 0.17 },
      { y: 0.14, rx: 0.16, rz: 0.15 },
    ], 10),
    mat.skin,
    "neck",
  );
  head.add(neck);
  const face = part(
    new THREE.IcosahedronGeometry(0.52, 2),
    mat.skin,
    "angular-face",
  );
  face.scale.set(body.headWidth * 0.72, 1.06, 0.8);
  face.position.y = 0.44;
  head.add(face);
  const jaw = part(
    new THREE.OctahedronGeometry(0.3, 1),
    mat.skin,
    "jaw-plane",
  );
  jaw.scale.set(body.jawWidth * 0.85, 0.64, 0.76);
  jaw.position.set(0, 0.14, 0.34);
  head.add(jaw);
  const hair = part(
    new THREE.IcosahedronGeometry(0.53, 2),
    mat.hair,
    "faceted-hair",
  );
  hair.scale.set(1.02, 0.72, 0.98);
  hair.position.set(0, 0.79, -0.02);
  head.add(hair);
  const brow = part(
    sectionedGeometry([
      { y: -0.04, rx: 0.12, rz: 0.07 },
      { y: 0.04, rx: 0.1, rz: 0.05 },
    ], 8),
    mat.hair,
    "brow-ridge",
  );
  brow.rotation.z = Math.PI / 2;
  brow.scale.set(1.7, 1, 0.7);
  brow.position.set(0, 0.49, 0.42);
  head.add(brow);

  const leftArm = limb(body.armLength, 0.13 * body.muscle, mat.primary, "left-arm");
  const rightArm = limb(body.armLength, 0.13 * body.muscle, mat.primary, "right-arm");
  leftArm.root.position.set(-body.shoulderWidth * 0.53, 1.83, 0);
  rightArm.root.position.set(body.shoulderWidth * 0.53, 1.83, 0);
  const leftShoulder = part(
    new THREE.IcosahedronGeometry(0.22, 1),
    mat.accent,
    "left-shoulder-armor",
  );
  const rightShoulder = leftShoulder.clone();
  leftShoulder.position.set(-body.shoulderWidth * 0.52, 1.82, 0);
  rightShoulder.position.set(body.shoulderWidth * 0.52, 1.82, 0);

  const leftLeg = limb(body.legLength, 0.16 * body.muscle, mat.secondary, "left-leg");
  const rightLeg = limb(body.legLength, 0.16 * body.muscle, mat.secondary, "right-leg");
  leftLeg.root.position.set(-body.hipWidth * 0.25, 0.98, 0);
  rightLeg.root.position.set(body.hipWidth * 0.25, 0.98, 0);
  const leftBoot = part(
    new THREE.BoxGeometry(0.32 * body.footScale, 0.18, 0.58 * body.footScale),
    mat.primary,
    "left-boot",
  );
  const rightBoot = leftBoot.clone();
  leftBoot.position.set(-body.hipWidth * 0.25, 0.08, 0.18);
  rightBoot.position.set(body.hipWidth * 0.25, 0.08, 0.18);

  const panels = new THREE.Group();
  panels.name = "silhouette-panels";
  if (body.longPanels) {
    const leftPanel = part(
      new THREE.OctahedronGeometry(0.36, 1),
      mat.primary,
      "long-blue-panel-left",
    );
    leftPanel.scale.set(0.5, 2.1, 0.22);
    leftPanel.position.set(-0.4, 1.08, -0.15);
    leftPanel.rotation.z = -0.18;
    const rightPanel = leftPanel.clone();
    rightPanel.position.x = 0.4;
    rightPanel.rotation.z = 0.18;
    panels.add(leftPanel, rightPanel);
  } else {
    const jacketTail = part(
      new THREE.OctahedronGeometry(0.28, 1),
      mat.primary,
      "jacket-tail",
    );
    jacketTail.scale.set(1.15, 1.8, 0.34);
    jacketTail.position.set(0, 1.18, -0.28);
    panels.add(jacketTail);
  }

  const aura = part(new THREE.SphereGeometry(1, 12, 8), mat.glow, "fighter-aura");
  aura.scale.set(0.9, 1.55, 0.58);
  aura.position.y = 1.3;
  aura.visible = false;

  root.add(
    hips,
    torso,
    head,
    leftArm.root,
    rightArm.root,
    leftLeg.root,
    rightLeg.root,
    leftShoulder,
    rightShoulder,
    leftBoot,
    rightBoot,
    panels,
    aura,
  );

  const allMeshes = collectMeshes(root);
  return {
    root,
    hips,
    torso,
    chest,
    head,
    hair,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    panels,
    aura,
    allMeshes,
  };
}

export function disposeFighterVisual(visual: FighterVisual): void {
  visual.root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    if (Array.isArray(object.material)) {
      object.material.forEach((material) => material.dispose());
    } else {
      object.material.dispose();
    }
  });
}

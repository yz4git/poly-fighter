import * as THREE from "three";
import type { FighterDefinition } from "./types";

export type FighterVisualQuality = "LOW" | "NORMAL" | "HIGH";

interface LimbVisual {
  root: THREE.Group;
  upper: THREE.Group;
  lower: THREE.Group;
  end: THREE.Mesh;
}

export interface FighterRig {
  root: THREE.Bone;
  bones: Record<string, THREE.Bone>;
  skeleton: THREE.Skeleton;
}

export interface FighterVisualStats {
  quality: FighterVisualQuality;
  vertexCount: number;
  triangleCount: number;
  meshCount: number;
  materialCount: number;
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
  rig: FighterRig;
  stats: FighterVisualStats;
}

interface MaterialSet {
  primary: THREE.MeshStandardMaterial;
  secondary: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
  hair: THREE.MeshStandardMaterial;
  eyes: THREE.MeshStandardMaterial;
  mouth: THREE.MeshStandardMaterial;
  glow: THREE.MeshBasicMaterial;
}

interface DetailProfile {
  radial: number;
  torsoRows: number;
  limbRows: number;
  headRows: number;
  detailRadial: number;
  detailRows: number;
}

const DETAIL: Record<FighterVisualQuality, DetailProfile> = {
  LOW: { radial: 24, torsoRows: 22, limbRows: 18, headRows: 22, detailRadial: 12, detailRows: 8 },
  NORMAL: { radial: 40, torsoRows: 31, limbRows: 27, headRows: 31, detailRadial: 18, detailRows: 12 },
  HIGH: { radial: 48, torsoRows: 39, limbRows: 35, headRows: 39, detailRadial: 24, detailRows: 16 },
};

function materials(definition: FighterDefinition): MaterialSet {
  const standard = (color: number, metalness = 0.18, roughness = 0.44) =>
    new THREE.MeshStandardMaterial({ color, flatShading: true, metalness, roughness });
  return {
    primary: standard(definition.colors.primary, 0.3, 0.38),
    secondary: standard(definition.colors.secondary, 0.46, 0.34),
    accent: standard(definition.colors.accent, 0.34, 0.35),
    skin: standard(definition.colors.skin, 0.04, 0.5),
    hair: standard(definition.colors.hair, 0.32, 0.4),
    eyes: standard(0xeaf7ff, 0.02, 0.24),
    mouth: standard(0x351d2a, 0.02, 0.56),
    glow: new THREE.MeshBasicMaterial({
      color: definition.colors.glow,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  };
}

interface Section {
  y: number;
  rx: number;
  rz: number;
  offsetX?: number;
  offsetZ?: number;
  phase?: number;
}

/** A high-density body surface made from intentional anatomical cross sections. */
function sectionedGeometry(sections: Section[], radialSegments: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const section of sections) {
    for (let index = 0; index < radialSegments; index += 1) {
      const angle = (index / radialSegments) * Math.PI * 2 + (section.phase ?? 0);
      positions.push(
        (section.offsetX ?? 0) + Math.cos(angle) * section.rx,
        section.y,
        (section.offsetZ ?? 0) + Math.sin(angle) * section.rz,
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
  positions.push(sections[0]?.offsetX ?? 0, sections[0]?.y ?? 0, sections[0]?.offsetZ ?? 0);
  const top = positions.length / 3;
  const last = sections.at(-1);
  positions.push(last?.offsetX ?? 0, last?.y ?? 0, last?.offsetZ ?? 0);
  for (let index = 0; index < radialSegments; index += 1) {
    const next = (index + 1) % radialSegments;
    indices.push(bottom, next, index);
    const topStart = (sections.length - 1) * radialSegments;
    indices.push(top, topStart + index, topStart + next);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function facetedEllipsoid(
  rx: number,
  ry: number,
  rz: number,
  radialSegments: number,
  rows: number,
  frontBias = 0,
): THREE.BufferGeometry {
  const count = Math.max(4, rows);
  const sections: Section[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = index / (count - 1);
    const angle = -Math.PI * 0.5 + t * Math.PI;
    const ring = Math.cos(angle);
    sections.push({
      y: Math.sin(angle) * ry,
      rx: Math.max(0.008, ring * rx),
      rz: Math.max(0.008, ring * rz),
      offsetZ: frontBias * Math.max(0, ring),
    });
  }
  return sectionedGeometry(sections, radialSegments);
}

/** Angular cloth, collar, brow, and hair pieces without box primitives. */
function wedgeGeometry(width: number, height: number, depth: number, frontPoint = 0.7): THREE.BufferGeometry {
  const w = width * 0.5;
  const h = height * 0.5;
  const d = depth * 0.5;
  const positions = [
    -w, -h, -d, w, -h, -d, w * 0.88, h, -d * 0.48, -w * 0.88, h, -d * 0.48,
    -w * 0.72, -h * 0.72, d * frontPoint, w * 0.72, -h * 0.72, d * frontPoint,
    w * 0.52, h * 0.68, d * 0.28, -w * 0.52, h * 0.68, d * 0.28,
  ];
  const indices = [
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2,
    2, 6, 7, 2, 7, 3,
    3, 7, 4, 3, 4, 0,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function part(geometry: THREE.BufferGeometry, material: THREE.Material, name: string): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

function createRig(): FighterRig {
  const names = [
    "root", "hips", "spineLower", "spineUpper", "chest", "neck", "head",
    "leftShoulder", "leftUpperArm", "leftForearm", "leftHand", "rightShoulder", "rightUpperArm", "rightForearm", "rightHand",
    "leftThigh", "leftShin", "leftFoot", "rightThigh", "rightShin", "rightFoot",
  ];
  const bones = Object.fromEntries(names.map((name) => [name, new THREE.Bone()])) as Record<string, THREE.Bone>;
  names.forEach((name) => { bones[name].name = `v2-${name}`; });
  bones.root.add(bones.hips);
  bones.hips.add(bones.spineLower);
  bones.spineLower.add(bones.spineUpper);
  bones.spineUpper.add(bones.chest);
  bones.chest.add(bones.neck);
  bones.neck.add(bones.head);
  bones.chest.add(bones.leftShoulder, bones.rightShoulder);
  bones.leftShoulder.add(bones.leftUpperArm);
  bones.leftUpperArm.add(bones.leftForearm);
  bones.leftForearm.add(bones.leftHand);
  bones.rightShoulder.add(bones.rightUpperArm);
  bones.rightUpperArm.add(bones.rightForearm);
  bones.rightForearm.add(bones.rightHand);
  bones.hips.add(bones.leftThigh, bones.rightThigh);
  bones.leftThigh.add(bones.leftShin);
  bones.leftShin.add(bones.leftFoot);
  bones.rightThigh.add(bones.rightShin);
  bones.rightShin.add(bones.rightFoot);
  return { root: bones.root, bones, skeleton: new THREE.Skeleton(Object.values(bones)) };
}

function limb(
  length: number,
  radius: number,
  material: THREE.Material,
  name: string,
  profile: DetailProfile,
  kind: "ARM" | "LEG",
  secondary: THREE.Material,
  handScale: number,
  footScale: number,
): LimbVisual {
  const root = new THREE.Group();
  root.name = `${name}-root`;
  const upper = new THREE.Group();
  upper.name = `${name}-upper`;
  const lower = new THREE.Group();
  lower.name = `${name}-lower`;
  const upperLength = length * (kind === "ARM" ? 0.52 : 0.55);
  const lowerLength = length - upperLength;
  const rows = profile.limbRows;
  const upperSections: Section[] = [];
  const lowerSections: Section[] = [];
  for (let index = 0; index < rows; index += 1) {
    const t = index / (rows - 1);
    const contour = 1 + Math.sin(t * Math.PI) * (kind === "ARM" ? 0.13 : 0.19);
    upperSections.push({
      y: -upperLength * t,
      rx: radius * (kind === "ARM" ? 1.1 : 1.22) * (1 - t * 0.22) * contour,
      rz: radius * (kind === "ARM" ? 0.94 : 1.02) * (1 - t * 0.18) * contour,
      offsetZ: kind === "ARM" ? Math.sin(t * Math.PI) * 0.025 : 0,
    });
    lowerSections.push({
      y: -lowerLength * t,
      rx: radius * (kind === "ARM" ? 0.91 : 0.96) * (1 - t * 0.25) * (1 + Math.sin(t * Math.PI) * 0.1),
      rz: radius * (kind === "ARM" ? 0.86 : 0.92) * (1 - t * 0.2) * (1 + Math.sin(t * Math.PI) * 0.1),
      offsetZ: kind === "ARM" ? Math.sin(t * Math.PI) * 0.02 : 0,
    });
  }
  const upperMesh = part(sectionedGeometry(upperSections, profile.radial), material, `${name}-upper-mass`);
  const lowerMesh = part(sectionedGeometry(lowerSections, profile.radial), material, `${name}-forearm-shin-mass`);
  upper.add(upperMesh);
  lower.position.y = -upperLength;
  lower.add(lowerMesh);

  const joint = part(
    facetedEllipsoid(radius * (kind === "ARM" ? 0.98 : 1.08), radius * 1.02, radius * 0.98, profile.detailRadial, profile.detailRows),
    secondary,
    `${name}-${kind === "ARM" ? "elbow" : "knee"}-facet`,
  );
  lower.add(joint);

  const end = part(
    kind === "ARM"
      ? facetedEllipsoid(radius * 1.28 * handScale, radius * 0.88 * handScale, radius * 1.46 * handScale, profile.detailRadial, profile.detailRows, 0.08)
      : wedgeGeometry(radius * 2.8 * footScale, radius * 1.35, radius * 3.5 * footScale, 0.94),
    material,
    `${name}-${kind === "ARM" ? "closed-fist" : "foot-boot"}`,
  );
  end.position.y = -lowerLength;
  end.position.z = kind === "ARM" ? 0.12 : 0.18 * footScale;
  lower.add(end);

  if (kind === "ARM") {
    const knuckles = part(wedgeGeometry(radius * 1.48 * handScale, radius * 0.42, radius * 0.72 * handScale, 0.95), secondary, `${name}-knuckle-plane`);
    knuckles.position.set(0, -lowerLength, 0.23 * handScale);
    lower.add(knuckles);
    const thumb = part(facetedEllipsoid(radius * 0.62, radius * 0.58, radius * 0.76, profile.detailRadial, profile.detailRows), secondary, `${name}-thumb-mass`);
    thumb.position.set(radius * 0.58 * handScale, -lowerLength - radius * 0.08, 0.12 * handScale);
    lower.add(thumb);
  } else {
    const sole = part(wedgeGeometry(radius * 2.9 * footScale, radius * 0.32, radius * 3.7 * footScale, 0.96), secondary, `${name}-sole-plate`);
    sole.position.set(0, -lowerLength - radius * 0.1, 0.22 * footScale);
    lower.add(sole);
    const toe = part(facetedEllipsoid(radius * 1.02 * footScale, radius * 0.52, radius * 1.18 * footScale, profile.detailRadial, profile.detailRows, 0.05), material, `${name}-toe-cap`);
    toe.position.set(0, -lowerLength - radius * 0.04, 0.46 * footScale);
    lower.add(toe);
  }
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

function statsFor(quality: FighterVisualQuality, meshes: THREE.Mesh[]): FighterVisualStats {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  let vertexCount = 0;
  let triangleCount = 0;
  for (const mesh of meshes) {
    if (!geometries.has(mesh.geometry)) {
      geometries.add(mesh.geometry);
      vertexCount += mesh.geometry.getAttribute("position")?.count ?? 0;
      triangleCount += mesh.geometry.index ? mesh.geometry.index.count / 3 : (mesh.geometry.getAttribute("position")?.count ?? 0) / 3;
    }
    if (Array.isArray(mesh.material)) mesh.material.forEach((material) => materials.add(material));
    else materials.add(mesh.material);
  }
  return { quality, vertexCount, triangleCount: Math.round(triangleCount), meshCount: meshes.length, materialCount: materials.size };
}

export function createFighterVisual(
  definition: FighterDefinition,
  quality: FighterVisualQuality = "NORMAL",
): FighterVisual {
  const body = definition.body;
  const profile = DETAIL[quality];
  const mat = materials(definition);
  const root = new THREE.Group();
  root.name = `fighter-v2-${definition.id}`;
  root.scale.setScalar(1.18 * body.height);

  const hips = new THREE.Group();
  hips.name = "hips-v2";
  hips.position.y = 1.04;
  const pelvis = part(
    sectionedGeometry([
      { y: -0.25, rx: (body.pelvisWidth ?? body.hipWidth) * 0.42, rz: 0.34, offsetZ: 0.01 },
      { y: -0.06, rx: (body.pelvisWidth ?? body.hipWidth) * 0.5, rz: 0.37 },
      { y: 0.18, rx: body.hipWidth * 0.48, rz: 0.32 },
      { y: 0.34, rx: body.waistWidth * 0.46, rz: 0.28 },
    ], profile.radial),
    mat.secondary,
    "pelvis-anatomical-mass",
  );
  hips.add(pelvis);
  const belt = part(wedgeGeometry(body.hipWidth * 0.92, 0.13, 0.46, 0.86), mat.accent, "waist-belt-geometry");
  belt.position.set(0, 0.22, 0.2);
  hips.add(belt);

  const torso = new THREE.Group();
  torso.name = "torso-v2";
  torso.position.y = 1.5;
  const chest = part(
    sectionedGeometry([
      { y: -0.46, rx: body.waistWidth * 0.43, rz: body.chestDepth * 0.56, offsetZ: 0.01 },
      { y: -0.26, rx: (body.chestWidth ?? body.shoulderWidth) * 0.43, rz: body.chestDepth * 0.65 },
      { y: -0.02, rx: (body.chestWidth ?? body.shoulderWidth) * 0.49, rz: body.chestDepth * 0.76, offsetZ: 0.02 },
      { y: 0.24, rx: (body.clavicleWidth ?? body.shoulderWidth) * 0.49, rz: body.chestDepth * 0.73, offsetZ: 0.01 },
      { y: 0.46, rx: (body.clavicleWidth ?? body.shoulderWidth) * 0.42, rz: body.chestDepth * 0.62 },
      { y: 0.57, rx: body.shoulderWidth * 0.34, rz: body.chestDepth * 0.45 },
    ], profile.radial),
    mat.primary,
    "torso-ribcage-and-abdomen",
  );
  torso.add(chest);
  const chestPlate = part(wedgeGeometry(body.shoulderWidth * 0.74, 0.58, body.chestDepth * 0.46, 0.96), mat.secondary, "sternum-jacket-panel");
  chestPlate.position.set(0, 0.02, body.chestDepth * 0.54);
  torso.add(chestPlate);
  const collarLeft = part(wedgeGeometry(0.22, 0.5, 0.18, 0.95), mat.accent, "left-collar");
  collarLeft.position.set(-0.17, 0.39, body.chestDepth * 0.53);
  collarLeft.rotation.z = -0.3;
  const collarRight = collarLeft.clone();
  collarRight.name = "right-collar";
  collarRight.position.x = 0.17;
  collarRight.rotation.z = 0.3;
  torso.add(collarLeft, collarRight);

  const head = new THREE.Group();
  head.name = "head-face-v2";
  head.position.y = 2.38;
  const neckLength = body.neckLength ?? 0.27;
  const neck = part(
    sectionedGeometry([
      { y: -0.28, rx: 0.2, rz: 0.18 },
      { y: -0.08, rx: 0.19, rz: 0.18 },
      { y: neckLength * 0.62, rx: 0.17, rz: 0.16 },
    ], profile.detailRadial),
    mat.skin,
    "neck-cylinder-free-facet",
  );
  head.add(neck);
  const headDepth = body.headDepth ?? 0.84;
  const face = part(
    sectionedGeometry([
      { y: -0.44, rx: body.jawWidth * 0.32, rz: headDepth * 0.31, offsetZ: 0.04 },
      { y: -0.28, rx: body.jawWidth * 0.5, rz: headDepth * 0.42, offsetZ: 0.06 },
      { y: -0.04, rx: body.headWidth * 0.53, rz: headDepth * 0.49, offsetZ: 0.03 },
      { y: 0.25, rx: body.headWidth * 0.56, rz: headDepth * 0.48 },
      { y: 0.5, rx: body.headWidth * 0.51, rz: headDepth * 0.43, offsetZ: -0.02 },
      { y: 0.7, rx: body.headWidth * 0.38, rz: headDepth * 0.32, offsetZ: -0.02 },
    ], profile.radial),
    mat.skin,
    "skull-forehead-cheek-jaw-surface",
  );
  face.position.y = 0.4;
  head.add(face);
  const jaw = part(sectionedGeometry([
    { y: -0.2, rx: body.jawWidth * 0.3, rz: headDepth * 0.32, offsetZ: 0.18 },
    { y: -0.02, rx: body.jawWidth * 0.46, rz: headDepth * 0.36, offsetZ: 0.2 },
    { y: 0.16, rx: body.jawWidth * 0.42, rz: headDepth * 0.3, offsetZ: 0.16 },
  ], profile.detailRadial), mat.skin, "jaw-line-and-chin");
  jaw.position.y = 0.22;
  head.add(jaw);

  const cheekWidth = body.cheekWidth ?? body.headWidth * 0.88;
  for (const side of [-1, 1]) {
    const cheek = part(facetedEllipsoid(0.15 * cheekWidth, 0.13, 0.1, profile.detailRadial, profile.detailRows, 0.04), mat.skin, `${side < 0 ? "left" : "right"}-cheekbone`);
    cheek.position.set(side * body.headWidth * 0.32, 0.28, headDepth * 0.43);
    head.add(cheek);
    const ear = part(facetedEllipsoid(0.09, 0.16, 0.07, profile.detailRadial, profile.detailRows), mat.skin, `${side < 0 ? "left" : "right"}-ear`);
    ear.position.set(side * body.headWidth * 0.56, 0.36, 0);
    head.add(ear);
    const eye = part(facetedEllipsoid(0.095, 0.052, 0.035, profile.detailRadial, profile.detailRows, 0.02), mat.eyes, `${side < 0 ? "left" : "right"}-eye-sclera`);
    eye.position.set(side * body.headWidth * 0.21, 0.47, headDepth * 0.48);
    head.add(eye);
    const iris = part(facetedEllipsoid(0.043, 0.043, 0.022, profile.detailRadial, profile.detailRows), mat.hair, `${side < 0 ? "left" : "right"}-iris-pupil`);
    iris.position.set(side * body.headWidth * 0.21, 0.47, headDepth * 0.525);
    head.add(iris);
    const brow = part(wedgeGeometry(0.23, 0.055, 0.07, 0.92), mat.hair, `${side < 0 ? "left" : "right"}-brow-ridge`);
    brow.position.set(side * body.headWidth * 0.21, 0.59, headDepth * 0.5);
    brow.rotation.z = side * -0.08;
    head.add(brow);
  }
  const noseBridge = part(sectionedGeometry([
    { y: 0.28, rx: 0.065, rz: 0.055, offsetZ: headDepth * 0.46 },
    { y: 0.48, rx: 0.052, rz: 0.045, offsetZ: headDepth * 0.48 },
    { y: 0.62, rx: 0.038, rz: 0.036, offsetZ: headDepth * 0.46 },
  ], profile.detailRadial), mat.skin, "nose-bridge-geometry");
  head.add(noseBridge);
  const noseTip = part(facetedEllipsoid(0.085 * (body.noseLength ?? 1), 0.075, 0.09, profile.detailRadial, profile.detailRows, 0.03), mat.skin, "nose-tip-plane");
  noseTip.position.set(0, 0.27, headDepth * 0.57);
  head.add(noseTip);
  const upperLip = part(wedgeGeometry(0.18, 0.045, 0.08, 0.95), mat.mouth, "upper-lip-geometry");
  upperLip.position.set(0, 0.11, headDepth * 0.47);
  const lowerLip = part(wedgeGeometry(0.2, 0.05, 0.075, 0.9), mat.mouth, "lower-lip-geometry");
  lowerLip.position.set(0, 0.045, headDepth * 0.46);
  head.add(upperLip, lowerLip);

  const hair = part(facetedEllipsoid(body.headWidth * 0.58, 0.32, headDepth * 0.52, profile.radial, profile.headRows, -0.02), mat.hair, "hair-cap-faceted-mass");
  hair.position.set(0, 0.79, -0.03);
  head.add(hair);
  for (let index = 0; index < 6; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    const lock = part(wedgeGeometry(0.26 + (index % 3) * 0.05, 0.48 + (index % 2) * 0.12, 0.24, 0.92), mat.hair, `hair-lock-${index}`);
    lock.position.set(side * (0.16 + Math.floor(index / 2) * 0.13), 0.86 - (index % 3) * 0.07, 0.08 - (index % 2) * 0.08);
    lock.rotation.z = side * (0.12 + (index % 3) * 0.07);
    lock.rotation.x = -0.12 - (index % 2) * 0.1;
    head.add(lock);
  }

  const shoulderWidth = body.clavicleWidth ?? body.shoulderWidth;
  const armRadius = 0.13 * (body.upperArmMass ?? body.muscle);
  const leftArm = limb(body.armLength, armRadius, mat.primary, "left-arm", profile, "ARM", mat.secondary, body.handScale, body.footScale);
  const rightArm = limb(body.armLength, armRadius, mat.primary, "right-arm", profile, "ARM", mat.secondary, body.handScale, body.footScale);
  leftArm.root.position.set(-shoulderWidth * 0.52, 1.82, 0);
  rightArm.root.position.set(shoulderWidth * 0.52, 1.82, 0);
  for (const [arm, side] of [[leftArm, -1], [rightArm, 1]] as const) {
    const shoulder = part(facetedEllipsoid(0.23 * (body.upperArmMass ?? 1), 0.21, 0.25, profile.detailRadial, profile.detailRows, 0.02), mat.accent, `${side < 0 ? "left" : "right"}-deltoid-mass`);
    shoulder.position.set(0, 0.03, 0);
    arm.root.add(shoulder);
  }

  const legRadius = 0.16 * (body.thighMass ?? body.muscle);
  const leftLeg = limb(body.legLength, legRadius, mat.secondary, "left-leg", profile, "LEG", mat.primary, body.handScale, body.footScale);
  const rightLeg = limb(body.legLength, legRadius, mat.secondary, "right-leg", profile, "LEG", mat.primary, body.handScale, body.footScale);
  leftLeg.root.position.set(-(body.pelvisWidth ?? body.hipWidth) * 0.25, 0.98, 0);
  rightLeg.root.position.set((body.pelvisWidth ?? body.hipWidth) * 0.25, 0.98, 0);

  const panels = new THREE.Group();
  panels.name = "geometry-clothing-panels-v2";
  const waistPanel = part(wedgeGeometry(body.waistWidth * 0.62, 0.38, 0.16, 0.94), mat.accent, "front-waist-panel");
  waistPanel.position.set(0, 1.25, 0.35);
  panels.add(waistPanel);
  if (body.longPanels) {
    for (const side of [-1, 1]) {
      const panel = part(wedgeGeometry(0.32, 1.38, 0.18, 0.9), mat.primary, `${side < 0 ? "left" : "right"}-long-coat-panel`);
      panel.position.set(side * 0.4, 1.06, -0.19);
      panel.rotation.z = side * 0.12;
      panels.add(panel);
    }
  } else {
    const tail = part(wedgeGeometry(0.76, 0.98, 0.22, 0.94), mat.primary, "structured-jacket-tail");
    tail.position.set(0, 1.15, -0.3);
    panels.add(tail);
  }
  const sideArmorLeft = part(wedgeGeometry(0.25, 0.66, 0.18, 0.9), mat.secondary, "left-side-armor");
  const sideArmorRight = sideArmorLeft.clone();
  sideArmorRight.name = "right-side-armor";
  sideArmorLeft.position.set(-body.shoulderWidth * 0.49, 1.64, 0.02);
  sideArmorRight.position.set(body.shoulderWidth * 0.49, 1.64, 0.02);
  panels.add(sideArmorLeft, sideArmorRight);

  const aura = part(new THREE.SphereGeometry(1, profile.detailRadial, profile.detailRows), mat.glow, "fighter-energy-aura");
  aura.scale.set(0.9, 1.55, 0.58);
  aura.position.y = 1.3;
  aura.visible = false;

  const rig = createRig();
  rig.root.visible = false;
  root.add(hips, torso, head, leftArm.root, rightArm.root, leftLeg.root, rightLeg.root, panels, aura, rig.root);
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
    rig,
    stats: statsFor(quality, allMeshes),
  };
}

export function disposeFighterVisual(visual: FighterVisual): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  visual.root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    if (Array.isArray(object.material)) object.material.forEach((material) => materials.add(material));
    else materials.add(object.material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

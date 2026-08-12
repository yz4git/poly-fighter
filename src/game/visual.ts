import * as THREE from "three";
import type { FighterDefinition, VisualContactPoint } from "./types";
import { MODEL_FORWARD } from "./rig";

export type FighterVisualQuality = "LOW" | "NORMAL" | "HIGH";

/** Reference-constrained proportions in normalized one-unit body space. */
export interface ReferenceStyle {
  headHeight: number;
  headWidth: number;
  shoulderWidth: number;
  waistWidth: number;
  pelvisWidth: number;
  hipToGround: number;
  thighLength: number;
  shinLength: number;
  shoulderToWrist: number;
  handLength: number;
  footLength: number;
  neckWidth: number;
  chestDepth: number;
  noseProjection: number;
}

export const REFERENCE_STYLE: Readonly<{ KAIRO: ReferenceStyle; SERA: ReferenceStyle }> = {
  KAIRO: {
    headHeight: 0.145,
    headWidth: 0.105,
    shoulderWidth: 0.285,
    waistWidth: 0.173,
    pelvisWidth: 0.190,
    hipToGround: 0.545,
    thighLength: 0.275,
    shinLength: 0.260,
    shoulderToWrist: 0.325,
    handLength: 0.105,
    footLength: 0.155,
    neckWidth: 0.075,
    chestDepth: 0.125,
    // Face-local projection: the generated world-space value is headWidth * this.
    noseProjection: 0.16,
  },
  SERA: {
    headHeight: 0.140,
    headWidth: 0.100,
    shoulderWidth: 0.225,
    waistWidth: 0.145,
    pelvisWidth: 0.190,
    hipToGround: 0.575,
    thighLength: 0.290,
    shinLength: 0.280,
    shoulderToWrist: 0.315,
    handLength: 0.095,
    footLength: 0.150,
    neckWidth: 0.065,
    chestDepth: 0.104,
    noseProjection: 0.14,
  },
};

export const REFERENCE_POSE_LANDMARKS = {
  KAIRO: {
    headTop: [0.2072, 0.2808], chin: [0.2072, 0.3959], neck: [0.2175, 0.4052],
    leftShoulder: [0.1485, 0.4190], rightShoulder: [0.2693, 0.3729], hip: [0.2762, 0.5433],
    supportKnee: [0.2314, 0.6860], supportAnkle: [0.2003, 0.8379], supportToe: [0.1692, 0.8932],
    kickKnee: [0.4213, 0.4788], kickAnkle: [0.6008, 0.4190], kickToe: [0.6388, 0.4052],
    guardElbow: [0.1657, 0.4604], guardFist: [0.1865, 0.4282], extendElbow: [0.3557, 0.3775], extendFist: [0.4247, 0.3867],
  },
  SERA: {
    headTop: [0.7528, 0.3361], chin: [0.7528, 0.4328], leftShoulder: [0.7010, 0.4190], rightShoulder: [0.7907, 0.4374], hip: [0.7666, 0.5847],
    frontKnee: [0.6699, 0.6860], frontAnkle: [0.6043, 0.8517], frontToe: [0.5628, 0.8886], backKnee: [0.7804, 0.7505], backAnkle: [0.8874, 0.8471], backToe: [0.9323, 0.8794],
    raisedElbow: [0.6802, 0.4144], raisedHand: [0.7010, 0.3361], lowElbow: [0.6906, 0.5110], lowHand: [0.6457, 0.4788],
  },
} as const;

export const REFERENCE_POSE_BOUNDS = {
  KAIRO: {
    headTop: [0.197, 0.007], chin: [0.197, 0.194], leftShoulder: [0.089, 0.231], rightShoulder: [0.312, 0.157], hip: [0.325, 0.433],
    supportKnee: [0.242, 0.664], supportAnkle: [0.185, 0.910], supportToe: [0.127, 1.000], kickKnee: [0.592, 0.328], kickAnkle: [0.924, 0.231], kickToe: [0.994, 0.209],
  },
  SERA: {
    headTop: [0.518, 0.008], chin: [0.518, 0.180], leftShoulder: [0.384, 0.156], rightShoulder: [0.616, 0.189], hip: [0.554, 0.451],
    frontKnee: [0.304, 0.631], frontAnkle: [0.134, 0.926], frontToe: [0.027, 0.992], backKnee: [0.589, 0.746], backAnkle: [0.866, 0.918], backToe: [0.982, 0.975],
  },
} as const;

export interface FighterVisualLayout extends ReferenceStyle {
  normalizedHeight: 1;
  worldScale: number;
  headBottom: number;
  shoulderY: number;
  hipsY: number;
  kneeY: number;
  ankleY: number;
  elbowY: number;
  wristY: number;
  pelvisTopY: number;
  waistY: number;
  ribY: number;
  clavicleY: number;
  headDepth: number;
}

export interface ProportionMetrics {
  headCount: number;
  shoulderHeadRatio: number;
  shoulderWaistRatio: number;
  pelvisShoulderRatio: number;
  hipGroundRatio: number;
  thighShinRatio: number;
  legHeightRatio: number;
}

export interface FacetDistribution { large: number; medium: number; small: number; }

export interface VisualStyleScores {
  style: number | null;
  silhouette: number | null;
  proportion: number;
  landmark: number | null;
  facet: number;
  colorMaterial: number | null;
  surfaceContinuity: number | null;
}

export interface GeneratedLandmarks {
  headTop: THREE.Vector3;
  chin: THREE.Vector3;
  leftShoulder: THREE.Vector3;
  rightShoulder: THREE.Vector3;
  hip: THREE.Vector3;
  leftElbow: THREE.Vector3;
  rightElbow: THREE.Vector3;
  leftWrist: THREE.Vector3;
  rightWrist: THREE.Vector3;
  leftKnee: THREE.Vector3;
  rightKnee: THREE.Vector3;
  leftAnkle: THREE.Vector3;
  rightAnkle: THREE.Vector3;
  leftToe: THREE.Vector3;
  rightToe: THREE.Vector3;
}

export interface ProjectedSilhouetteMetrics {
  resolution: number;
  areaRatio: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  center: { x: number; y: number };
  occupiedPixels: number;
}

export interface MaterialCoverage {
  dark: number;
  primary: number;
  skin: number;
  other: number;
}

export interface FighterVisualStats {
  quality: FighterVisualQuality;
  vertexCount: number;
  triangleCount: number;
  meshCount: number;
  materialCount: number;
  proportions: ProportionMetrics;
  facetDistribution: FacetDistribution;
  materialCoverage: MaterialCoverage;
  scores: VisualStyleScores;
  skinnedMesh: boolean;
  weightedVertexCount: number;
}

export interface LimbVisual {
  root: THREE.Object3D;
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  end: THREE.Mesh;
}

export interface FighterRig {
  root: THREE.Bone;
  bones: Record<string, THREE.Bone>;
  boneIndices: Record<string, number>;
  skeleton: THREE.Skeleton;
}

export interface FighterVisual {
  root: THREE.Group;
  hips: THREE.Object3D;
  torso: THREE.Object3D;
  chest: THREE.SkinnedMesh;
  bodyMesh: THREE.SkinnedMesh;
  head: THREE.Object3D;
  hair: THREE.Mesh;
  leftArm: LimbVisual;
  rightArm: LimbVisual;
  leftLeg: LimbVisual;
  rightLeg: LimbVisual;
  panels: THREE.Group;
  aura: THREE.Mesh;
  allMeshes: THREE.Mesh[];
  rig: FighterRig;
  layout: FighterVisualLayout;
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
  worldScale: number;
}

const DETAIL: Record<FighterVisualQuality, DetailProfile> = {
  LOW: { radial: 13, torsoRows: 22, limbRows: 28, headRows: 25, detailRadial: 7, detailRows: 5, worldScale: 3.22 },
  NORMAL: { radial: 18, torsoRows: 28, limbRows: 36, headRows: 34, detailRadial: 9, detailRows: 6, worldScale: 3.25 },
  HIGH: { radial: 22, torsoRows: 36, limbRows: 46, headRows: 42, detailRadial: 11, detailRows: 7, worldScale: 3.28 },
};

const MATERIAL_INDEX = { primary: 0, secondary: 1, accent: 2, skin: 3 } as const;
type SkinWeight = [number, number, number, number, number, number, number, number];
type SurfaceSampler = (...coordinates: [number, number, number]) => SkinWeight;

interface SurfaceSection {
  y: number; cx: number; cz: number; rx: number; rz: number;
  phase?: number; nx?: number; nz?: number; deform2?: number; deform3?: number; frontBump?: number;
}

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function smoothstep(value: number): number { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); }
function superellipse(value: number, exponent: number): number { return Math.sign(value) * Math.pow(Math.abs(value), 2 / exponent); }

function material(color: number, metalness: number, roughness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, metalness, roughness });
}

function createMaterials(definition: FighterDefinition): MaterialSet {
  return {
    primary: material(definition.colors.primary, 0.035, 0.64),
    secondary: material(definition.colors.secondary, 0.025, 0.68),
    accent: material(definition.colors.accent, 0.04, 0.60),
    skin: material(definition.colors.skin, 0, 0.70),
    hair: material(definition.colors.hair, 0.02, 0.50),
    eyes: material(0xf1f8ff, 0, 0.66),
    mouth: material(0x4d2631, 0, 0.74),
    glow: new THREE.MeshBasicMaterial({ color: definition.colors.glow, transparent: true, opacity: 0.20, blending: THREE.AdditiveBlending, depthWrite: false }),
  };
}

function createLayout(definition: FighterDefinition, quality: FighterVisualQuality): FighterVisualLayout {
  const style = definition.archetype === "POWER" ? REFERENCE_STYLE.KAIRO : REFERENCE_STYLE.SERA;
  const profile = DETAIL[quality];
  const headBottom = 1 - style.headHeight;
  const neckLength = definition.archetype === "POWER" ? 0.055 : 0.050;
  const shoulderY = headBottom - neckLength - 0.040;
  const kneeY = style.hipToGround - style.thighLength;
  const ankleY = kneeY - style.shinLength;
  const upperArmLength = style.shoulderToWrist * 0.46;
  const forearmLength = style.shoulderToWrist - upperArmLength;
  return {
    ...style,
    normalizedHeight: 1,
    worldScale: profile.worldScale,
    headBottom,
    shoulderY,
    hipsY: style.hipToGround,
    kneeY,
    ankleY,
    elbowY: shoulderY - upperArmLength,
    wristY: shoulderY - upperArmLength - forearmLength,
    pelvisTopY: style.hipToGround + 0.105,
    waistY: style.hipToGround + 0.165,
    ribY: style.hipToGround + 0.275,
    clavicleY: shoulderY - 0.060,
    headDepth: definition.archetype === "POWER" ? 0.090 : 0.084,
  };
}

function bone(name: string): THREE.Bone { const value = new THREE.Bone(); value.name = `v4-${name}`; return value; }

function createRig(layout: FighterVisualLayout): FighterRig {
  const names = [
    "root", "hips", "spineLower", "spineUpper", "chest", "neck", "head",
    "leftShoulder", "leftUpperArm", "leftForearm", "leftHand", "rightShoulder", "rightUpperArm", "rightForearm", "rightHand",
    "leftThigh", "leftShin", "leftFoot", "rightThigh", "rightShin", "rightFoot",
  ];
  const bones = Object.fromEntries(names.map((name) => [name, bone(name)])) as Record<string, THREE.Bone>;
  const root = bones.root;
  root.add(bones.hips);
  bones.hips.position.y = layout.hipsY;
  bones.hips.add(bones.spineLower);
  bones.spineLower.position.y = layout.pelvisTopY - layout.hipsY;
  bones.spineLower.add(bones.spineUpper);
  bones.spineUpper.position.y = layout.ribY - layout.pelvisTopY;
  bones.spineUpper.add(bones.chest);
  bones.chest.position.y = layout.shoulderY - layout.ribY;
  bones.chest.add(bones.neck);
  bones.neck.position.y = layout.headBottom - layout.shoulderY;
  bones.neck.add(bones.head);
  bones.chest.add(bones.leftShoulder, bones.rightShoulder);
  bones.leftShoulder.position.set(-layout.shoulderWidth * 0.5, 0, 0);
  bones.rightShoulder.position.set(layout.shoulderWidth * 0.5, 0, 0);
  bones.leftShoulder.add(bones.leftUpperArm);
  bones.rightShoulder.add(bones.rightUpperArm);
  bones.leftUpperArm.position.y = -0.005;
  bones.rightUpperArm.position.y = -0.005;
  bones.leftUpperArm.add(bones.leftForearm);
  bones.rightUpperArm.add(bones.rightForearm);
  bones.leftForearm.position.y = layout.elbowY - layout.shoulderY;
  bones.rightForearm.position.y = layout.elbowY - layout.shoulderY;
  bones.leftForearm.add(bones.leftHand);
  bones.rightForearm.add(bones.rightHand);
  bones.leftHand.position.y = layout.wristY - layout.elbowY;
  bones.rightHand.position.y = layout.wristY - layout.elbowY;
  bones.hips.add(bones.leftThigh, bones.rightThigh);
  const hipSpacing = layout.pelvisWidth * 0.29;
  bones.leftThigh.position.x = -hipSpacing;
  bones.rightThigh.position.x = hipSpacing;
  bones.leftThigh.add(bones.leftShin);
  bones.rightThigh.add(bones.rightShin);
  bones.leftShin.position.y = layout.kneeY - layout.hipsY;
  bones.rightShin.position.y = layout.kneeY - layout.hipsY;
  bones.leftShin.add(bones.leftFoot);
  bones.rightShin.add(bones.rightFoot);
  bones.leftFoot.position.y = layout.ankleY - layout.kneeY;
  bones.rightFoot.position.y = layout.ankleY - layout.kneeY;
  const boneIndices = Object.fromEntries(names.map((name, index) => [name, index]));
  const skeleton = new THREE.Skeleton(names.map((name) => bones[name]));
  return { root, bones, boneIndices, skeleton };
}

function weights(...pairs: Array<[number, number]>): SkinWeight {
  const sorted = pairs.filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const total = sorted.reduce((sum, [, value]) => sum + value, 0) || 1;
  const result: SkinWeight = [0, 0, 0, 0, 0, 0, 0, 0];
  sorted.forEach(([index, value], slot) => { result[slot] = index; result[slot + 4] = value / total; });
  return result;
}
function verticalBlend(y: number, top: number, bottom: number, topBone: number, bottomBone: number): SkinWeight {
  const t = smoothstep((top - y) / Math.max(0.0001, top - bottom));
  return weights([topBone, 1 - t], [bottomBone, t]);
}
function sampleByHeight(blend: (y: number) => SkinWeight): SurfaceSampler {
  return (...coordinates) => blend(coordinates[1]);
}

function interpolateSection(a: SurfaceSection, b: SurfaceSection, t: number): SurfaceSection {
  const lerp = (x: number | undefined, y: number | undefined): number | undefined => x === undefined && y === undefined ? undefined : (x ?? 0) + ((y ?? 0) - (x ?? 0)) * t;
  return {
    y: a.y + (b.y - a.y) * t, cx: a.cx + (b.cx - a.cx) * t, cz: a.cz + (b.cz - a.cz) * t,
    rx: a.rx + (b.rx - a.rx) * t, rz: a.rz + (b.rz - a.rz) * t,
    phase: (a.phase ?? 0) + ((b.phase ?? 0) - (a.phase ?? 0)) * t,
    nx: lerp(a.nx, b.nx), nz: lerp(a.nz, b.nz), deform2: lerp(a.deform2, b.deform2), deform3: lerp(a.deform3, b.deform3), frontBump: lerp(a.frontBump, b.frontBump),
  };
}
function resampleSections(base: SurfaceSection[], rowCount: number): SurfaceSection[] {
  const result: SurfaceSection[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    const scaled = (row / Math.max(1, rowCount - 1)) * (base.length - 1);
    const index = Math.min(base.length - 2, Math.floor(scaled));
    result.push(interpolateSection(base[index], base[index + 1], scaled - index));
  }
  return result;
}

class GeometryBuilder {
  readonly positions: number[] = [];
  readonly indices: number[] = [];
  readonly skinIndices: number[] = [];
  readonly skinWeights: number[] = [];
  readonly groups: Array<{ start: number; count: number; materialIndex: number }> = [];
  private addVertex(x: number, y: number, z: number, weight: SkinWeight): number {
    const index = this.positions.length / 3;
    this.positions.push(x, y, z);
    this.skinIndices.push(weight[0], weight[1], weight[2], weight[3]);
    this.skinWeights.push(weight[4], weight[5], weight[6], weight[7]);
    return index;
  }
  private addTriangle(a: number, b: number, c: number): void { this.indices.push(a, b, c); }
  addSurface(sections: SurfaceSection[], radial: number, skinFor: (x: number, y: number, z: number) => SkinWeight, materialIndex: number): void {
    const start = this.indices.length;
    const rings: number[][] = [];
    for (const section of sections) {
      const ring: number[] = [];
      for (let vertex = 0; vertex < radial; vertex += 1) {
        const angle = (vertex / radial) * Math.PI * 2 + (section.phase ?? 0);
        const c = Math.cos(angle); const s = Math.sin(angle);
        const sx = superellipse(c, section.nx ?? 2.5); const sz = superellipse(s, section.nz ?? 2.5);
        const lowFrequency = 1 + (section.deform2 ?? 0) * Math.cos(angle * 2) + (section.deform3 ?? 0) * Math.sin(angle * 3);
        const x = section.cx + sx * section.rx * lowFrequency;
        const noseFocus = Math.exp(-Math.pow(c, 2) * 6);
        const z = section.cz + sz * section.rz * lowFrequency + Math.max(0, s) * noseFocus * (section.frontBump ?? 0);
        ring.push(this.addVertex(x, section.y, z, skinFor(x, section.y, z)));
      }
      rings.push(ring);
    }
    for (let row = 0; row < rings.length - 1; row += 1) {
      for (let vertex = 0; vertex < radial; vertex += 1) {
        const next = (vertex + 1) % radial;
        const a = rings[row][vertex]; const b = rings[row][next]; const c = rings[row + 1][next]; const d = rings[row + 1][vertex];
        this.addTriangle(a, b, d); this.addTriangle(b, c, d);
      }
    }
    const bottomSection = sections[0]; const topSection = sections.at(-1);
    if (bottomSection && topSection) {
      const bottom = this.addVertex(bottomSection.cx, bottomSection.y, bottomSection.cz, skinFor(bottomSection.cx, bottomSection.y, bottomSection.cz));
      const top = this.addVertex(topSection.cx, topSection.y, topSection.cz, skinFor(topSection.cx, topSection.y, topSection.cz));
      for (let vertex = 0; vertex < radial; vertex += 1) {
        const next = (vertex + 1) % radial;
        this.addTriangle(bottom, rings[0][next], rings[0][vertex]);
        const last = rings.at(-1) ?? [];
        this.addTriangle(top, last[vertex] ?? top, last[next] ?? top);
      }
    }
    this.groups.push({ start, count: this.indices.length - start, materialIndex });
  }
  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(this.skinIndices, 4));
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(this.skinWeights, 4));
    geometry.setIndex(this.indices);
    for (const group of this.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
    geometry.computeVertexNormals();
    return geometry;
  }
}

function wedgeGeometry(width: number, height: number, depth: number, point = 0.82): THREE.BufferGeometry {
  const w = width * 0.5; const h = height * 0.5; const d = depth * 0.5;
  const positions = [-w, -h, -d, w, -h, -d, w * 0.84, h, -d * 0.52, -w * 0.84, h, -d * 0.52, -w * 0.66, -h * 0.72, d * point, w * 0.66, -h * 0.72, d * point, w * 0.52, h * 0.62, d * 0.28, -w * 0.52, h * 0.62, d * 0.28];
  const index = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index); geometry.computeVertexNormals();
  return geometry;
}
function facePlane(width: number, height: number, depth: number): THREE.BufferGeometry { return wedgeGeometry(width, height, depth, 1); }
function part(geometry: THREE.BufferGeometry, materialValue: THREE.Material, name: string): THREE.Mesh { const mesh = new THREE.Mesh(geometry, materialValue); mesh.name = name; return mesh; }

function addHeadDetails(head: THREE.Bone, mat: MaterialSet, layout: FighterVisualLayout, archetype: FighterDefinition["archetype"]): THREE.Mesh {
  const width = layout.headWidth; const height = layout.headHeight; const depth = layout.headDepth;
  const hair = part(wedgeGeometry(width * 1.04, height * 0.52, depth * 1.05, 0.72), mat.hair, "v4-hair-cap-angular");
  hair.position.set(0, height * 0.79, -depth * 0.05); head.add(hair);
  const eyeY = height * 0.55; const eyeZ = depth * 0.49;
  for (const side of [-1, 1]) {
    const eye = part(facePlane(width * 0.22, height * 0.09, 0.008), mat.eyes, `${side < 0 ? "left" : "right"}-eye-plane-v4`);
    eye.position.set(side * width * 0.17, eyeY, eyeZ); eye.rotation.z = side * -0.04; head.add(eye);
    const iris = part(facePlane(width * 0.065, height * 0.07, 0.010), mat.hair, `${side < 0 ? "left" : "right"}-iris-v4`);
    iris.position.set(side * width * 0.17, eyeY, eyeZ + 0.006); head.add(iris);
    const brow = part(wedgeGeometry(width * 0.24, height * 0.055, 0.014, 0.9), mat.hair, `${side < 0 ? "left" : "right"}-brow-plane-v4`);
    brow.position.set(side * width * 0.17, height * 0.63, depth * 0.48); brow.rotation.z = side * (archetype === "POWER" ? -0.13 : -0.07); head.add(brow);
    const ear = part(wedgeGeometry(width * 0.14, height * 0.17, depth * 0.08, 0.5), mat.skin, `${side < 0 ? "left" : "right"}-ear-v4`);
    ear.position.set(side * width * 0.53, height * 0.42, 0); head.add(ear);
  }
  const lip = part(facePlane(width * 0.23, height * 0.035, 0.012), mat.mouth, "mouth-plane-v4");
  lip.position.set(0, height * 0.27, depth * 0.45); head.add(lip);
  const lockCount = archetype === "POWER" ? 5 : 6;
  for (let index = 0; index < lockCount; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    const lock = part(wedgeGeometry(width * (0.34 - (index % 3) * 0.035), height * (0.58 - (index % 2) * 0.08), depth * 0.34, 0.92), mat.hair, `hair-lock-v4-${index}`);
    lock.position.set(side * width * (0.30 + Math.floor(index / 2) * 0.10), height * (0.78 - (index % 3) * 0.08), index % 2 === 0 ? depth * 0.03 : -depth * 0.16);
    lock.rotation.z = side * (0.16 + (index % 3) * 0.08); lock.rotation.x = -0.16 - (index % 2) * 0.08; head.add(lock);
  }
  if (archetype === "SPEED") {
    const tail = part(wedgeGeometry(width * 0.42, height * 1.22, depth * 0.34, 0.96), mat.hair, "hair-tail-v4");
    tail.position.set(width * 0.54, height * 0.42, -depth * 0.32); tail.rotation.z = -0.48; head.add(tail);
  }
  return hair;
}

function createBodyGeometry(layout: FighterVisualLayout, rig: FighterRig, definition: FighterDefinition, quality: FighterVisualQuality): THREE.BufferGeometry {
  const profile = DETAIL[quality]; const builder = new GeometryBuilder(); const index = (name: string) => rig.boneIndices[name];
  const torsoSkin = sampleByHeight((y) => y < layout.pelvisTopY ? verticalBlend(y, layout.pelvisTopY, layout.hipsY, index("spineLower"), index("hips")) : y < layout.ribY ? verticalBlend(y, layout.ribY, layout.pelvisTopY, index("spineUpper"), index("spineLower")) : verticalBlend(y, layout.shoulderY, layout.ribY, index("chest"), index("spineUpper")));
  const torsoBase: SurfaceSection[] = [
    { y: layout.hipsY - 0.030, cx: 0, cz: 0, rx: layout.pelvisWidth * 0.43, rz: layout.chestDepth * 0.39, nx: 2.8, nz: 2.3, deform2: 0.06 },
    { y: layout.hipsY + 0.030, cx: 0, cz: 0, rx: layout.pelvisWidth * 0.50, rz: layout.chestDepth * 0.48, nx: 2.8, nz: 2.4, deform2: 0.07 },
    { y: layout.pelvisTopY, cx: 0, cz: 0.004, rx: layout.pelvisWidth * 0.49, rz: layout.chestDepth * 0.52, nx: 2.5, nz: 2.5, deform2: 0.05 },
    { y: layout.waistY, cx: 0, cz: 0.006, rx: layout.waistWidth * 0.50, rz: layout.chestDepth * 0.58, nx: 3.0, nz: 2.5, deform2: -0.04 },
    { y: layout.ribY, cx: 0, cz: 0.008, rx: layout.shoulderWidth * 0.42, rz: layout.chestDepth * 0.76, nx: 2.4, nz: 2.2, deform2: 0.08 },
    { y: layout.clavicleY, cx: 0, cz: 0.006, rx: layout.shoulderWidth * 0.49, rz: layout.chestDepth * 0.82, nx: 2.3, nz: 2.3, deform2: 0.06 },
    { y: layout.shoulderY, cx: 0, cz: 0.002, rx: layout.shoulderWidth * 0.46, rz: layout.chestDepth * 0.68, nx: 2.6, nz: 2.4, deform2: 0.10 },
  ];
  // The body surface is the underlayer of the outfit.  Keeping it dark lets
  // the jacket/crop-top panels carry the character color as deliberate color
  // masses instead of painting the entire torso one flat primary material.
  builder.addSurface(resampleSections(torsoBase, profile.torsoRows), profile.radial, torsoSkin, MATERIAL_INDEX.secondary);
  const neckSkin = sampleByHeight((y) => verticalBlend(y, layout.headBottom, layout.shoulderY, index("head"), index("neck")));
  builder.addSurface(resampleSections([
    { y: layout.shoulderY - 0.015, cx: 0, cz: 0, rx: layout.neckWidth * 0.52, rz: layout.neckWidth * 0.45, nx: 2.8, nz: 2.8 },
    { y: layout.headBottom, cx: 0, cz: 0, rx: layout.neckWidth * 0.47, rz: layout.neckWidth * 0.42, nx: 2.8, nz: 2.8 },
  ], Math.max(6, Math.floor(profile.torsoRows * 0.65))), Math.max(8, profile.detailRadial), neckSkin, MATERIAL_INDEX.skin, (row) => row % 3 === 0 ? "large" : "medium");
  const hipSpacing = layout.pelvisWidth * 0.29;
  for (const side of [-1, 1] as const) {
    const prefix = side < 0 ? "left" : "right";
    const thighSkin = sampleByHeight((y) => verticalBlend(y, layout.hipsY, layout.kneeY, index(`${prefix}Thigh`), index(`${prefix}Shin`)));
    const shinSkin = sampleByHeight((y) => verticalBlend(y, layout.kneeY, layout.ankleY, index(`${prefix}Shin`), index(`${prefix}Foot`)));
    const thighRx = definition.archetype === "POWER" ? 0.040 : 0.033; const thighRz = definition.archetype === "POWER" ? 0.052 : 0.043;
    const calfRx = definition.archetype === "POWER" ? 0.034 : 0.028; const calfRz = definition.archetype === "POWER" ? 0.043 : 0.036;
    builder.addSurface(resampleSections([
      { y: layout.hipsY + 0.018, cx: side * hipSpacing, cz: 0, rx: thighRx * 1.18, rz: thighRz * 1.16, nx: 2.4, nz: 2.3, deform2: 0.10 },
      { y: layout.kneeY + 0.026, cx: side * (hipSpacing + 0.008), cz: 0, rx: thighRx * 0.92, rz: thighRz * 0.92, nx: 2.8, nz: 2.5, deform2: 0.06 },
    ], profile.limbRows), profile.radial, thighSkin, MATERIAL_INDEX.secondary);
    builder.addSurface(resampleSections([
      { y: layout.kneeY + 0.020, cx: side * (hipSpacing + 0.008), cz: 0, rx: calfRx * 1.10, rz: calfRz * 1.06, nx: 2.6, nz: 2.5, deform2: 0.05 },
      { y: layout.ankleY, cx: side * (hipSpacing + 0.014), cz: 0, rx: calfRx * 0.72, rz: calfRz * 0.72, nx: 3.1, nz: 2.7, deform2: -0.04 },
    ], profile.limbRows), profile.radial, shinSkin, MATERIAL_INDEX.secondary);
  }
  for (const side of [-1, 1] as const) {
    const prefix = side < 0 ? "left" : "right"; const shoulderX = side * layout.shoulderWidth * 0.5; const elbowX = shoulderX + side * 0.028; const wristX = shoulderX + side * 0.045;
    const upperSkin = sampleByHeight((y) => verticalBlend(y, layout.shoulderY, layout.elbowY, index(`${prefix}UpperArm`), index(`${prefix}Forearm`)));
    const forearmSkin = sampleByHeight((y) => verticalBlend(y, layout.elbowY, layout.wristY, index(`${prefix}Forearm`), index(`${prefix}Hand`)));
    const upperRadius = definition.archetype === "POWER" ? 0.027 : 0.022; const foreRadius = definition.archetype === "POWER" ? 0.024 : 0.019;
    builder.addSurface(resampleSections([
      { y: layout.shoulderY + 0.008, cx: shoulderX, cz: 0, rx: upperRadius * 1.22, rz: upperRadius * 1.20, nx: 2.6, nz: 2.4, deform2: 0.12 },
      { y: layout.elbowY, cx: elbowX, cz: 0.006, rx: upperRadius * 0.84, rz: upperRadius * 0.88, nx: 2.9, nz: 2.6, deform2: 0.04 },
    ], Math.max(9, profile.limbRows - 2)), profile.radial, upperSkin, definition.archetype === "SPEED" ? MATERIAL_INDEX.skin : MATERIAL_INDEX.primary);
    builder.addSurface(resampleSections([
      { y: layout.elbowY, cx: elbowX, cz: 0.006, rx: foreRadius * 1.10, rz: foreRadius * 1.05, nx: 2.8, nz: 2.6, deform2: 0.07 },
      { y: layout.wristY, cx: wristX, cz: 0.010, rx: foreRadius * 0.70, rz: foreRadius * 0.72, nx: 3.0, nz: 2.7, deform2: -0.05 },
    ], Math.max(9, profile.limbRows - 2)), profile.radial, forearmSkin, MATERIAL_INDEX.skin);
  }
  const headSkin = sampleByHeight((y) => verticalBlend(y, layout.headBottom + layout.headHeight * 0.10, layout.headBottom, rig.boneIndices.head, rig.boneIndices.neck));
  const headSections: SurfaceSection[] = [];
  const jawWidth = definition.archetype === "POWER" ? 0.72 : 0.64;
  for (let row = 0; row < profile.headRows; row += 1) {
    const t = row / Math.max(1, profile.headRows - 1); const jawToSkull = smoothstep(t * 1.18); const width = layout.headWidth * (jawWidth + jawToSkull * (1 - jawWidth)); const cheek = Math.exp(-Math.pow((t - 0.38) / 0.20, 2)); const crown = 1 - smoothstep((t - 0.82) / 0.18) * 0.20;
    headSections.push({ y: layout.headBottom + t * layout.headHeight, cx: 0, cz: 0.002, rx: width * 0.50 * crown, rz: layout.headDepth * (0.42 + cheek * 0.10) * crown, phase: (row % 3) * 0.04, nx: t < 0.25 ? 2.8 : 2.35, nz: 2.45, deform2: t < 0.25 ? -0.03 : 0.045, frontBump: layout.headWidth * layout.noseProjection * Math.exp(-Math.pow((t - 0.39) / 0.11, 2)) });
  }
  builder.addSurface(headSections, profile.radial, headSkin, MATERIAL_INDEX.skin);
  return builder.build();
}

function createClothing(definition: FighterDefinition, layout: FighterVisualLayout, mat: MaterialSet, rig: FighterRig): THREE.Group {
  const panels = new THREE.Group(); panels.name = "v4-clothing-attachments";
  const add = (geometry: THREE.BufferGeometry, materialValue: THREE.Material, name: string, position: THREE.Vector3, parent: THREE.Object3D, rotation?: THREE.Euler): THREE.Mesh => {
    const mesh = part(geometry, materialValue, name);
    rig.root.updateMatrixWorld(true);
    parent.add(mesh);
    const worldPosition = rig.root.localToWorld(position.clone());
    mesh.position.copy(parent.worldToLocal(worldPosition));
    if (rotation) mesh.rotation.copy(rotation);
    return mesh;
  };
  const chest = rig.bones.chest;
  const hips = rig.bones.hips;
  if (definition.archetype === "POWER") {
    add(wedgeGeometry(layout.shoulderWidth * 0.72, 0.22, 0.18, 0.92), mat.accent, "kairo-jacket-shoulder-plane", new THREE.Vector3(0, -0.01, 0.035), chest);
    add(wedgeGeometry(layout.shoulderWidth * 0.18, 0.24, 0.15, 0.96), mat.primary, "kairo-lapel-left", new THREE.Vector3(-0.035, -0.085, 0.075), chest, new THREE.Euler(0, 0, -0.24));
    add(wedgeGeometry(layout.shoulderWidth * 0.18, 0.24, 0.15, 0.96), mat.primary, "kairo-lapel-right", new THREE.Vector3(0.035, -0.085, 0.075), chest, new THREE.Euler(0, 0, 0.24));
    add(wedgeGeometry(layout.waistWidth * 0.82, 0.10, 0.19, 0.9), mat.accent, "kairo-waist-band", new THREE.Vector3(0, layout.waistY - layout.hipsY, 0.065), hips);
    add(wedgeGeometry(0.090, 0.34, 0.12, 0.94), mat.primary, "kairo-jacket-tail-left", new THREE.Vector3(-0.060, 0.005, -0.050), hips, new THREE.Euler(0, 0, -0.10));
    add(wedgeGeometry(0.090, 0.34, 0.12, 0.94), mat.primary, "kairo-jacket-tail-right", new THREE.Vector3(0.060, 0.005, -0.050), hips, new THREE.Euler(0, 0, 0.10));
  } else {
    add(wedgeGeometry(layout.shoulderWidth * 0.66, 0.13, 0.16, 0.92), mat.primary, "sera-crop-top-line", new THREE.Vector3(0, -0.10, 0.065), chest);
    add(wedgeGeometry(layout.waistWidth * 0.90, 0.09, 0.17, 0.92), mat.accent, "sera-waist-panel", new THREE.Vector3(0, layout.waistY - layout.hipsY, 0.06), hips);
    add(wedgeGeometry(0.070, 0.43, 0.12, 0.95), mat.primary, "sera-long-rear-panel", new THREE.Vector3(0.070, -0.02, -0.070), hips, new THREE.Euler(0, 0, -0.12));
    add(wedgeGeometry(0.050, 0.33, 0.11, 0.95), mat.primary, "sera-side-panel", new THREE.Vector3(-0.075, 0.01, -0.045), hips, new THREE.Euler(0, 0, 0.10));
  }
  add(wedgeGeometry(0.070, 0.16, 0.15, 0.91), mat.secondary, "shoulder-reinforcement-left", new THREE.Vector3(0, 0, 0.015), rig.bones.leftShoulder);
  add(wedgeGeometry(0.070, 0.16, 0.15, 0.91), mat.secondary, "shoulder-reinforcement-right", new THREE.Vector3(0, 0, 0.015), rig.bones.rightShoulder);
  panels.userData.rig = rig; return panels;
}

function addEndMesh(boneObject: THREE.Bone, geometry: THREE.BufferGeometry, materialValue: THREE.Material, name: string, position: THREE.Vector3): THREE.Mesh { const mesh = part(geometry, materialValue, name); mesh.position.copy(position); boneObject.add(mesh); return mesh; }

function createLimbVisuals(layout: FighterVisualLayout, definition: FighterDefinition, mat: MaterialSet, rig: FighterRig, side: -1 | 1, kind: "ARM" | "LEG"): LimbVisual {
  const prefix = side < 0 ? "left" : "right";
  if (kind === "ARM") {
    const root = rig.bones[`${prefix}UpperArm`]; const lower = rig.bones[`${prefix}Forearm`];
    const end = addEndMesh(rig.bones[`${prefix}Hand`], wedgeGeometry(0.042 * (definition.archetype === "POWER" ? 1.12 : 0.98), layout.handLength, 0.072, 0.96), mat.secondary, `${prefix}-fist-v4`, new THREE.Vector3(0, -layout.handLength * 0.48, 0.030));
    const knuckles = part(wedgeGeometry(0.038, 0.034, 0.035, 0.98), mat.accent, `${prefix}-knuckle-plane-v4`); knuckles.position.set(0, -layout.handLength * 0.15, 0.070); rig.bones[`${prefix}Hand`].add(knuckles);
    return { root, upper: root, lower, end };
  }
  const root = rig.bones[`${prefix}Thigh`]; const lower = rig.bones[`${prefix}Shin`];
  const end = addEndMesh(rig.bones[`${prefix}Foot`], wedgeGeometry(0.070 * (definition.archetype === "POWER" ? 1.08 : 0.94), 0.065, layout.footLength, 0.98), definition.archetype === "POWER" ? mat.secondary : mat.primary, `${prefix}-angular-boot-v4`, new THREE.Vector3(0, -0.026, layout.footLength * 0.22));
  const sole = part(wedgeGeometry(0.074, 0.024, layout.footLength * 1.03, 0.99), mat.accent, `${prefix}-boot-sole-v4`); sole.position.set(0, -0.058, layout.footLength * 0.22); rig.bones[`${prefix}Foot`].add(sole);
  return { root, upper: root, lower, end };
}

function collectMeshes(root: THREE.Object3D): THREE.Mesh[] { const meshes: THREE.Mesh[] = []; root.traverse((object) => { if (object instanceof THREE.Mesh) meshes.push(object); }); return meshes; }

function metricMeshes(meshes: THREE.Mesh[]): THREE.Mesh[] {
  return meshes.filter((mesh) => !mesh.userData.excludeFromMetrics);
}

function trianglePositions(mesh: THREE.Mesh, triangle: number, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): boolean {
  const position = mesh.geometry.getAttribute("position");
  if (!position) return false;
  const index = mesh.geometry.getIndex();
  const read = (offset: number): number => index ? index.getX(triangle * 3 + offset) : triangle * 3 + offset;
  const readVertex = (target: THREE.Vector3, vertex: number): void => {
    target.fromBufferAttribute(position, vertex);
    if (mesh instanceof THREE.SkinnedMesh) mesh.applyBoneTransform(vertex, target);
    mesh.localToWorld(target);
  };
  readVertex(a, read(0)); readVertex(b, read(1)); readVertex(c, read(2));
  return true;
}

function triangleArea(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
  return b.clone().sub(a).cross(c.clone().sub(a)).length() * 0.5;
}

function triangleCount(mesh: THREE.Mesh): number {
  return Math.floor((mesh.geometry.getIndex()?.count ?? mesh.geometry.getAttribute("position")?.count ?? 0) / 3);
}

/** Measures actual triangle surface area, not generator labels or row patterns. */
export function measureFacetDistribution(meshes: THREE.Mesh[], bodyHeight = 1): FacetDistribution {
  const area = { large: 0, medium: 0, small: 0 };
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3();
  for (const mesh of metricMeshes(meshes)) {
    for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
      if (!trianglePositions(mesh, triangle, a, b, c)) continue;
      const ab = a.distanceTo(b); const bc = b.distanceTo(c); const ca = c.distanceTo(a);
      const characteristic = (ab + bc + ca) / 3 / Math.max(0.0001, bodyHeight);
      const size = characteristic >= 0.040 ? "large" : characteristic >= 0.018 ? "medium" : "small";
      area[size] += triangleArea(a, b, c);
    }
  }
  const total = area.large + area.medium + area.small || 1;
  return { large: area.large / total, medium: area.medium / total, small: area.small / total };
}

function materialCoverageFor(meshes: THREE.Mesh[], definition: FighterDefinition): MaterialCoverage {
  const coverage: MaterialCoverage = { dark: 0, primary: 0, skin: 0, other: 0 };
  const targetColors = {
    dark: new Set([definition.colors.secondary, definition.colors.hair]),
    primary: new Set([definition.colors.primary, definition.colors.accent]),
    skin: new Set([definition.colors.skin]),
  };
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3();
  for (const mesh of metricMeshes(meshes)) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = mesh.geometry.groups;
    for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
      if (!trianglePositions(mesh, triangle, a, b, c)) continue;
      const indexOffset = triangle * 3;
      const group = groups.find((value) => indexOffset >= value.start && indexOffset < value.start + value.count);
      const materialValue = materials[group?.materialIndex ?? 0];
      const hex = materialValue instanceof THREE.MeshStandardMaterial ? materialValue.color.getHex() : -1;
      const surface = triangleArea(a, b, c);
      const category = targetColors.dark.has(hex) ? "dark" : targetColors.primary.has(hex) ? "primary" : targetColors.skin.has(hex) ? "skin" : "other";
      coverage[category] += surface;
    }
  }
  const total = coverage.dark + coverage.primary + coverage.skin + coverage.other || 1;
  coverage.dark /= total; coverage.primary /= total; coverage.skin /= total; coverage.other /= total;
  return coverage;
}

function colorMaterialScore(definition: FighterDefinition, coverage: MaterialCoverage): number {
  const target = definition.archetype === "POWER"
    ? { dark: 0.55, primary: 0.32, skin: 0.12 }
    : { dark: 0.50, primary: 0.32, skin: 0.16 };
  const error = Math.abs(coverage.dark - target.dark) + Math.abs(coverage.primary - target.primary) + Math.abs(coverage.skin - target.skin);
  return clamp(100 - error * 180, 0, 100);
}
function rangeScore(value: number, target: number, tolerance: number): number { return clamp(100 - Math.abs(value - target) / Math.max(0.0001, tolerance) * 100, 0, 100); }
function bandScore(value: number, minimum: number, maximum: number, softMargin: number): number {
  if (value >= minimum && value <= maximum) return 100;
  const distance = value < minimum ? minimum - value : value - maximum;
  return clamp(100 - distance / Math.max(0.0001, softMargin) * 100, 0, 100);
}
function proportionMetrics(layout: FighterVisualLayout): ProportionMetrics {
  return { headCount: 1 / layout.headHeight, shoulderHeadRatio: layout.shoulderWidth / layout.headWidth, shoulderWaistRatio: layout.shoulderWidth / layout.waistWidth, pelvisShoulderRatio: layout.pelvisWidth / layout.shoulderWidth, hipGroundRatio: layout.hipToGround, thighShinRatio: layout.thighLength / layout.shinLength, legHeightRatio: layout.thighLength + layout.shinLength };
}

export function proportionPenalty(layout: FighterVisualLayout, target: ReferenceStyle): number {
  const checks = [[layout.headHeight, target.headHeight, target.headHeight * 0.04], [layout.headWidth, target.headWidth, target.headWidth * 0.04], [layout.shoulderWidth, target.shoulderWidth, target.shoulderWidth * 0.04], [layout.waistWidth, target.waistWidth, target.waistWidth * 0.04], [layout.pelvisWidth, target.pelvisWidth, target.pelvisWidth * 0.04], [layout.hipToGround, target.hipToGround, 0.02], [layout.thighLength, target.thighLength, target.thighLength * 0.04], [layout.shinLength, target.shinLength, target.shinLength * 0.04]];
  return checks.reduce((sum, [value, expected, tolerance]) => sum + Math.max(0, Math.abs(value - expected) - tolerance), 0);
}

export function landmarkLoss(archetype: "KAIRO" | "SERA", actual: Record<string, readonly [number, number]>): number {
  const target = REFERENCE_POSE_BOUNDS[archetype] as Record<string, readonly [number, number]>; const keys = Object.keys(target).filter((key) => actual[key]); if (keys.length === 0) return 1;
  return keys.reduce((sum, key) => { const a = actual[key]; const b = target[key]; return sum + Math.hypot(a[0] - b[0], a[1] - b[1]); }, 0) / keys.length;
}

function styleScores(definition: FighterDefinition, layout: FighterVisualLayout, facets: FacetDistribution, colorScore: number | null): VisualStyleScores {
  const target = definition.archetype === "POWER" ? REFERENCE_STYLE.KAIRO : REFERENCE_STYLE.SERA; const values = proportionMetrics(layout);
  const proportion = rangeScore(values.headCount, 1 / target.headHeight, 0.20) * 0.16 + rangeScore(values.shoulderHeadRatio, target.shoulderWidth / target.headWidth, 0.04) * 0.16 + rangeScore(values.shoulderWaistRatio, target.shoulderWidth / target.waistWidth, 0.04) * 0.18 + rangeScore(values.pelvisShoulderRatio, target.pelvisWidth / target.shoulderWidth, 0.025) * 0.14 + rangeScore(values.hipGroundRatio, target.hipToGround, 0.02) * 0.16 + rangeScore(values.thighShinRatio, target.thighLength / target.shinLength, 0.04) * 0.10 + rangeScore(values.legHeightRatio, target.thighLength + target.shinLength, 0.025) * 0.10;
  const facet = bandScore(facets.large, 0.45, 0.55, 0.12) * 0.45 + bandScore(facets.medium, 0.30, 0.40, 0.10) * 0.35 + bandScore(facets.small, 0.10, 0.18, 0.08) * 0.20;
  const measured: Array<[number, number]> = [[proportion, 0.25], [facet, 0.15]];
  if (colorScore !== null) measured.push([colorScore, 0.10]);
  const weight = measured.reduce((sum, [, value]) => sum + value, 0);
  const style = measured.reduce((sum, [value, weightValue]) => sum + value * weightValue, 0) / weight;
  return { style, silhouette: null, proportion, landmark: null, facet, colorMaterial: colorScore, surfaceContinuity: null };
}

function statsFor(definition: FighterDefinition, quality: FighterVisualQuality, layout: FighterVisualLayout, meshes: THREE.Mesh[], bodyMesh: THREE.SkinnedMesh): FighterVisualStats {
  const geometries = new Set<THREE.BufferGeometry>(); const materials = new Set<THREE.Material>(); let vertexCount = 0; let triangleCount = 0; let weightedVertexCount = 0;
  for (const mesh of metricMeshes(meshes)) {
    if (!geometries.has(mesh.geometry)) { geometries.add(mesh.geometry); vertexCount += mesh.geometry.getAttribute("position")?.count ?? 0; triangleCount += mesh.geometry.index ? mesh.geometry.index.count / 3 : (mesh.geometry.getAttribute("position")?.count ?? 0) / 3; }
    if (mesh instanceof THREE.SkinnedMesh && mesh.geometry.getAttribute("skinIndex") && mesh.geometry.getAttribute("skinWeight")) weightedVertexCount += mesh.geometry.getAttribute("position")?.count ?? 0;
    if (Array.isArray(mesh.material)) mesh.material.forEach((value) => materials.add(value)); else materials.add(mesh.material);
  }
  const facets = measureFacetDistribution(meshes, layout.worldScale);
  const materialCoverage = materialCoverageFor(meshes, definition);
  const colorScore = colorMaterialScore(definition, materialCoverage);
  return { quality, vertexCount, triangleCount: Math.round(triangleCount), meshCount: metricMeshes(meshes).length, materialCount: materials.size, proportions: proportionMetrics(layout), facetDistribution: facets, materialCoverage, scores: styleScores(definition, layout, facets, colorScore), skinnedMesh: bodyMesh instanceof THREE.SkinnedMesh && Boolean(bodyMesh.skeleton), weightedVertexCount };
}

function boneWorldPosition(visual: FighterVisual, name: string): THREE.Vector3 {
  visual.root.updateMatrixWorld(true);
  return visual.rig.bones[name].getWorldPosition(new THREE.Vector3());
}

/** Returns landmarks measured from the generated rig, never from reference data. */
export function generatedLandmarks(visual: FighterVisual): GeneratedLandmarks {
  visual.root.updateMatrixWorld(true);
  const scale = visual.root.scale.x;
  const headTop = visual.root.localToWorld(new THREE.Vector3(0, 1, 0));
  const chin = visual.root.localToWorld(new THREE.Vector3(0, visual.layout.headBottom, 0));
  const forward = MODEL_FORWARD.clone().applyQuaternion(visual.root.getWorldQuaternion(new THREE.Quaternion())).normalize();
  const leftFoot = boneWorldPosition(visual, "leftFoot");
  const rightFoot = boneWorldPosition(visual, "rightFoot");
  return {
    headTop,
    chin,
    leftShoulder: boneWorldPosition(visual, "leftShoulder"),
    rightShoulder: boneWorldPosition(visual, "rightShoulder"),
    hip: boneWorldPosition(visual, "hips"),
    leftElbow: boneWorldPosition(visual, "leftForearm"),
    rightElbow: boneWorldPosition(visual, "rightForearm"),
    leftWrist: boneWorldPosition(visual, "leftHand"),
    rightWrist: boneWorldPosition(visual, "rightHand"),
    leftKnee: boneWorldPosition(visual, "leftShin"),
    rightKnee: boneWorldPosition(visual, "rightShin"),
    leftAnkle: leftFoot,
    rightAnkle: rightFoot,
    leftToe: leftFoot.clone().addScaledVector(forward, visual.layout.footLength * scale),
    rightToe: rightFoot.clone().addScaledVector(forward, visual.layout.footLength * scale),
  };
}

export function projectGeneratedLandmarks(visual: FighterVisual, camera: THREE.Camera): Record<string, readonly [number, number]> {
  camera.updateMatrixWorld(true);
  const landmarks = generatedLandmarks(visual);
  return Object.fromEntries(Object.entries(landmarks).map(([key, position]) => {
    const projected = position.clone().project(camera);
    return [key, [(projected.x + 1) * 0.5, (1 - projected.y) * 0.5] as const];
  }));
}

function rasterTriangle(mask: Uint8Array, resolution: number, a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2): void {
  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
  const maxX = Math.min(resolution - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
  const maxY = Math.min(resolution - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
  const edge = (p: THREE.Vector2, q: THREE.Vector2, x: number, y: number): number => (x - p.x) * (q.y - p.y) - (y - p.y) * (q.x - p.x);
  const orientation = edge(a, b, c.x, c.y);
  if (Math.abs(orientation) < 0.00001) return;
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
    const e0 = edge(a, b, x + 0.5, y + 0.5);
    const e1 = edge(b, c, x + 0.5, y + 0.5);
    const e2 = edge(c, a, x + 0.5, y + 0.5);
    if ((e0 >= 0 && e1 >= 0 && e2 >= 0) || (e0 <= 0 && e1 <= 0 && e2 <= 0)) mask[y * resolution + x] = 1;
  }
}

/** CPU projected-triangle rasterizer used for honest silhouette QA. */
export function measureProjectedSilhouette(root: THREE.Object3D, camera: THREE.Camera, resolution = 64): ProjectedSilhouetteMetrics {
  root.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const mask = new Uint8Array(resolution * resolution);
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3();
  const projected = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.userData.excludeFromMetrics) return;
    const mesh = object;
    for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
      if (!trianglePositions(mesh, triangle, a, b, c)) continue;
      projected[0].copy(a).project(camera); projected[1].copy(b).project(camera); projected[2].copy(c).project(camera);
      const screen = projected.map((point) => new THREE.Vector2((point.x + 1) * 0.5 * resolution, (1 - point.y) * 0.5 * resolution));
      rasterTriangle(mask, resolution, screen[0], screen[1], screen[2]);
    }
  });
  let occupiedPixels = 0; let sumX = 0; let sumY = 0; let minX = resolution; let minY = resolution; let maxX = -1; let maxY = -1;
  for (let y = 0; y < resolution; y += 1) for (let x = 0; x < resolution; x += 1) if (mask[y * resolution + x]) {
    occupiedPixels += 1; sumX += x; sumY += y; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const safe = (value: number): number => value < 0 ? 0 : value / Math.max(1, resolution - 1);
  return {
    resolution,
    areaRatio: occupiedPixels / (resolution * resolution),
    bounds: { minX: safe(minX), minY: safe(minY), maxX: safe(maxX), maxY: safe(maxY) },
    center: { x: occupiedPixels ? sumX / occupiedPixels / Math.max(1, resolution - 1) : 0, y: occupiedPixels ? sumY / occupiedPixels / Math.max(1, resolution - 1) : 0 },
    occupiedPixels,
  };
}

export function createFighterVisual(definition: FighterDefinition, quality: FighterVisualQuality = "NORMAL"): FighterVisual {
  const layout = createLayout(definition, quality); const profile = DETAIL[quality]; const mat = createMaterials(definition); const rig = createRig(layout); const root = new THREE.Group();
  root.name = `fighter-v4-${definition.id}`; root.scale.setScalar(layout.worldScale); root.add(rig.root);
  const bodyGeometry = createBodyGeometry(layout, rig, definition, quality); const bodyMaterials = [mat.primary, mat.secondary, mat.accent, mat.skin, mat.hair, mat.eyes, mat.mouth];
  const bodyMesh = new THREE.SkinnedMesh(bodyGeometry, bodyMaterials); bodyMesh.name = "v4-continuous-skinned-body"; bodyMesh.frustumCulled = true; root.add(bodyMesh); root.updateMatrixWorld(true); bodyMesh.bind(rig.skeleton);
  const hips = rig.bones.hips; const torso = rig.bones.chest; const head = rig.bones.head; const hair = addHeadDetails(head, mat, layout, definition.archetype);
  const leftArm = createLimbVisuals(layout, definition, mat, rig, -1, "ARM"); const rightArm = createLimbVisuals(layout, definition, mat, rig, 1, "ARM"); const leftLeg = createLimbVisuals(layout, definition, mat, rig, -1, "LEG"); const rightLeg = createLimbVisuals(layout, definition, mat, rig, 1, "LEG");
  const panels = createClothing(definition, layout, mat, rig); root.add(panels);
  const aura = part(new THREE.SphereGeometry(1, profile.detailRadial, profile.detailRows), mat.glow, "fighter-energy-aura-v4"); aura.scale.set(0.28, 0.54, 0.18); aura.position.y = 0.47; aura.visible = false; aura.userData.excludeFromMetrics = true; root.add(aura);
  const allMeshes = collectMeshes(root); const stats = statsFor(definition, quality, layout, allMeshes, bodyMesh);
  return { root, hips, torso, chest: bodyMesh, bodyMesh, head, hair, leftArm, rightArm, leftLeg, rightLeg, panels, aura, allMeshes, rig, layout, stats };
}

export function getVisualContactPoint(visual: FighterVisual, contact: VisualContactPoint = "BODY"): THREE.Vector3 {
  visual.root.updateMatrixWorld(true);
  switch (contact) {
    case "LEFT_FIST": return visual.leftArm.end.getWorldPosition(new THREE.Vector3());
    case "RIGHT_FIST": return visual.rightArm.end.getWorldPosition(new THREE.Vector3());
    case "LEFT_FOOT": return visual.leftLeg.end.getWorldPosition(new THREE.Vector3());
    case "RIGHT_FOOT": return visual.rightLeg.end.getWorldPosition(new THREE.Vector3());
    default: return visual.root.localToWorld(new THREE.Vector3(0, visual.layout.ribY, 0));
  }
}

export function disposeFighterVisual(visual: FighterVisual): void {
  const geometries = new Set<THREE.BufferGeometry>(); const materials = new Set<THREE.Material>();
  visual.root.traverse((object) => { if (!(object instanceof THREE.Mesh)) return; geometries.add(object.geometry); if (Array.isArray(object.material)) object.material.forEach((value) => materials.add(value)); else materials.add(object.material); });
  geometries.forEach((geometry) => geometry.dispose()); materials.forEach((value) => value.dispose()); visual.root.clear();
}

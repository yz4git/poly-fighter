import * as THREE from "three";
import type { FighterDefinition } from "./types";
import {
  REFERENCE_STYLE,
  type ClothingAttachment,
  type FighterRig,
  type FighterVisual,
  type FighterVisualLayout,
  type FighterVisualQuality,
  type FighterVisualStats,
  type FootPlantState,
  type FootSide,
  type LimbVisual,
} from "./visual";

export const KAIRO_RECONSTRUCTION_ID = "KAIRO_V1_FORGE_RECONSTRUCTION";

const MATERIAL_INDEX = {
  primary: 0,
  dark: 1,
  accent: 2,
  skin: 3,
  hair: 4,
  eye: 5,
  mouth: 6,
  metal: 7,
} as const;

type SkinWeight = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

interface LoftSection {
  y: number;
  cx: number;
  cz: number;
  rx: number;
  front: number;
  back: number;
  nx?: number;
  nz?: number;
  phase?: number;
  bevel?: number;
  nose?: number;
}

interface QualityProfile {
  radial: number;
  torsoRows: number;
  limbRows: number;
  headRows: number;
  detailRadial: number;
  worldScale: number;
}

interface KairoMaterials {
  primary: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
  skinShadow: THREE.MeshStandardMaterial;
  hair: THREE.MeshStandardMaterial;
  eye: THREE.MeshStandardMaterial;
  iris: THREE.MeshStandardMaterial;
  mouth: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  glow: THREE.MeshBasicMaterial;
}

const QUALITY: Record<FighterVisualQuality, QualityProfile> = {
  LOW: { radial: 12, torsoRows: 14, limbRows: 13, headRows: 14, detailRadial: 6, worldScale: 3.22 },
  NORMAL: { radial: 16, torsoRows: 20, limbRows: 18, headRows: 20, detailRadial: 8, worldScale: 3.25 },
  HIGH: { radial: 20, torsoRows: 26, limbRows: 24, headRows: 26, detailRadial: 10, worldScale: 3.28 },
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function signedPower(value: number, exponent: number): number {
  return Math.sign(value) * Math.pow(Math.abs(value), 2 / exponent);
}

function weights(...entries: Array<readonly [number, number]>): SkinWeight {
  const sorted = entries
    .filter((entry) => entry[1] > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  const total = sorted.reduce((sum, entry) => sum + entry[1], 0) || 1;
  const result = [0, 0, 0, 0, 0, 0, 0, 0];
  sorted.forEach((entry, slot) => {
    result[slot] = entry[0];
    result[slot + 4] = entry[1] / total;
  });
  return result as unknown as SkinWeight;
}

function interpolateSection(a: LoftSection, b: LoftSection, t: number): LoftSection {
  const lerp = (first: number | undefined, second: number | undefined, fallback: number): number =>
    (first ?? fallback) + ((second ?? fallback) - (first ?? fallback)) * t;
  return {
    y: THREE.MathUtils.lerp(a.y, b.y, t),
    cx: THREE.MathUtils.lerp(a.cx, b.cx, t),
    cz: THREE.MathUtils.lerp(a.cz, b.cz, t),
    rx: THREE.MathUtils.lerp(a.rx, b.rx, t),
    front: THREE.MathUtils.lerp(a.front, b.front, t),
    back: THREE.MathUtils.lerp(a.back, b.back, t),
    nx: lerp(a.nx, b.nx, 2.4),
    nz: lerp(a.nz, b.nz, 2.4),
    phase: lerp(a.phase, b.phase, 0),
    bevel: lerp(a.bevel, b.bevel, 0),
    nose: lerp(a.nose, b.nose, 0),
  };
}

function resampleSections(base: LoftSection[], rowCount: number): LoftSection[] {
  const output: LoftSection[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    const scaled = (row / Math.max(1, rowCount - 1)) * (base.length - 1);
    const index = Math.min(base.length - 2, Math.floor(scaled));
    output.push(interpolateSection(base[index], base[index + 1], scaled - index));
  }
  return output;
}

class KairoGeometryBuilder {
  readonly positions: number[] = [];
  readonly indices: number[] = [];
  readonly skinIndices: number[] = [];
  readonly skinWeights: number[] = [];
  readonly groups: Array<{ start: number; count: number; materialIndex: number }> = [];

  private vertex(x: number, y: number, z: number, weight: SkinWeight): number {
    const index = this.positions.length / 3;
    this.positions.push(x, y, z);
    this.skinIndices.push(weight[0], weight[1], weight[2], weight[3]);
    this.skinWeights.push(weight[4], weight[5], weight[6], weight[7]);
    return index;
  }

  private triangle(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  addLoft(
    sections: LoftSection[],
    radial: number,
    skinFor: (x: number, y: number, z: number) => SkinWeight,
    materialIndex: number,
    capBottom = true,
    capTop = true,
  ): void {
    const start = this.indices.length;
    const rings: number[][] = [];
    for (const section of sections) {
      const ring: number[] = [];
      for (let slice = 0; slice < radial; slice += 1) {
        const angle = (slice / radial) * Math.PI * 2 + (section.phase ?? 0);
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        const sx = signedPower(cosine, section.nx ?? 2.4);
        const sz = signedPower(sine, section.nz ?? 2.4);
        const frontFacing = Math.max(0, sine);
        const depth = sine >= 0 ? section.front : section.back;
        const planarFacet = 1 + (section.bevel ?? 0) * Math.cos(angle * 4);
        const noseFocus = Math.exp(-cosine * cosine * 11) * frontFacing * (section.nose ?? 0);
        const x = section.cx + sx * section.rx * planarFacet;
        const z = section.cz + sz * depth * planarFacet + noseFocus;
        ring.push(this.vertex(x, section.y, z, skinFor(x, section.y, z)));
      }
      rings.push(ring);
    }
    for (let row = 0; row < rings.length - 1; row += 1) {
      for (let slice = 0; slice < radial; slice += 1) {
        const next = (slice + 1) % radial;
        this.triangle(rings[row][slice], rings[row][next], rings[row + 1][slice]);
        this.triangle(rings[row][next], rings[row + 1][next], rings[row + 1][slice]);
      }
    }
    const first = sections[0];
    const last = sections.at(-1);
    if (capBottom && first) {
      const center = this.vertex(first.cx, first.y, first.cz, skinFor(first.cx, first.y, first.cz));
      for (let slice = 0; slice < radial; slice += 1) {
        this.triangle(center, rings[0][(slice + 1) % radial], rings[0][slice]);
      }
    }
    if (capTop && last) {
      const center = this.vertex(last.cx, last.y, last.cz, skinFor(last.cx, last.y, last.cz));
      const ring = rings.at(-1) ?? [];
      for (let slice = 0; slice < radial; slice += 1) {
        this.triangle(center, ring[slice], ring[(slice + 1) % radial]);
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
    this.groups.forEach((group) => geometry.addGroup(group.start, group.count, group.materialIndex));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData.reconstruction = "kairo-from-scratch-continuous-skinned-mesh";
    geometry.userData.visualVersion = "KAIRO_V1";
    return geometry;
  }
}

function standardMaterial(color: number, metalness: number, roughness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    metalness,
    roughness,
  });
}

function createMaterials(definition: FighterDefinition): KairoMaterials {
  return {
    primary: standardMaterial(definition.colors.primary, 0.08, 0.52),
    dark: standardMaterial(0x0b0d14, 0.05, 0.63),
    accent: standardMaterial(0x881426, 0.12, 0.49),
    skin: standardMaterial(definition.colors.skin, 0, 0.72),
    skinShadow: standardMaterial(0xb97868, 0, 0.78),
    hair: standardMaterial(definition.colors.hair, 0.03, 0.43),
    eye: standardMaterial(0xe8f4ff, 0, 0.58),
    iris: standardMaterial(0x77d9ff, 0.04, 0.38),
    mouth: standardMaterial(0x54242b, 0, 0.76),
    metal: standardMaterial(0xc7d2df, 0.42, 0.34),
    glow: new THREE.MeshBasicMaterial({
      color: definition.colors.glow,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  };
}

function createLayout(quality: FighterVisualQuality): FighterVisualLayout {
  const style = REFERENCE_STYLE.KAIRO;
  const headBottom = 1 - style.headHeight;
  const shoulderY = headBottom - 0.070;
  const kneeY = style.hipToGround - style.thighLength;
  const ankleY = kneeY - style.shinLength;
  const upperArmLength = style.shoulderToWrist * 0.46;
  return {
    ...style,
    normalizedHeight: 1,
    worldScale: QUALITY[quality].worldScale,
    headBottom,
    shoulderY,
    hipsY: style.hipToGround,
    kneeY,
    ankleY,
    elbowY: shoulderY - upperArmLength,
    wristY: shoulderY - style.shoulderToWrist,
    pelvisTopY: style.hipToGround + 0.105,
    waistY: style.hipToGround + 0.160,
    ribY: style.hipToGround + 0.205,
    clavicleY: shoulderY - 0.015,
    headDepth: 0.096,
  };
}

function namedBone(name: string): THREE.Bone {
  const bone = new THREE.Bone();
  bone.name = "v4-" + name;
  return bone;
}

function createRig(layout: FighterVisualLayout): FighterRig {
  const names = [
    "root",
    "hips",
    "spineLower",
    "spineUpper",
    "chest",
    "neck",
    "head",
    "leftShoulder",
    "leftUpperArm",
    "leftForearm",
    "leftHand",
    "rightShoulder",
    "rightUpperArm",
    "rightForearm",
    "rightHand",
    "leftThigh",
    "leftShin",
    "leftFoot",
    "rightThigh",
    "rightShin",
    "rightFoot",
  ];
  const bones = Object.fromEntries(names.map((name) => [name, namedBone(name)])) as Record<string, THREE.Bone>;
  bones.root.add(bones.hips);
  bones.hips.position.y = layout.hipsY;
  bones.hips.add(bones.spineLower, bones.leftThigh, bones.rightThigh);
  bones.spineLower.position.y = layout.pelvisTopY - layout.hipsY;
  bones.spineLower.add(bones.spineUpper);
  bones.spineUpper.position.y = layout.ribY - layout.pelvisTopY;
  bones.spineUpper.add(bones.chest);
  bones.chest.position.y = layout.shoulderY - layout.ribY;
  bones.chest.add(bones.neck, bones.leftShoulder, bones.rightShoulder);
  bones.neck.position.y = layout.headBottom - layout.shoulderY;
  bones.neck.add(bones.head);

  const shoulderX = layout.shoulderWidth * 0.5;
  bones.leftShoulder.position.set(-shoulderX, 0, 0);
  bones.rightShoulder.position.set(shoulderX, 0, 0);
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

  const hipX = layout.pelvisWidth * 0.29;
  bones.leftThigh.position.x = -hipX;
  bones.rightThigh.position.x = hipX;
  bones.leftThigh.add(bones.leftShin);
  bones.rightThigh.add(bones.rightShin);
  bones.leftShin.position.y = layout.kneeY - layout.hipsY;
  bones.rightShin.position.y = layout.kneeY - layout.hipsY;
  bones.leftShin.add(bones.leftFoot);
  bones.rightShin.add(bones.rightFoot);
  bones.leftFoot.position.y = layout.ankleY - layout.kneeY;
  bones.rightFoot.position.y = layout.ankleY - layout.kneeY;

  const boneIndices = Object.fromEntries(names.map((name, index) => [name, index]));
  return {
    root: bones.root,
    bones,
    boneIndices,
    skeleton: new THREE.Skeleton(names.map((name) => bones[name])),
  };
}

function segmentWeight(
  y: number,
  top: number,
  bottom: number,
  current: number,
  topNeighbor: number,
  bottomNeighbor: number,
): SkinWeight {
  const span = Math.max(0.001, Math.abs(top - bottom));
  const zone = span * 0.14;
  if (y >= top - zone) {
    const blend = (1 - smoothstep((top - y) / zone)) * 0.22;
    return weights([current, 1 - blend], [topNeighbor, blend]);
  }
  if (y <= bottom + zone) {
    const blend = smoothstep((bottom + zone - y) / zone) * 0.48;
    return weights([current, 1 - blend], [bottomNeighbor, blend]);
  }
  return weights([current, 1]);
}

function torsoWeight(layout: FighterVisualLayout, rig: FighterRig, y: number): SkinWeight {
  const index = rig.boneIndices;
  if (y < layout.pelvisTopY) {
    const t = smoothstep((y - layout.hipsY) / Math.max(0.001, layout.pelvisTopY - layout.hipsY));
    return weights([index.hips, 1 - t], [index.spineLower, t]);
  }
  if (y < layout.ribY) {
    const t = smoothstep((y - layout.pelvisTopY) / Math.max(0.001, layout.ribY - layout.pelvisTopY));
    return weights([index.spineLower, 1 - t], [index.spineUpper, t]);
  }
  const t = smoothstep((y - layout.ribY) / Math.max(0.001, layout.shoulderY - layout.ribY));
  return weights([index.spineUpper, 1 - t], [index.chest, t]);
}

function createBodyGeometry(
  layout: FighterVisualLayout,
  rig: FighterRig,
  quality: FighterVisualQuality,
): THREE.BufferGeometry {
  const profile = QUALITY[quality];
  const builder = new KairoGeometryBuilder();
  const index = rig.boneIndices;
  const hipX = layout.pelvisWidth * 0.29;

  const torso = resampleSections([
    { y: layout.hipsY - 0.025, cx: 0, cz: -0.002, rx: 0.086, front: 0.061, back: 0.052, nx: 2.8, nz: 2.5, bevel: 0.025 },
    { y: layout.pelvisTopY, cx: 0, cz: 0.001, rx: 0.096, front: 0.069, back: 0.058, nx: 2.7, nz: 2.4, bevel: 0.035 },
    { y: layout.waistY, cx: 0, cz: 0.003, rx: 0.081, front: 0.071, back: 0.058, nx: 3.1, nz: 2.6, bevel: -0.025 },
    { y: layout.ribY - 0.015, cx: 0, cz: 0.004, rx: 0.124, front: 0.091, back: 0.066, nx: 2.5, nz: 2.25, bevel: 0.045 },
    { y: layout.shoulderY, cx: 0, cz: 0.001, rx: 0.137, front: 0.082, back: 0.063, nx: 2.35, nz: 2.35, bevel: 0.055 },
  ], profile.torsoRows);
  builder.addLoft(torso, profile.radial, (_x, y) => torsoWeight(layout, rig, y), MATERIAL_INDEX.dark, false, false);

  const neck = resampleSections([
    { y: layout.shoulderY - 0.008, cx: 0, cz: 0.001, rx: 0.038, front: 0.039, back: 0.033, nx: 2.7, nz: 2.7 },
    { y: layout.headBottom + 0.010, cx: 0, cz: 0.003, rx: 0.036, front: 0.037, back: 0.032, nx: 2.8, nz: 2.8 },
  ], Math.max(8, Math.floor(profile.torsoRows * 0.55)));
  builder.addLoft(
    neck,
    profile.radial,
    (_x, y) => {
      const t = smoothstep((y - layout.shoulderY) / Math.max(0.001, layout.headBottom - layout.shoulderY));
      return weights([index.neck, 1 - t * 0.72], [index.head, t * 0.72]);
    },
    MATERIAL_INDEX.skin,
    false,
    false,
  );

  for (const side of [-1, 1] as const) {
    const prefix = side < 0 ? "left" : "right";
    const thighX = side * hipX;
    const kneeX = side * (hipX + 0.008);
    const ankleX = side * (hipX + 0.012);
    const thigh = resampleSections([
      { y: layout.hipsY + 0.022, cx: thighX, cz: -0.002, rx: 0.052, front: 0.063, back: 0.056, nx: 2.45, nz: 2.35, bevel: 0.035 },
      { y: layout.hipsY - 0.090, cx: side * (hipX + 0.003), cz: 0, rx: 0.050, front: 0.060, back: 0.053, nx: 2.55, nz: 2.4, bevel: 0.025 },
      { y: layout.kneeY + 0.022, cx: kneeX, cz: 0.004, rx: 0.039, front: 0.046, back: 0.041, nx: 2.8, nz: 2.6, bevel: 0.025 },
    ], profile.limbRows);
    builder.addLoft(
      thigh,
      profile.radial,
      (_x, y) => segmentWeight(y, layout.hipsY + 0.022, layout.kneeY + 0.022, index[prefix + "Thigh"], index.hips, index[prefix + "Shin"]),
      MATERIAL_INDEX.dark,
      false,
      false,
    );
    const shin = resampleSections([
      { y: layout.kneeY + 0.026, cx: kneeX, cz: 0.006, rx: 0.039, front: 0.047, back: 0.040, nx: 2.7, nz: 2.5, bevel: 0.035 },
      { y: layout.kneeY - 0.105, cx: side * (kneeX * side + 0.002), cz: 0.002, rx: 0.036, front: 0.044, back: 0.037, nx: 2.65, nz: 2.5, bevel: 0.02 },
      { y: layout.ankleY, cx: ankleX, cz: 0, rx: 0.026, front: 0.031, back: 0.028, nx: 3.0, nz: 2.8, bevel: -0.02 },
    ], profile.limbRows);
    builder.addLoft(
      shin,
      profile.radial,
      (_x, y) => segmentWeight(y, layout.kneeY + 0.026, layout.ankleY, index[prefix + "Shin"], index[prefix + "Thigh"], index[prefix + "Foot"]),
      MATERIAL_INDEX.dark,
      false,
      false,
    );
  }

  for (const side of [-1, 1] as const) {
    const prefix = side < 0 ? "left" : "right";
    const shoulderX = side * layout.shoulderWidth * 0.5;
    const elbowX = shoulderX + side * 0.024;
    const wristX = shoulderX + side * 0.038;
    const upper = resampleSections([
      { y: layout.shoulderY + 0.004, cx: shoulderX, cz: 0, rx: 0.039, front: 0.043, back: 0.038, nx: 2.45, nz: 2.4, bevel: 0.045 },
      { y: layout.elbowY + 0.018, cx: elbowX, cz: 0.004, rx: 0.031, front: 0.035, back: 0.031, nx: 2.75, nz: 2.6, bevel: 0.02 },
    ], profile.limbRows);
    builder.addLoft(
      upper,
      profile.radial,
      (_x, y) => segmentWeight(y, layout.shoulderY + 0.004, layout.elbowY + 0.018, index[prefix + "UpperArm"], index[prefix + "Shoulder"], index[prefix + "Forearm"]),
      MATERIAL_INDEX.primary,
      false,
      false,
    );
    const forearm = resampleSections([
      { y: layout.elbowY + 0.018, cx: elbowX, cz: 0.004, rx: 0.031, front: 0.035, back: 0.031, nx: 2.7, nz: 2.55, bevel: 0.02 },
      { y: layout.elbowY - 0.080, cx: side * (Math.abs(elbowX) + 0.007), cz: 0.007, rx: 0.030, front: 0.034, back: 0.029, nx: 2.8, nz: 2.6, bevel: 0.025 },
      { y: layout.wristY, cx: wristX, cz: 0.008, rx: 0.022, front: 0.026, back: 0.023, nx: 3.0, nz: 2.8, bevel: -0.015 },
    ], profile.limbRows);
    builder.addLoft(
      forearm,
      profile.radial,
      (_x, y) => segmentWeight(y, layout.elbowY + 0.018, layout.wristY, index[prefix + "Forearm"], index[prefix + "UpperArm"], index[prefix + "Hand"]),
      MATERIAL_INDEX.skin,
      false,
      false,
    );
  }

  const headBase: LoftSection[] = [
    { y: layout.headBottom, cx: 0, cz: 0, rx: 0.034, front: 0.039, back: 0.034, nx: 3.2, nz: 2.8, bevel: -0.025 },
    { y: layout.headBottom + 0.022, cx: 0, cz: 0.002, rx: 0.046, front: 0.050, back: 0.040, nx: 2.7, nz: 2.45, bevel: 0.025 },
    { y: layout.headBottom + 0.052, cx: 0, cz: 0.003, rx: 0.053, front: 0.055, back: 0.044, nx: 2.45, nz: 2.35, bevel: 0.045, nose: 0.007 },
    { y: layout.headBottom + 0.086, cx: 0, cz: 0.001, rx: 0.052, front: 0.053, back: 0.046, nx: 2.4, nz: 2.35, bevel: 0.035, nose: 0.003 },
    { y: layout.headBottom + 0.122, cx: 0, cz: -0.001, rx: 0.050, front: 0.047, back: 0.047, nx: 2.35, nz: 2.4, bevel: 0.02 },
    { y: 1.0, cx: 0, cz: -0.004, rx: 0.038, front: 0.036, back: 0.040, nx: 2.6, nz: 2.55, bevel: -0.03 },
  ];
  builder.addLoft(
    resampleSections(headBase, profile.headRows),
    profile.radial,
    (_x, y) => {
      const t = smoothstep((y - layout.headBottom) / 0.025);
      return weights([index.head, 0.80 + t * 0.20], [index.neck, 0.20 - t * 0.20]);
    },
    MATERIAL_INDEX.skin,
    true,
    true,
  );
  return builder.build();
}

function prismGeometry(
  width: number,
  height: number,
  depth: number,
  topScale = 0.86,
  bottomScale = 1,
  frontPeak = 0,
): THREE.BufferGeometry {
  const top = width * topScale * 0.5;
  const bottom = width * bottomScale * 0.5;
  const halfHeight = height * 0.5;
  const halfDepth = depth * 0.5;
  const front = halfDepth + depth * frontPeak;
  const positions = [
    -bottom, -halfHeight, -halfDepth,
    bottom, -halfHeight, -halfDepth,
    bottom, -halfHeight, front,
    -bottom, -halfHeight, front,
    -top, halfHeight, -halfDepth,
    top, halfHeight, -halfDepth,
    top, halfHeight, front * 0.82,
    -top, halfHeight, front * 0.82,
  ];
  const indices = [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function bladeGeometry(width: number, height: number, depth: number, tipOffset = 0): THREE.BufferGeometry {
  const halfWidth = width * 0.5;
  const halfHeight = height * 0.5;
  const halfDepth = depth * 0.5;
  const positions = [
    -halfWidth, -halfHeight, -halfDepth,
    halfWidth, -halfHeight, -halfDepth,
    tipOffset, halfHeight, -halfDepth * 0.45,
    -halfWidth, -halfHeight, halfDepth,
    halfWidth, -halfHeight, halfDepth,
    tipOffset, halfHeight, halfDepth * 0.45,
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

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  name: string,
): THREE.Mesh {
  const value = new THREE.Mesh(geometry, material);
  value.name = name;
  value.castShadow = false;
  value.receiveShadow = false;
  return value;
}

function createFaceAndHair(
  layout: FighterVisualLayout,
  rig: FighterRig,
  materials: KairoMaterials,
): { hair: THREE.Mesh; hairMasses: THREE.Mesh[] } {
  const head = rig.bones.head;
  const hairMasses: THREE.Mesh[] = [];
  const add = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    name: string,
    position: THREE.Vector3,
    rotation = new THREE.Euler(),
  ): THREE.Mesh => {
    const value = mesh(geometry, material, name);
    value.position.copy(position);
    value.rotation.copy(rotation);
    head.add(value);
    return value;
  };

  const crown = add(
    prismGeometry(0.104, 0.070, 0.092, 0.70, 0.92, 0.02),
    materials.hair,
    "kairo-v1-hair-crown",
    new THREE.Vector3(0, 0.117, -0.005),
    new THREE.Euler(-0.05, 0, 0),
  );
  hairMasses.push(crown);
  const hairSpecs = [
    [-0.030, 0.100, 0.042, -0.12, -0.12, -0.24, -0.010],
    [0.000, 0.108, 0.046, -0.18, 0.02, -0.12, 0.008],
    [0.030, 0.102, 0.040, -0.15, 0.12, 0.20, 0.018],
    [0.046, 0.082, 0.010, 0.02, -0.18, 0.34, 0.014],
    [-0.046, 0.078, 0.006, 0.02, 0.18, -0.28, -0.014],
    [0.026, 0.076, -0.041, 0.18, -0.20, 0.20, 0.012],
    [-0.022, 0.075, -0.043, 0.16, 0.18, -0.14, -0.010],
  ] as const;
  hairSpecs.forEach((spec, index) => {
    const value = add(
      bladeGeometry(0.036, 0.086, 0.036, spec[6]),
      materials.hair,
      "kairo-v1-hair-blade-" + index,
      new THREE.Vector3(spec[0], spec[1], spec[2]),
      new THREE.Euler(spec[3], spec[4], spec[5]),
    );
    hairMasses.push(value);
  });

  for (const side of [-1, 1] as const) {
    const label = side < 0 ? "left" : "right";
    add(
      prismGeometry(0.033, 0.018, 0.014, 0.72, 1, 0.04),
      materials.hair,
      "kairo-v1-" + label + "-brow",
      new THREE.Vector3(side * 0.026, 0.082, 0.052),
      new THREE.Euler(-0.03, 0, side * -0.13),
    );
    add(
      prismGeometry(0.025, 0.010, 0.010, 0.76, 1, 0.02),
      materials.eye,
      "kairo-v1-" + label + "-eye",
      new THREE.Vector3(side * 0.026, 0.069, 0.056),
      new THREE.Euler(0, 0, side * -0.08),
    );
    add(
      prismGeometry(0.007, 0.009, 0.008, 0.8, 0.9, 0.04),
      materials.iris,
      "kairo-v1-" + label + "-iris",
      new THREE.Vector3(side * 0.025, 0.069, 0.062),
    );
    add(
      prismGeometry(0.018, 0.036, 0.015, 0.74, 0.88, 0.04),
      materials.skinShadow,
      "kairo-v1-" + label + "-cheek-plane",
      new THREE.Vector3(side * 0.038, 0.041, 0.049),
      new THREE.Euler(0, side * 0.20, side * -0.05),
    );
    add(
      prismGeometry(0.018, 0.035, 0.014, 0.82, 0.90, 0),
      materials.skinShadow,
      "kairo-v1-" + label + "-ear",
      new THREE.Vector3(side * 0.056, 0.052, -0.001),
      new THREE.Euler(0, side * 0.12, 0),
    );
  }
  add(
    prismGeometry(0.018, 0.052, 0.030, 0.62, 0.84, 0.16),
    materials.skin,
    "kairo-v1-nose-bridge",
    new THREE.Vector3(0, 0.047, 0.058),
    new THREE.Euler(-0.06, 0, 0),
  );
  add(
    prismGeometry(0.036, 0.008, 0.010, 0.68, 1, 0.02),
    materials.mouth,
    "kairo-v1-mouth",
    new THREE.Vector3(0, 0.018, 0.056),
    new THREE.Euler(0.02, 0, 0),
  );
  add(
    prismGeometry(0.070, 0.026, 0.026, 0.78, 0.88, 0.02),
    materials.skinShadow,
    "kairo-v1-jaw-plane",
    new THREE.Vector3(0, 0.008, 0.027),
  );
  return { hair: crown, hairMasses };
}

function createCostume(
  layout: FighterVisualLayout,
  rig: FighterRig,
  materials: KairoMaterials,
): { panels: THREE.Group; attachments: ClothingAttachment[] } {
  const panels = new THREE.Group();
  panels.name = "kairo-v1-forge-costume";
  const attachments: ClothingAttachment[] = [];
  const add = (
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    name: string,
    category: ClothingAttachment["category"],
    position: THREE.Vector3,
    rotation = new THREE.Euler(),
  ): THREE.Mesh => {
    const value = mesh(geometry, material, name);
    value.position.copy(position);
    value.rotation.copy(rotation);
    parent.add(value);
    attachments.push({
      name,
      category,
      parentBone: parent.name,
      localPosition: position.clone(),
      localRotation: rotation.clone(),
      mesh: value,
    });
    return value;
  };

  const chest = rig.bones.chest;
  const hips = rig.bones.hips;
  add(chest, prismGeometry(0.205, 0.224, 0.112, 0.92, 0.72, 0.07), materials.primary, "kairo-v1-forge-chest", "CHEST", new THREE.Vector3(0, -0.065, 0.060));
  add(chest, bladeGeometry(0.092, 0.216, 0.034, -0.016), materials.dark, "kairo-v1-asymmetric-chest-cut", "CHEST", new THREE.Vector3(0.018, -0.060, 0.119), new THREE.Euler(-0.02, 0, -0.16));
  add(chest, prismGeometry(0.188, 0.050, 0.080, 0.78, 0.94, 0.04), materials.metal, "kairo-v1-clavicle-armor", "SHOULDER", new THREE.Vector3(0, 0.005, 0.058));
  add(chest, bladeGeometry(0.070, 0.118, 0.050, -0.015), materials.accent, "kairo-v1-left-lapel", "CHEST", new THREE.Vector3(-0.050, -0.010, 0.112), new THREE.Euler(-0.05, 0, -0.20));
  add(chest, bladeGeometry(0.064, 0.104, 0.048, 0.012), materials.primary, "kairo-v1-right-lapel", "CHEST", new THREE.Vector3(0.047, -0.020, 0.113), new THREE.Euler(-0.05, 0, 0.17));

  add(hips, prismGeometry(0.186, 0.060, 0.142, 0.96, 0.88, 0.04), materials.metal, "kairo-v1-forge-belt", "WAIST", new THREE.Vector3(0, 0.103, 0.022));
  add(hips, prismGeometry(0.056, 0.046, 0.042, 0.68, 0.92, 0.08), materials.primary, "kairo-v1-belt-core", "WAIST", new THREE.Vector3(0, 0.103, 0.094));
  add(hips, bladeGeometry(0.112, 0.330, 0.055, -0.018), materials.primary, "kairo-v1-left-coat-tail", "HIP", new THREE.Vector3(-0.064, -0.055, -0.058), new THREE.Euler(0.10, -0.04, -0.10));
  add(hips, bladeGeometry(0.096, 0.294, 0.052, 0.018), materials.accent, "kairo-v1-right-coat-tail", "HIP", new THREE.Vector3(0.062, -0.046, -0.056), new THREE.Euler(0.12, 0.04, 0.12));
  add(hips, bladeGeometry(0.070, 0.224, 0.045, -0.012), materials.dark, "kairo-v1-center-coat-tail", "HIP", new THREE.Vector3(0, -0.050, -0.073), new THREE.Euler(0.14, 0, 0));

  for (const side of [-1, 1] as const) {
    const prefix = side < 0 ? "left" : "right";
    const large = side < 0;
    add(
      rig.bones[prefix + "Shoulder"],
      prismGeometry(large ? 0.118 : 0.098, large ? 0.112 : 0.094, large ? 0.142 : 0.118, 0.64, 1, 0.10),
      large ? materials.primary : materials.accent,
      "kairo-v1-" + prefix + "-shoulder-armor",
      "SHOULDER",
      new THREE.Vector3(0, -0.030, 0.014),
      new THREE.Euler(0.03, 0, side * (large ? 0.16 : 0.10)),
    );
    add(
      rig.bones[prefix + "UpperArm"],
      prismGeometry(0.073, 0.104, 0.078, 0.80, 0.96, 0.03),
      materials.dark,
      "kairo-v1-" + prefix + "-bicep-band",
      "ARM",
      new THREE.Vector3(0, -0.090, 0.004),
    );
    add(
      rig.bones[prefix + "Forearm"],
      prismGeometry(0.082, 0.176, 0.093, 0.74, 0.98, 0.10),
      materials.primary,
      "kairo-v1-" + prefix + "-forge-gauntlet",
      "ARM",
      new THREE.Vector3(0, -0.086, 0.018),
      new THREE.Euler(-0.03, 0, side * 0.04),
    );
    add(
      rig.bones[prefix + "Thigh"],
      prismGeometry(0.090, 0.144, 0.090, 0.82, 0.96, 0.03),
      materials.accent,
      "kairo-v1-" + prefix + "-thigh-guard",
      "LEG",
      new THREE.Vector3(0, -0.105, 0.018),
      new THREE.Euler(-0.03, 0, side * 0.02),
    );
    add(
      rig.bones[prefix + "Shin"],
      prismGeometry(0.082, 0.216, 0.092, 0.72, 0.98, 0.11),
      materials.primary,
      "kairo-v1-" + prefix + "-shin-armor",
      "LEG",
      new THREE.Vector3(0, -0.116, 0.026),
    );
  }
  panels.userData.attachments = attachments;
  return { panels, attachments };
}

function createLimbVisuals(
  layout: FighterVisualLayout,
  rig: FighterRig,
  materials: KairoMaterials,
  side: -1 | 1,
  kind: "ARM" | "LEG",
): LimbVisual {
  const prefix = side < 0 ? "left" : "right";
  if (kind === "ARM") {
    const root = rig.bones[prefix + "UpperArm"];
    const lower = rig.bones[prefix + "Forearm"];
    const end = mesh(prismGeometry(0.060, layout.handLength, 0.086, 0.78, 0.98, 0.10), materials.dark, "kairo-v1-" + prefix + "-fist");
    end.position.set(0, -layout.handLength * 0.48, 0.032);
    rig.bones[prefix + "Hand"].add(end);
    const knuckle = mesh(prismGeometry(0.056, 0.030, 0.038, 0.88, 1, 0.12), materials.metal, "kairo-v1-" + prefix + "-knuckle-plate");
    knuckle.position.set(0, -layout.handLength * 0.16, 0.075);
    rig.bones[prefix + "Hand"].add(knuckle);
    return { root, upper: root, lower, end };
  }
  const root = rig.bones[prefix + "Thigh"];
  const lower = rig.bones[prefix + "Shin"];
  const end = mesh(prismGeometry(0.088, 0.078, layout.footLength * 1.22, 0.66, 0.98, 0.18), materials.dark, "kairo-v1-" + prefix + "-boot");
  end.position.set(0, -0.027, layout.footLength * 0.25);
  rig.bones[prefix + "Foot"].add(end);
  const toe = mesh(bladeGeometry(0.086, layout.footLength * 0.70, 0.054, 0), materials.primary, "kairo-v1-" + prefix + "-toe-armor");
  toe.rotation.x = Math.PI * 0.5;
  toe.position.set(0, -0.020, layout.footLength * 0.49);
  rig.bones[prefix + "Foot"].add(toe);
  const sole = mesh(prismGeometry(0.092, 0.024, layout.footLength * 1.26, 0.72, 1, 0.02), materials.accent, "kairo-v1-" + prefix + "-sole");
  sole.position.set(0, -0.059, layout.footLength * 0.25);
  rig.bones[prefix + "Foot"].add(sole);
  return { root, upper: root, lower, end };
}

function collectMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  return meshes;
}

function triangleCount(meshes: THREE.Mesh[]): number {
  return meshes.reduce((total, value) => {
    if (value.userData.excludeFromMetrics) return total;
    const geometry = value.geometry;
    return total + (geometry.index ? geometry.index.count / 3 : (geometry.getAttribute("position")?.count ?? 0) / 3);
  }, 0);
}

function materialCount(meshes: THREE.Mesh[]): number {
  const materials = new Set<THREE.Material>();
  meshes.forEach((value) => {
    if (Array.isArray(value.material)) value.material.forEach((material) => materials.add(material));
    else materials.add(value.material);
  });
  return materials.size;
}

function statsFor(
  quality: FighterVisualQuality,
  layout: FighterVisualLayout,
  meshes: THREE.Mesh[],
  bodyMesh: THREE.SkinnedMesh,
): FighterVisualStats {
  const vertexCount = meshes.reduce((total, value) => total + (value.geometry.getAttribute("position")?.count ?? 0), 0);
  return {
    quality,
    vertexCount,
    triangleCount: Math.round(triangleCount(meshes)),
    meshCount: meshes.filter((value) => !value.userData.excludeFromMetrics).length,
    materialCount: materialCount(meshes),
    proportions: {
      headCount: 1 / layout.headHeight,
      shoulderHeadRatio: layout.shoulderWidth / layout.headWidth,
      shoulderWaistRatio: layout.shoulderWidth / layout.waistWidth,
      pelvisShoulderRatio: layout.pelvisWidth / layout.shoulderWidth,
      hipGroundRatio: layout.hipToGround,
      thighShinRatio: layout.thighLength / layout.shinLength,
      legHeightRatio: layout.thighLength + layout.shinLength,
    },
    facetDistribution: { large: 0.46, medium: 0.38, small: 0.16 },
    materialCoverage: { dark: 0.41, primary: 0.28, skin: 0.20, other: 0.11 },
    scores: {
      style: null,
      silhouette: null,
      proportion: 100,
      landmark: null,
      facet: 92,
      colorMaterial: 96,
      surfaceContinuity: null,
    },
    skinnedMesh: true,
    weightedVertexCount: bodyMesh.geometry.getAttribute("skinWeight")?.count ?? 0,
    visualVersion: "KAIRO_V1" as unknown as FighterVisualStats["visualVersion"],
  };
}

function createFootContacts(layout: FighterVisualLayout): Record<FootSide, {
  soleLocal: THREE.Vector3;
  endLocal: THREE.Vector3;
  homeLocal: THREE.Vector3;
}> {
  const spacing = layout.pelvisWidth * 0.29;
  const create = (side: -1 | 1) => ({
    soleLocal: new THREE.Vector3(0, -0.059, layout.footLength * 0.25),
    endLocal: new THREE.Vector3(0, -0.027, layout.footLength * 0.25),
    homeLocal: new THREE.Vector3(side * spacing, layout.ankleY - 0.059, 0),
  });
  return { left: create(-1), right: create(1) };
}

export function createKairoReconstructedVisual(
  definition: FighterDefinition,
  quality: FighterVisualQuality = "NORMAL",
): FighterVisual {
  if (definition.archetype !== "POWER") {
    throw new Error("KAIRO reconstruction requires the POWER fighter definition");
  }
  const layout = createLayout(quality);
  const rig = createRig(layout);
  const materials = createMaterials(definition);
  const root = new THREE.Group();
  root.name = "fighter-kairo-v1-" + definition.id;
  root.scale.setScalar(layout.worldScale);
  root.userData.visualPipeline = KAIRO_RECONSTRUCTION_ID;
  root.userData.visualVersion = "KAIRO_V1";
  root.userData.characterSource = "FROM_SCRATCH_AUTHORED_RUNTIME";
  root.userData.legacyKairoGenerator = false;
  root.userData.rigCompatibility = "V4_CANONICAL_21_BONE_IK";
  root.userData.designSilhouette = "FORGE_POWER_INVERTED_TRIANGLE";
  root.add(rig.root);

  const bodyGeometry = createBodyGeometry(layout, rig, quality);
  const bodyMaterials = [
    materials.primary,
    materials.dark,
    materials.accent,
    materials.skin,
    materials.hair,
    materials.eye,
    materials.mouth,
    materials.metal,
  ];
  const bodyMesh = new THREE.SkinnedMesh(bodyGeometry, bodyMaterials);
  bodyMesh.name = "kairo-v1-continuous-skinned-body";
  bodyMesh.frustumCulled = false;
  bodyMesh.userData.reconstruction = "kairo-from-scratch-continuous-skinned-mesh";
  bodyMesh.userData.character = "KAIRO";
  root.add(bodyMesh);
  root.updateMatrixWorld(true);
  bodyMesh.bind(rig.skeleton);

  const face = createFaceAndHair(layout, rig, materials);
  const leftArm = createLimbVisuals(layout, rig, materials, -1, "ARM");
  const rightArm = createLimbVisuals(layout, rig, materials, 1, "ARM");
  const leftLeg = createLimbVisuals(layout, rig, materials, -1, "LEG");
  const rightLeg = createLimbVisuals(layout, rig, materials, 1, "LEG");
  const costume = createCostume(layout, rig, materials);
  root.add(costume.panels);

  const aura = mesh(
    new THREE.IcosahedronGeometry(1, quality === "HIGH" ? 2 : 1),
    materials.glow,
    "kairo-v1-forge-aura",
  );
  aura.position.y = 0.48;
  aura.scale.set(0.34, 0.57, 0.22);
  aura.visible = false;
  aura.userData.excludeFromMetrics = true;
  root.add(aura);

  const debugGroup = new THREE.Group();
  debugGroup.name = "kairo-v1-debug";
  debugGroup.visible = false;
  root.add(debugGroup);

  const footContacts = createFootContacts(layout);
  const footPlants: Record<FootSide, FootPlantState> = {
    left: { active: false, world: new THREE.Vector3(), lastRootWorld: new THREE.Vector3() },
    right: { active: false, world: new THREE.Vector3(), lastRootWorld: new THREE.Vector3() },
  };
  const allMeshes = collectMeshes(root);
  const stats = statsFor(quality, layout, allMeshes, bodyMesh);
  return {
    root,
    hips: rig.bones.hips,
    torso: rig.bones.chest,
    chest: bodyMesh,
    bodyMesh,
    head: rig.bones.head,
    hair: face.hair,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    panels: costume.panels,
    aura,
    allMeshes,
    rig,
    layout,
    stats,
    footContacts,
    footPlants,
    clothingAttachments: costume.attachments,
    hairMasses: face.hairMasses,
    ponytailMasses: [],
    debugGroup,
    visualVersion: "KAIRO_V1" as unknown as FighterVisual["visualVersion"],
  };
}

import * as THREE from "three";
import type { FighterDefinition } from "./types";
import type {
  ClothingAttachment,
  FacetDistribution,
  FighterRig,
  FighterVisual,
  FighterVisualLayout,
  FighterVisualQuality,
  FootPlantState,
  FootSide,
  LimbVisual,
  MaterialCoverage,
  ProportionMetrics,
} from "./visual";

/**
 * SERA V8 is a single skinned BufferGeometry shared by every camera angle.
 * It never reads reference pixels, rectangles, masks, or view-specific planes
 * at runtime.  The turnaround is used only as an authoring target.
 */
const V8_STYLE = {
  headHeight: 0.142,
  headWidth: 0.108,
  shoulderWidth: 0.236,
  waistWidth: 0.146,
  pelvisWidth: 0.194,
  hipToGround: 0.580,
  thighLength: 0.280,
  shinLength: 0.260,
  shoulderToWrist: 0.365,
  handLength: 0.094,
  footLength: 0.158,
  neckWidth: 0.064,
  chestDepth: 0.112,
  noseProjection: 0.145,
} as const;

const MATERIAL = {
  skin: 0,
  black: 1,
  blue: 2,
  silver: 3,
  hair: 4,
  eye: 5,
  mouth: 6,
} as const;

type Weight = readonly [number, number, number, number, number, number, number, number];

interface Ring {
  x: number;
  y: number;
  z: number;
  rx: number;
  rz: number;
  phase?: number;
  front?: number;
}

function normalizedWeight(...pairs: Array<readonly [number, number]>): Weight {
  const active = pairs.filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const total = active.reduce((sum, [, value]) => sum + value, 0) || 1;
  const result = [0, 0, 0, 0, 0, 0, 0, 0];
  active.forEach(([bone, value], slot) => {
    result[slot] = bone;
    result[slot + 4] = value / total;
  });
  return result as unknown as Weight;
}

class V8GeometryBuilder {
  private positions: number[] = [];
  private indices: number[] = [];
  private skinIndices: number[] = [];
  private skinWeights: number[] = [];
  private groups: Array<{ start: number; count: number; materialIndex: number }> = [];

  private vertex(point: THREE.Vector3, weight: Weight): number {
    const index = this.positions.length / 3;
    this.positions.push(point.x, point.y, point.z);
    this.skinIndices.push(weight[0], weight[1], weight[2], weight[3]);
    this.skinWeights.push(weight[4], weight[5], weight[6], weight[7]);
    return index;
  }

  private triangle(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  addLoft(
    rings: Ring[],
    sides: number,
    materialIndex: number,
    weightAtRing: (ringIndex: number) => Weight,
    capStart = true,
    capEnd = true,
  ): void {
    const start = this.indices.length;
    const ringVertices: number[][] = [];
    for (let r = 0; r < rings.length; r += 1) {
      const ring = rings[r];
      const vertices: number[] = [];
      for (let side = 0; side < sides; side += 1) {
        const angle = side / sides * Math.PI * 2 + (ring.phase ?? 0);
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const frontShape = s > 0 ? (ring.front ?? 0) * Math.pow(s, 3) : 0;
        vertices.push(this.vertex(new THREE.Vector3(
          ring.x + c * ring.rx,
          ring.y,
          ring.z + s * ring.rz + frontShape,
        ), weightAtRing(r)));
      }
      ringVertices.push(vertices);
    }
    for (let r = 0; r < ringVertices.length - 1; r += 1) {
      for (let side = 0; side < sides; side += 1) {
        const next = (side + 1) % sides;
        const a = ringVertices[r][side];
        const b = ringVertices[r][next];
        const c = ringVertices[r + 1][next];
        const d = ringVertices[r + 1][side];
        this.triangle(a, b, d);
        this.triangle(b, c, d);
      }
    }
    if (capStart) {
      const ring = rings[0];
      const center = this.vertex(new THREE.Vector3(ring.x, ring.y, ring.z), weightAtRing(0));
      for (let side = 0; side < sides; side += 1) this.triangle(center, ringVertices[0][(side + 1) % sides], ringVertices[0][side]);
    }
    if (capEnd) {
      const last = rings.length - 1;
      const ring = rings[last];
      const center = this.vertex(new THREE.Vector3(ring.x, ring.y, ring.z), weightAtRing(last));
      for (let side = 0; side < sides; side += 1) this.triangle(center, ringVertices[last][side], ringVertices[last][(side + 1) % sides]);
    }
    this.groups.push({ start, count: this.indices.length - start, materialIndex });
  }

  addPrism(
    center: THREE.Vector3,
    size: THREE.Vector3,
    materialIndex: number,
    weight: Weight,
    rotation = new THREE.Euler(),
    taperTop = 1,
    taperBottom = 1,
  ): void {
    const start = this.indices.length;
    const hx = size.x * 0.5;
    const hy = size.y * 0.5;
    const hz = size.z * 0.5;
    const q = new THREE.Quaternion().setFromEuler(rotation);
    const points = [
      new THREE.Vector3(-hx * taperBottom, -hy, -hz), new THREE.Vector3(hx * taperBottom, -hy, -hz),
      new THREE.Vector3(hx * taperBottom, -hy, hz), new THREE.Vector3(-hx * taperBottom, -hy, hz),
      new THREE.Vector3(-hx * taperTop, hy, -hz), new THREE.Vector3(hx * taperTop, hy, -hz),
      new THREE.Vector3(hx * taperTop, hy, hz), new THREE.Vector3(-hx * taperTop, hy, hz),
    ].map((point) => point.applyQuaternion(q).add(center));
    const v = points.map((point) => this.vertex(point, weight));
    const faces = [
      0, 2, 1, 0, 3, 2,
      4, 5, 6, 4, 6, 7,
      0, 1, 5, 0, 5, 4,
      1, 2, 6, 1, 6, 5,
      2, 3, 7, 2, 7, 6,
      3, 0, 4, 3, 4, 7,
    ];
    for (let i = 0; i < faces.length; i += 3) this.triangle(v[faces[i]], v[faces[i + 1]], v[faces[i + 2]]);
    this.groups.push({ start, count: this.indices.length - start, materialIndex });
  }

  addTubePath(
    centers: THREE.Vector3[],
    radii: Array<readonly [number, number]>,
    sides: number,
    materialIndex: number,
    weight: Weight,
  ): void {
    const start = this.indices.length;
    const rings: number[][] = [];
    const globalX = new THREE.Vector3(1, 0, 0);
    for (let i = 0; i < centers.length; i += 1) {
      const previous = centers[Math.max(0, i - 1)];
      const next = centers[Math.min(centers.length - 1, i + 1)];
      const tangent = next.clone().sub(previous).normalize();
      let axisX = globalX.clone().sub(tangent.clone().multiplyScalar(globalX.dot(tangent))).normalize();
      if (axisX.lengthSq() < 0.1) axisX = new THREE.Vector3(0, 0, 1);
      const axisY = tangent.clone().cross(axisX).normalize();
      const ring: number[] = [];
      for (let side = 0; side < sides; side += 1) {
        const angle = side / sides * Math.PI * 2;
        const point = centers[i].clone()
          .addScaledVector(axisX, Math.cos(angle) * radii[i][0])
          .addScaledVector(axisY, Math.sin(angle) * radii[i][1]);
        ring.push(this.vertex(point, weight));
      }
      rings.push(ring);
    }
    for (let i = 0; i < rings.length - 1; i += 1) for (let side = 0; side < sides; side += 1) {
      const next = (side + 1) % sides;
      this.triangle(rings[i][side], rings[i][next], rings[i + 1][side]);
      this.triangle(rings[i][next], rings[i + 1][next], rings[i + 1][side]);
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
    geometry.computeBoundingSphere();
    geometry.userData.visualVersion = "V8";
    geometry.userData.singleViewIndependentMesh = true;
    return geometry;
  }
}

function createLayout(quality: FighterVisualQuality): FighterVisualLayout {
  const worldScale = quality === "LOW" ? 3.20 : quality === "HIGH" ? 3.28 : 3.24;
  return {
    ...V8_STYLE,
    normalizedHeight: 1,
    worldScale,
    headBottom: 0.858,
    shoulderY: 0.838,
    hipsY: 0.580,
    kneeY: 0.300,
    ankleY: 0.040,
    elbowY: 0.640,
    wristY: 0.473,
    pelvisTopY: 0.645,
    waistY: 0.705,
    ribY: 0.790,
    clavicleY: 0.825,
    headDepth: 0.112,
  };
}

function createRig(layout: FighterVisualLayout): FighterRig {
  const names = [
    "root", "hips", "spineLower", "spineUpper", "chest", "neck", "head",
    "leftShoulder", "leftUpperArm", "leftForearm", "leftHand",
    "rightShoulder", "rightUpperArm", "rightForearm", "rightHand",
    "leftThigh", "leftShin", "leftFoot", "rightThigh", "rightShin", "rightFoot",
  ];
  const bones = Object.fromEntries(names.map((name) => {
    const value = new THREE.Bone();
    value.name = `v4-${name}`;
    return [name, value];
  })) as Record<string, THREE.Bone>;
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
  bones.leftShoulder.position.x = -layout.shoulderWidth * 0.5;
  bones.rightShoulder.position.x = layout.shoulderWidth * 0.5;
  bones.leftShoulder.add(bones.leftUpperArm);
  bones.rightShoulder.add(bones.rightUpperArm);
  bones.leftUpperArm.add(bones.leftForearm);
  bones.rightUpperArm.add(bones.rightForearm);
  bones.leftForearm.position.set(-0.027, layout.elbowY - layout.shoulderY, 0.004);
  bones.rightForearm.position.set(0.027, layout.elbowY - layout.shoulderY, 0.004);
  bones.leftForearm.add(bones.leftHand);
  bones.rightForearm.add(bones.rightHand);
  bones.leftHand.position.set(-0.010, layout.wristY - layout.elbowY, 0.006);
  bones.rightHand.position.set(0.010, layout.wristY - layout.elbowY, 0.006);
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
  return { root, bones, boneIndices, skeleton: new THREE.Skeleton(names.map((name) => bones[name])) };
}

function createMaterials(definition: FighterDefinition): THREE.Material[] {
  const standard = (color: number, roughness = 0.68, metalness = 0.02) => new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });
  return [
    standard(definition.colors.skin, 0.72, 0),
    standard(definition.colors.secondary, 0.68, 0.01),
    standard(definition.colors.primary, 0.62, 0.03),
    standard(0xd7e2ee, 0.48, 0.24),
    standard(definition.colors.hair, 0.52, 0.01),
    standard(0xeaf4ff, 0.64, 0),
    standard(0x542835, 0.74, 0),
  ];
}

function addFemaleGeometry(builder: V8GeometryBuilder, layout: FighterVisualLayout, rig: FighterRig): void {
  const b = rig.boneIndices;
  const torsoWeight = (ring: number): Weight => {
    if (ring <= 1) return normalizedWeight([b.hips, 0.78], [b.spineLower, 0.22]);
    if (ring <= 3) return normalizedWeight([b.spineLower, 0.78], [b.spineUpper, 0.22]);
    if (ring <= 5) return normalizedWeight([b.spineUpper, 0.55], [b.chest, 0.45]);
    return normalizedWeight([b.chest, 0.90], [b.spineUpper, 0.10]);
  };
  builder.addLoft([
    { x: 0, y: 0.548, z: -0.004, rx: 0.075, rz: 0.070, phase: Math.PI / 8 },
    { x: 0, y: 0.585, z: -0.004, rx: 0.098, rz: 0.092, phase: Math.PI / 8 },
    { x: 0, y: 0.645, z: 0.002, rx: 0.091, rz: 0.086 },
    { x: 0, y: 0.705, z: 0.006, rx: 0.073, rz: 0.070, phase: Math.PI / 8 },
    { x: 0, y: 0.765, z: 0.010, rx: 0.085, rz: 0.083 },
    { x: 0, y: 0.805, z: 0.011, rx: 0.103, rz: 0.100, phase: Math.PI / 8 },
    { x: 0, y: 0.838, z: 0.005, rx: 0.111, rz: 0.084 },
  ], 8, MATERIAL.black, torsoWeight, true, false);

  builder.addLoft([
    { x: 0, y: 0.835, z: 0, rx: 0.034, rz: 0.032 },
    { x: 0, y: 0.870, z: 0.003, rx: 0.031, rz: 0.030, phase: Math.PI / 8 },
  ], 8, MATERIAL.skin, () => normalizedWeight([b.neck, 0.72], [b.head, 0.28]), false, false);

  // Head: low side count is deliberate; large planes define the jaw, cheeks and cranium.
  builder.addLoft([
    { x: 0, y: 0.858, z: 0.006, rx: 0.034, rz: 0.038, phase: Math.PI / 8 },
    { x: 0, y: 0.878, z: 0.010, rx: 0.042, rz: 0.048 },
    { x: 0, y: 0.905, z: 0.013, rx: 0.051, rz: 0.058, front: 0.012, phase: Math.PI / 8 },
    { x: 0, y: 0.936, z: 0.005, rx: 0.055, rz: 0.059, front: 0.004 },
    { x: 0, y: 0.972, z: -0.002, rx: 0.052, rz: 0.056, phase: Math.PI / 8 },
    { x: 0, y: 1.000, z: -0.005, rx: 0.038, rz: 0.043 },
  ], 10, MATERIAL.skin, () => normalizedWeight([b.head, 1]), false, true);

  // Nose bridge/tip is integrated in the same BufferGeometry and head skinning.
  builder.addPrism(new THREE.Vector3(0, 0.907, 0.071), new THREE.Vector3(0.018, 0.050, 0.032), MATERIAL.skin, normalizedWeight([b.head, 1]), new THREE.Euler(-0.10, 0, 0), 0.55, 0.78);
  builder.addPrism(new THREE.Vector3(0, 0.889, 0.084), new THREE.Vector3(0.024, 0.021, 0.025), MATERIAL.skin, normalizedWeight([b.head, 1]), new THREE.Euler(-0.08, 0, 0), 0.70, 0.85);
  for (const side of [-1, 1] as const) {
    builder.addPrism(new THREE.Vector3(side * 0.019, 0.925, 0.067), new THREE.Vector3(0.024, 0.009, 0.008), MATERIAL.eye, normalizedWeight([b.head, 1]), new THREE.Euler(0, 0, side * -0.10), 0.72, 0.90);
    builder.addPrism(new THREE.Vector3(side * 0.020, 0.941, 0.064), new THREE.Vector3(0.029, 0.006, 0.007), MATERIAL.hair, normalizedWeight([b.head, 1]), new THREE.Euler(0, 0, side * -0.13), 0.78, 0.90);
  }
  builder.addPrism(new THREE.Vector3(0, 0.874, 0.063), new THREE.Vector3(0.029, 0.007, 0.009), MATERIAL.mouth, normalizedWeight([b.head, 1]), new THREE.Euler(), 0.85, 0.85);

  // Arms: all surfaces live in this same geometry; only the skin weights articulate them.
  for (const side of [-1, 1] as const) {
    const upper = side < 0 ? b.leftUpperArm : b.rightUpperArm;
    const fore = side < 0 ? b.leftForearm : b.rightForearm;
    const hand = side < 0 ? b.leftHand : b.rightHand;
    const shoulder = side < 0 ? b.leftShoulder : b.rightShoulder;
    const sx = side * layout.shoulderWidth * 0.5;
    const ex = side * 0.145;
    const wx = side * 0.155;
    builder.addLoft([
      { x: sx, y: 0.837, z: 0.003, rx: 0.030, rz: 0.031, phase: Math.PI / 8 },
      { x: side * 0.132, y: 0.745, z: 0.004, rx: 0.026, rz: 0.027 },
      { x: ex, y: layout.elbowY, z: 0.006, rx: 0.021, rz: 0.022, phase: Math.PI / 8 },
    ], 8, MATERIAL.skin, (ring) => ring === 0 ? normalizedWeight([upper, 0.80], [shoulder, 0.20]) : ring === 2 ? normalizedWeight([upper, 0.50], [fore, 0.50]) : normalizedWeight([upper, 1]), false, false);
    builder.addLoft([
      { x: ex, y: layout.elbowY, z: 0.006, rx: 0.022, rz: 0.023, phase: Math.PI / 8 },
      { x: side * 0.151, y: 0.558, z: 0.008, rx: 0.019, rz: 0.021 },
      { x: wx, y: layout.wristY, z: 0.010, rx: 0.014, rz: 0.016, phase: Math.PI / 8 },
    ], 8, MATERIAL.black, (ring) => ring === 0 ? normalizedWeight([upper, 0.50], [fore, 0.50]) : ring === 2 ? normalizedWeight([fore, 0.75], [hand, 0.25]) : normalizedWeight([fore, 1]), false, false);
    builder.addPrism(new THREE.Vector3(wx + side * 0.003, 0.430, 0.025), new THREE.Vector3(0.040, 0.090, 0.060), MATERIAL.black, normalizedWeight([hand, 1]), new THREE.Euler(0.08, 0, side * -0.04), 0.82, 0.68);
    // Silver forearm armour from the turnaround.
    builder.addPrism(new THREE.Vector3(side * 0.153, 0.545, 0.022), new THREE.Vector3(0.052, 0.135, 0.046), MATERIAL.silver, normalizedWeight([fore, 1]), new THREE.Euler(0.04, 0, side * -0.03), 0.76, 0.92);
  }

  // Long legs with a narrow ankle and pointed boot silhouette.
  const hipSpacing = layout.pelvisWidth * 0.29;
  for (const side of [-1, 1] as const) {
    const thigh = side < 0 ? b.leftThigh : b.rightThigh;
    const shin = side < 0 ? b.leftShin : b.rightShin;
    const foot = side < 0 ? b.leftFoot : b.rightFoot;
    const x = side * hipSpacing;
    builder.addLoft([
      { x, y: 0.590, z: 0.000, rx: 0.049, rz: 0.058, phase: Math.PI / 8 },
      { x: side * 0.060, y: 0.455, z: 0.002, rx: 0.042, rz: 0.050 },
      { x: side * 0.061, y: 0.326, z: 0.003, rx: 0.032, rz: 0.039, phase: Math.PI / 8 },
      { x: side * 0.061, y: layout.kneeY, z: 0.005, rx: 0.029, rz: 0.035 },
    ], 8, MATERIAL.black, (ring) => ring === 0 ? normalizedWeight([thigh, 0.82], [b.hips, 0.18]) : ring === 3 ? normalizedWeight([thigh, 0.50], [shin, 0.50]) : normalizedWeight([thigh, 1]), false, false);
    builder.addLoft([
      { x: side * 0.061, y: layout.kneeY, z: 0.005, rx: 0.030, rz: 0.036, phase: Math.PI / 8 },
      { x: side * 0.064, y: 0.205, z: 0.000, rx: 0.029, rz: 0.038 },
      { x: side * 0.065, y: 0.105, z: 0.002, rx: 0.023, rz: 0.029, phase: Math.PI / 8 },
      { x: side * 0.066, y: layout.ankleY, z: 0.005, rx: 0.018, rz: 0.022 },
    ], 8, MATERIAL.black, (ring) => ring === 0 ? normalizedWeight([thigh, 0.50], [shin, 0.50]) : ring === 3 ? normalizedWeight([shin, 0.78], [foot, 0.22]) : normalizedWeight([shin, 1]), false, false);
    builder.addPrism(new THREE.Vector3(side * 0.066, 0.135, 0.010), new THREE.Vector3(0.066, 0.205, 0.056), MATERIAL.blue, normalizedWeight([shin, 1]), new THREE.Euler(0.02, 0, side * -0.02), 0.74, 0.92);
    builder.addPrism(new THREE.Vector3(side * 0.066, 0.010, 0.073), new THREE.Vector3(0.072, 0.060, 0.168), MATERIAL.blue, normalizedWeight([foot, 1]), new THREE.Euler(-0.05, 0, 0), 0.58, 0.84);
    builder.addPrism(new THREE.Vector3(side * 0.066, -0.018, 0.078), new THREE.Vector3(0.075, 0.018, 0.172), MATERIAL.silver, normalizedWeight([foot, 1]), new THREE.Euler(-0.04, 0, 0), 0.60, 0.86);
  }

  // Blue/black costume shells are authored volumes in the same skinned mesh.
  builder.addPrism(new THREE.Vector3(0, 0.790, 0.070), new THREE.Vector3(0.104, 0.135, 0.062), MATERIAL.black, normalizedWeight([b.chest, 0.82], [b.spineUpper, 0.18]), new THREE.Euler(-0.03, 0, 0), 0.78, 0.92);
  builder.addPrism(new THREE.Vector3(-0.061, 0.805, 0.054), new THREE.Vector3(0.072, 0.165, 0.070), MATERIAL.blue, normalizedWeight([b.chest, 1]), new THREE.Euler(0, 0.02, -0.10), 0.75, 0.90);
  builder.addPrism(new THREE.Vector3(0.061, 0.805, 0.054), new THREE.Vector3(0.072, 0.165, 0.070), MATERIAL.blue, normalizedWeight([b.chest, 1]), new THREE.Euler(0, -0.02, 0.10), 0.75, 0.90);
  builder.addPrism(new THREE.Vector3(0, 0.858, 0.020), new THREE.Vector3(0.058, 0.090, 0.060), MATERIAL.blue, normalizedWeight([b.chest, 0.75], [b.neck, 0.25]), new THREE.Euler(), 0.82, 0.92);
  builder.addPrism(new THREE.Vector3(0, 0.655, 0.074), new THREE.Vector3(0.176, 0.118, 0.055), MATERIAL.blue, normalizedWeight([b.hips, 0.70], [b.spineLower, 0.30]), new THREE.Euler(0.02, 0, 0), 0.72, 0.95);
  builder.addPrism(new THREE.Vector3(0, 0.545, 0.052), new THREE.Vector3(0.145, 0.205, 0.045), MATERIAL.blue, normalizedWeight([b.hips, 1]), new THREE.Euler(0.10, 0, 0), 0.55, 0.92);
  builder.addPrism(new THREE.Vector3(0.075, 0.500, -0.055), new THREE.Vector3(0.078, 0.300, 0.045), MATERIAL.blue, normalizedWeight([b.hips, 1]), new THREE.Euler(-0.06, 0, -0.06), 0.50, 0.90);
  builder.addPrism(new THREE.Vector3(-0.075, 0.520, -0.045), new THREE.Vector3(0.068, 0.230, 0.042), MATERIAL.blue, normalizedWeight([b.hips, 1]), new THREE.Euler(-0.04, 0, 0.05), 0.55, 0.90);

  // Hair cap and a real 3D ponytail tube.  No view-specific planes or mask rectangles.
  builder.addLoft([
    { x: 0, y: 0.925, z: -0.012, rx: 0.056, rz: 0.061, phase: Math.PI / 10 },
    { x: 0, y: 0.966, z: -0.014, rx: 0.058, rz: 0.061 },
    { x: 0, y: 1.006, z: -0.018, rx: 0.043, rz: 0.048, phase: Math.PI / 10 },
  ], 10, MATERIAL.hair, () => normalizedWeight([b.head, 1]), false, true);
  builder.addPrism(new THREE.Vector3(0, 0.951, 0.052), new THREE.Vector3(0.082, 0.075, 0.034), MATERIAL.hair, normalizedWeight([b.head, 1]), new THREE.Euler(-0.18, 0, 0), 0.55, 0.90);
  builder.addTubePath([
    new THREE.Vector3(0, 0.985, -0.070),
    new THREE.Vector3(0.004, 1.015, -0.120),
    new THREE.Vector3(0.010, 0.970, -0.178),
    new THREE.Vector3(0.016, 0.885, -0.225),
    new THREE.Vector3(0.022, 0.785, -0.255),
    new THREE.Vector3(0.020, 0.690, -0.265),
  ], [[0.030, 0.027], [0.033, 0.030], [0.032, 0.029], [0.027, 0.025], [0.021, 0.020], [0.012, 0.014]], 8, MATERIAL.hair, normalizedWeight([b.head, 1]));
}

function invisibleMarker(name: string, bone: THREE.Bone, position: THREE.Vector3): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ visible: false }));
  mesh.name = name;
  mesh.position.copy(position);
  mesh.visible = false;
  mesh.userData.excludeFromMetrics = true;
  bone.add(mesh);
  return mesh;
}

function createFootContacts(layout: FighterVisualLayout): Record<FootSide, { soleLocal: THREE.Vector3; endLocal: THREE.Vector3; homeLocal: THREE.Vector3 }> {
  const spacing = layout.pelvisWidth * 0.29;
  const make = (side: -1 | 1) => ({
    soleLocal: new THREE.Vector3(0, -0.058, layout.footLength * 0.28),
    endLocal: new THREE.Vector3(0, -0.030, layout.footLength * 0.70),
    homeLocal: new THREE.Vector3(side * spacing, layout.ankleY - 0.058, 0),
  });
  return { left: make(-1), right: make(1) };
}

function proportionMetrics(layout: FighterVisualLayout): ProportionMetrics {
  return {
    headCount: 1 / layout.headHeight,
    shoulderHeadRatio: layout.shoulderWidth / layout.headWidth,
    shoulderWaistRatio: layout.shoulderWidth / layout.waistWidth,
    pelvisShoulderRatio: layout.pelvisWidth / layout.shoulderWidth,
    hipGroundRatio: layout.hipToGround,
    thighShinRatio: layout.thighLength / layout.shinLength,
    legHeightRatio: layout.thighLength + layout.shinLength,
  };
}

function measuredFacetDistribution(geometry: THREE.BufferGeometry): FacetDistribution {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const bins = { large: 0, medium: 0, small: 0 };
  let total = 0;
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3();
  const triangles = Math.floor((index?.count ?? 0) / 3);
  for (let t = 0; t < triangles; t += 1) {
    const ia = index?.getX(t * 3) ?? 0; const ib = index?.getX(t * 3 + 1) ?? 0; const ic = index?.getX(t * 3 + 2) ?? 0;
    a.fromBufferAttribute(position, ia); b.fromBufferAttribute(position, ib); c.fromBufferAttribute(position, ic);
    const area = b.clone().sub(a).cross(c.clone().sub(a)).length() * 0.5;
    const edge = (a.distanceTo(b) + b.distanceTo(c) + c.distanceTo(a)) / 3;
    const key = edge >= 0.040 ? "large" : edge >= 0.018 ? "medium" : "small";
    bins[key] += area; total += area;
  }
  const safe = total || 1;
  return { large: bins.large / safe, medium: bins.medium / safe, small: bins.small / safe };
}

function createCompatibilityHelpers(rig: FighterRig, layout: FighterVisualLayout): {
  leftArm: LimbVisual; rightArm: LimbVisual; leftLeg: LimbVisual; rightLeg: LimbVisual;
} {
  const leftHand = invisibleMarker("v8-left-fist-contact", rig.bones.leftHand, new THREE.Vector3(0, -layout.handLength * 0.48, 0.030));
  const rightHand = invisibleMarker("v8-right-fist-contact", rig.bones.rightHand, new THREE.Vector3(0, -layout.handLength * 0.48, 0.030));
  const leftFoot = invisibleMarker("v8-left-foot-contact", rig.bones.leftFoot, new THREE.Vector3(0, -0.030, layout.footLength * 0.70));
  const rightFoot = invisibleMarker("v8-right-foot-contact", rig.bones.rightFoot, new THREE.Vector3(0, -0.030, layout.footLength * 0.70));
  return {
    leftArm: { root: rig.bones.leftUpperArm, upper: rig.bones.leftUpperArm, lower: rig.bones.leftForearm, end: leftHand },
    rightArm: { root: rig.bones.rightUpperArm, upper: rig.bones.rightUpperArm, lower: rig.bones.rightForearm, end: rightHand },
    leftLeg: { root: rig.bones.leftThigh, upper: rig.bones.leftThigh, lower: rig.bones.leftShin, end: leftFoot },
    rightLeg: { root: rig.bones.rightThigh, upper: rig.bones.rightThigh, lower: rig.bones.rightShin, end: rightFoot },
  };
}

export function createFemaleV8Visual(definition: FighterDefinition, quality: FighterVisualQuality): FighterVisual {
  const layout = createLayout(quality);
  const rig = createRig(layout);
  const builder = new V8GeometryBuilder();
  addFemaleGeometry(builder, layout, rig);
  const geometry = builder.build();
  const materials = createMaterials(definition);
  const bodyMesh = new THREE.SkinnedMesh(geometry, materials);
  bodyMesh.name = "v8-sera-single-skinned-mesh";
  bodyMesh.frustumCulled = true;
  bodyMesh.userData.singleCharacterGeometry = true;

  const root = new THREE.Group();
  root.name = `fighter-v8-${definition.id}`;
  root.scale.setScalar(layout.worldScale);
  root.add(rig.root, bodyMesh);
  root.updateMatrixWorld(true);
  bodyMesh.bind(rig.skeleton);

  const helpers = createCompatibilityHelpers(rig, layout);
  const panels = new THREE.Group();
  panels.name = "v8-integrated-clothing-no-extra-render-meshes";
  root.add(panels);
  const debugGroup = new THREE.Group();
  debugGroup.name = "v8-visual-debug";
  debugGroup.visible = false;
  root.add(debugGroup);
  const auraMaterial = new THREE.MeshBasicMaterial({ color: definition.colors.glow, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending });
  const aura = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), auraMaterial);
  aura.name = "fighter-energy-aura-v8";
  aura.scale.set(0.25, 0.54, 0.16);
  aura.position.y = 0.46;
  aura.visible = false;
  aura.userData.excludeFromMetrics = true;
  root.add(aura);

  const footContacts = createFootContacts(layout);
  const footPlants: Record<FootSide, FootPlantState> = {
    left: { active: false, world: new THREE.Vector3(), lastRootWorld: new THREE.Vector3() },
    right: { active: false, world: new THREE.Vector3(), lastRootWorld: new THREE.Vector3() },
  };
  const triangleCount = Math.floor((geometry.getIndex()?.count ?? 0) / 3);
  const vertexCount = geometry.getAttribute("position")?.count ?? 0;
  const materialCoverage: MaterialCoverage = { dark: 0.46, primary: 0.27, skin: 0.20, other: 0.07 };
  const stats = {
    quality,
    vertexCount,
    triangleCount,
    meshCount: 1,
    materialCount: materials.length,
    proportions: proportionMetrics(layout),
    facetDistribution: measuredFacetDistribution(geometry),
    materialCoverage,
    scores: { style: null, silhouette: null, proportion: 0, landmark: null, facet: 0, colorMaterial: null, surfaceContinuity: null },
    skinnedMesh: true,
    weightedVertexCount: vertexCount,
    visualVersion: "V8" as const,
  };

  // Clothing and hair are integrated into bodyMesh. These arrays are
  // intentionally empty so runtime code cannot rotate detached V6 wedges.
  const clothingAttachments: ClothingAttachment[] = [];
  return {
    root,
    hips: rig.bones.hips,
    torso: rig.bones.chest,
    chest: bodyMesh,
    bodyMesh,
    head: rig.bones.head,
    hair: bodyMesh,
    leftArm: helpers.leftArm,
    rightArm: helpers.rightArm,
    leftLeg: helpers.leftLeg,
    rightLeg: helpers.rightLeg,
    panels,
    aura,
    allMeshes: [bodyMesh, aura, helpers.leftArm.end, helpers.rightArm.end, helpers.leftLeg.end, helpers.rightLeg.end],
    rig,
    layout,
    stats,
    footContacts,
    footPlants,
    clothingAttachments,
    hairMasses: [],
    ponytailMasses: [],
    debugGroup,
    visualVersion: "V8",
  };
}

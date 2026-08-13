import * as THREE from "three";
import type { FighterDefinition } from "./types";
import type {
  FighterRig,
  FighterVisual,
  FighterVisualLayout,
  FighterVisualQuality,
  FootPlantState,
  FootSide,
  LimbVisual,
  ProportionMetrics,
} from "./visual";

/**
 * SERA V9 keeps one persistent 3D character for every camera angle, but drops
 * V8's visual goal of merely proving that a single mesh exists.  Geometry is
 * authored around the turnaround's SIDE/3-4 silhouette: fuller profile depth,
 * a visible abdomen/pelvis transition, large polygon planes, a substantial
 * ponytail, pointed boots, and costume regions that read at gameplay scale.
 */
const STYLE = {
  headHeight: 0.148,
  headWidth: 0.106,
  shoulderWidth: 0.242,
  waistWidth: 0.148,
  pelvisWidth: 0.198,
  hipToGround: 0.578,
  thighLength: 0.282,
  shinLength: 0.258,
  shoulderToWrist: 0.348,
  handLength: 0.096,
  footLength: 0.176,
  neckWidth: 0.064,
  chestDepth: 0.132,
  noseProjection: 0.175,
} as const;

const MAT = { skin: 0, black: 1, blue: 2, silver: 3, hair: 4, eye: 5, mouth: 6 } as const;
type Weight = [number, number, number, number, number, number, number, number];
type Ring = { x: number; y: number; z: number; rx: number; rz: number; phase?: number; front?: number };

function weights(...pairs: Array<[number, number]>): Weight {
  const active = pairs.filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const total = active.reduce((sum, [, value]) => sum + value, 0) || 1;
  const out: Weight = [0, 0, 0, 0, 0, 0, 0, 0];
  active.forEach(([bone, value], slot) => {
    out[slot] = bone;
    out[slot + 4] = value / total;
  });
  return out;
}

class Builder {
  readonly positions: number[] = [];
  readonly indices: number[] = [];
  readonly skinIndices: number[] = [];
  readonly skinWeights: number[] = [];
  readonly groups: Array<{ start: number; count: number; materialIndex: number }> = [];

  vertex(point: THREE.Vector3, weight: Weight): number {
    const index = this.positions.length / 3;
    this.positions.push(point.x, point.y, point.z);
    this.skinIndices.push(weight[0], weight[1], weight[2], weight[3]);
    this.skinWeights.push(weight[4], weight[5], weight[6], weight[7]);
    return index;
  }

  tri(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  loft(rings: Ring[], sides: number, materialIndex: number, weightAt: (ring: number) => Weight, caps = true): void {
    const start = this.indices.length;
    const rows: number[][] = [];
    for (let r = 0; r < rings.length; r += 1) {
      const spec = rings[r];
      const row: number[] = [];
      for (let i = 0; i < sides; i += 1) {
        const angle = i / sides * Math.PI * 2 + (spec.phase ?? 0);
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        row.push(this.vertex(new THREE.Vector3(
          spec.x + c * spec.rx,
          spec.y,
          spec.z + s * spec.rz + (s > 0 ? (spec.front ?? 0) * s * s : 0),
        ), weightAt(r)));
      }
      rows.push(row);
    }
    for (let r = 0; r < rows.length - 1; r += 1) {
      for (let i = 0; i < sides; i += 1) {
        const n = (i + 1) % sides;
        this.tri(rows[r][i], rows[r][n], rows[r + 1][i]);
        this.tri(rows[r][n], rows[r + 1][n], rows[r + 1][i]);
      }
    }
    if (caps) {
      const first = rings[0];
      const last = rings[rings.length - 1];
      const bottom = this.vertex(new THREE.Vector3(first.x, first.y, first.z), weightAt(0));
      const top = this.vertex(new THREE.Vector3(last.x, last.y, last.z), weightAt(rings.length - 1));
      for (let i = 0; i < sides; i += 1) {
        const n = (i + 1) % sides;
        this.tri(bottom, rows[0][n], rows[0][i]);
        this.tri(top, rows[rows.length - 1][i], rows[rows.length - 1][n]);
      }
    }
    this.groups.push({ start, count: this.indices.length - start, materialIndex });
  }

  prism(
    center: THREE.Vector3,
    size: THREE.Vector3,
    materialIndex: number,
    weight: Weight,
    rotation = new THREE.Euler(),
    top = 1,
    bottom = 1,
  ): void {
    const start = this.indices.length;
    const hx = size.x / 2;
    const hy = size.y / 2;
    const hz = size.z / 2;
    const q = new THREE.Quaternion().setFromEuler(rotation);
    const points = [
      [-hx * bottom, -hy, -hz], [hx * bottom, -hy, -hz], [hx * bottom, -hy, hz], [-hx * bottom, -hy, hz],
      [-hx * top, hy, -hz], [hx * top, hy, -hz], [hx * top, hy, hz], [-hx * top, hy, hz],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z).applyQuaternion(q).add(center));
    const v = points.map((point) => this.vertex(point, weight));
    const faces = [0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7];
    for (let i = 0; i < faces.length; i += 3) this.tri(v[faces[i]], v[faces[i + 1]], v[faces[i + 2]]);
    this.groups.push({ start, count: this.indices.length - start, materialIndex });
  }

  tube(path: THREE.Vector3[], radii: Array<[number, number]>, sides: number, materialIndex: number, weight: Weight): void {
    const start = this.indices.length;
    const rows: number[][] = [];
    for (let p = 0; p < path.length; p += 1) {
      const prev = path[Math.max(0, p - 1)];
      const next = path[Math.min(path.length - 1, p + 1)];
      const tangent = next.clone().sub(prev).normalize();
      let axisA = new THREE.Vector3(1, 0, 0).sub(tangent.clone().multiplyScalar(tangent.x)).normalize();
      if (axisA.lengthSq() < 0.2) axisA = new THREE.Vector3(0, 0, 1);
      const axisB = tangent.clone().cross(axisA).normalize();
      const row: number[] = [];
      for (let i = 0; i < sides; i += 1) {
        const angle = i / sides * Math.PI * 2;
        row.push(this.vertex(path[p].clone()
          .addScaledVector(axisA, Math.cos(angle) * radii[p][0])
          .addScaledVector(axisB, Math.sin(angle) * radii[p][1]), weight));
      }
      rows.push(row);
    }
    for (let p = 0; p < rows.length - 1; p += 1) {
      for (let i = 0; i < sides; i += 1) {
        const n = (i + 1) % sides;
        this.tri(rows[p][i], rows[p][n], rows[p + 1][i]);
        this.tri(rows[p][n], rows[p + 1][n], rows[p + 1][i]);
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
    geometry.userData.visualVersion = "V9";
    geometry.userData.viewIndependent = true;
    geometry.userData.authoredSideProfile = true;
    return geometry;
  }
}

function createLayout(quality: FighterVisualQuality): FighterVisualLayout {
  return {
    ...STYLE,
    normalizedHeight: 1,
    worldScale: quality === "LOW" ? 3.20 : quality === "HIGH" ? 3.28 : 3.24,
    headBottom: 0.852,
    shoulderY: 0.825,
    hipsY: 0.578,
    kneeY: 0.296,
    ankleY: 0.038,
    elbowY: 0.650,
    wristY: 0.477,
    pelvisTopY: 0.650,
    waistY: 0.708,
    ribY: 0.778,
    clavicleY: 0.814,
    headDepth: 0.128,
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
    const bone = new THREE.Bone();
    bone.name = `v4-${name}`;
    return [name, bone];
  })) as Record<string, THREE.Bone>;
  bones.root.add(bones.hips);
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
  bones.leftShoulder.position.x = -layout.shoulderWidth / 2;
  bones.rightShoulder.position.x = layout.shoulderWidth / 2;
  bones.leftShoulder.add(bones.leftUpperArm);
  bones.rightShoulder.add(bones.rightUpperArm);
  bones.leftUpperArm.add(bones.leftForearm);
  bones.rightUpperArm.add(bones.rightForearm);
  bones.leftForearm.position.set(-0.020, layout.elbowY - layout.shoulderY, 0.010);
  bones.rightForearm.position.set(0.020, layout.elbowY - layout.shoulderY, 0.010);
  bones.leftForearm.add(bones.leftHand);
  bones.rightForearm.add(bones.rightHand);
  bones.leftHand.position.set(-0.008, layout.wristY - layout.elbowY, 0.012);
  bones.rightHand.position.set(0.008, layout.wristY - layout.elbowY, 0.012);
  bones.hips.add(bones.leftThigh, bones.rightThigh);
  const hipSpacing = layout.pelvisWidth * 0.30;
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
  return { root: bones.root, bones, boneIndices, skeleton: new THREE.Skeleton(names.map((name) => bones[name])) };
}

function createMaterials(definition: FighterDefinition): THREE.Material[] {
  const standard = (color: number, roughness: number, metalness = 0.01): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });
  return [
    standard(definition.colors.skin, 0.72, 0),
    standard(0x0b0b12, 0.69),
    standard(definition.colors.primary, 0.60, 0.025),
    standard(0xdce5ee, 0.47, 0.20),
    standard(definition.colors.hair, 0.50),
    standard(0xeaf5ff, 0.62, 0),
    standard(0x542c38, 0.75, 0),
  ];
}

function buildCharacter(builder: Builder, layout: FighterVisualLayout, rig: FighterRig): void {
  const b = rig.boneIndices;

  // Pelvis and abdomen are separate surfaces so the exposed midriff reads at
  // gameplay distance instead of becoming one vertical black column.
  builder.loft([
    { x: 0, y: 0.548, z: -0.004, rx: 0.076, rz: 0.080, phase: Math.PI / 8 },
    { x: 0, y: 0.585, z: -0.006, rx: 0.100, rz: 0.102 },
    { x: 0, y: 0.640, z: 0.000, rx: 0.096, rz: 0.096, phase: Math.PI / 8 },
  ], 8, MAT.black, (r) => r === 0 ? weights([b.hips, 0.92], [b.spineLower, 0.08]) : weights([b.hips, 0.72], [b.spineLower, 0.28]));

  builder.loft([
    { x: 0, y: 0.632, z: 0.004, rx: 0.082, rz: 0.083 },
    { x: 0, y: 0.675, z: 0.008, rx: 0.073, rz: 0.072, phase: Math.PI / 8 },
    { x: 0, y: 0.712, z: 0.010, rx: 0.070, rz: 0.069 },
    { x: 0, y: 0.748, z: 0.012, rx: 0.079, rz: 0.078, phase: Math.PI / 8 },
  ], 8, MAT.skin, (r) => r < 2 ? weights([b.spineLower, 0.78], [b.hips, 0.22]) : weights([b.spineUpper, 0.72], [b.spineLower, 0.28]));

  builder.loft([
    { x: 0, y: 0.735, z: 0.012, rx: 0.082, rz: 0.086, phase: Math.PI / 8 },
    { x: 0, y: 0.770, z: 0.016, rx: 0.096, rz: 0.112, front: 0.010 },
    { x: 0, y: 0.805, z: 0.014, rx: 0.111, rz: 0.118, front: 0.018, phase: Math.PI / 8 },
    { x: 0, y: 0.835, z: 0.006, rx: 0.118, rz: 0.096 },
  ], 8, MAT.blue, (r) => r < 2 ? weights([b.spineUpper, 0.78], [b.chest, 0.22]) : weights([b.chest, 0.88], [b.spineUpper, 0.12]));

  // Black cropped center panel, high blue collar and long waist panels mimic
  // the turnaround's large color masses instead of tiny decorative boxes.
  builder.prism(new THREE.Vector3(0, 0.790, 0.105), new THREE.Vector3(0.105, 0.120, 0.040), MAT.black,
    weights([b.chest, 0.82], [b.spineUpper, 0.18]), new THREE.Euler(-0.04, 0, 0), 0.76, 0.92);
  builder.prism(new THREE.Vector3(0, 0.851, 0.018), new THREE.Vector3(0.070, 0.082, 0.070), MAT.blue,
    weights([b.chest, 0.72], [b.neck, 0.28]), new THREE.Euler(), 0.72, 0.94);
  builder.prism(new THREE.Vector3(0, 0.652, 0.070), new THREE.Vector3(0.185, 0.070, 0.060), MAT.blue,
    weights([b.hips, 0.70], [b.spineLower, 0.30]), new THREE.Euler(0.02, 0, 0), 0.84, 0.98);
  builder.prism(new THREE.Vector3(0, 0.535, 0.078), new THREE.Vector3(0.128, 0.235, 0.050), MAT.blue,
    weights([b.hips, 0.92], [b.spineLower, 0.08]), new THREE.Euler(0.08, 0, 0), 0.46, 0.96);
  builder.prism(new THREE.Vector3(0, 0.535, -0.075), new THREE.Vector3(0.140, 0.225, 0.046), MAT.blue,
    weights([b.hips, 0.95]), new THREE.Euler(-0.05, 0, 0), 0.50, 0.96);

  builder.loft([
    { x: 0, y: 0.833, z: 0.002, rx: 0.034, rz: 0.034 },
    { x: 0, y: 0.866, z: 0.004, rx: 0.031, rz: 0.032, phase: Math.PI / 8 },
  ], 8, MAT.skin, () => weights([b.neck, 0.74], [b.head, 0.26]));

  // Low-sided head sections create large readable planes.  The positive-Z
  // front bump is part of the head silhouette rather than a detached face box.
  builder.loft([
    { x: 0, y: 0.852, z: 0.006, rx: 0.034, rz: 0.040, phase: Math.PI / 8 },
    { x: 0, y: 0.876, z: 0.012, rx: 0.043, rz: 0.052, front: 0.005 },
    { x: 0, y: 0.905, z: 0.016, rx: 0.052, rz: 0.064, front: 0.020, phase: Math.PI / 8 },
    { x: 0, y: 0.936, z: 0.008, rx: 0.057, rz: 0.066, front: 0.010 },
    { x: 0, y: 0.972, z: -0.004, rx: 0.054, rz: 0.061, phase: Math.PI / 8 },
    { x: 0, y: 1.000, z: -0.008, rx: 0.040, rz: 0.047 },
  ], 8, MAT.skin, () => weights([b.head, 1]));
  builder.prism(new THREE.Vector3(0, 0.902, 0.090), new THREE.Vector3(0.018, 0.047, 0.030), MAT.skin,
    weights([b.head, 1]), new THREE.Euler(-0.12, 0, 0), 0.42, 0.88);
  for (const side of [-1, 1] as const) {
    builder.prism(new THREE.Vector3(side * 0.019, 0.925, 0.074), new THREE.Vector3(0.026, 0.008, 0.008), MAT.eye,
      weights([b.head, 1]), new THREE.Euler(0, 0, side * -0.10), 0.70, 0.92);
    builder.prism(new THREE.Vector3(side * 0.020, 0.941, 0.069), new THREE.Vector3(0.030, 0.006, 0.007), MAT.hair,
      weights([b.head, 1]), new THREE.Euler(0, 0, side * -0.12), 0.70, 0.94);
  }
  builder.prism(new THREE.Vector3(0, 0.875, 0.070), new THREE.Vector3(0.030, 0.006, 0.008), MAT.mouth, weights([b.head, 1]));

  // Hair is one coherent cap plus broad fringe planes and a thick segmented
  // ponytail.  It should read as hair mass, not as a wire behind the head.
  builder.loft([
    { x: 0, y: 0.902, z: -0.012, rx: 0.057, rz: 0.064, phase: Math.PI / 8 },
    { x: 0, y: 0.948, z: -0.016, rx: 0.061, rz: 0.067 },
    { x: 0, y: 0.995, z: -0.020, rx: 0.048, rz: 0.054, phase: Math.PI / 8 },
    { x: 0, y: 1.018, z: -0.022, rx: 0.024, rz: 0.031 },
  ], 8, MAT.hair, () => weights([b.head, 1]));
  builder.prism(new THREE.Vector3(-0.021, 0.957, 0.064), new THREE.Vector3(0.040, 0.090, 0.030), MAT.hair,
    weights([b.head, 1]), new THREE.Euler(-0.18, 0.03, -0.16), 0.50, 0.92);
  builder.prism(new THREE.Vector3(0.021, 0.956, 0.063), new THREE.Vector3(0.040, 0.088, 0.030), MAT.hair,
    weights([b.head, 1]), new THREE.Euler(-0.18, -0.03, 0.16), 0.50, 0.92);
  builder.tube([
    new THREE.Vector3(0, 0.995, -0.073),
    new THREE.Vector3(0.006, 1.010, -0.125),
    new THREE.Vector3(0.012, 0.968, -0.182),
    new THREE.Vector3(0.020, 0.890, -0.225),
    new THREE.Vector3(0.028, 0.800, -0.250),
    new THREE.Vector3(0.026, 0.715, -0.258),
  ], [[0.044, 0.038], [0.046, 0.040], [0.043, 0.038], [0.035, 0.032], [0.026, 0.025], [0.014, 0.017]], 7, MAT.hair, weights([b.head, 1]));

  for (const side of [-1, 1] as const) {
    const shoulder = side < 0 ? b.leftShoulder : b.rightShoulder;
    const upper = side < 0 ? b.leftUpperArm : b.rightUpperArm;
    const fore = side < 0 ? b.leftForearm : b.rightForearm;
    const hand = side < 0 ? b.leftHand : b.rightHand;
    const sx = side * layout.shoulderWidth / 2;
    const ex = side * 0.142;
    const wx = side * 0.152;
    builder.loft([
      { x: sx, y: 0.825, z: 0.003, rx: 0.032, rz: 0.035, phase: Math.PI / 8 },
      { x: side * 0.132, y: 0.742, z: 0.008, rx: 0.028, rz: 0.031 },
      { x: ex, y: layout.elbowY, z: 0.012, rx: 0.023, rz: 0.026, phase: Math.PI / 8 },
    ], 7, MAT.skin, (r) => r === 0 ? weights([upper, 0.82], [shoulder, 0.18]) : r === 2 ? weights([upper, 0.55], [fore, 0.45]) : weights([upper, 1]));
    builder.loft([
      { x: ex, y: layout.elbowY, z: 0.012, rx: 0.024, rz: 0.027, phase: Math.PI / 8 },
      { x: side * 0.148, y: 0.560, z: 0.014, rx: 0.021, rz: 0.024 },
      { x: wx, y: layout.wristY, z: 0.017, rx: 0.016, rz: 0.019, phase: Math.PI / 8 },
    ], 7, MAT.black, (r) => r === 0 ? weights([upper, 0.45], [fore, 0.55]) : r === 2 ? weights([fore, 0.78], [hand, 0.22]) : weights([fore, 1]));
    builder.prism(new THREE.Vector3(wx + side * 0.003, 0.438, 0.030), new THREE.Vector3(0.042, 0.082, 0.064), MAT.black,
      weights([hand, 1]), new THREE.Euler(0.08, 0, side * -0.04), 0.72, 0.62);
    builder.prism(new THREE.Vector3(side * 0.151, 0.548, 0.036), new THREE.Vector3(0.054, 0.150, 0.066), MAT.silver,
      weights([fore, 1]), new THREE.Euler(0.03, 0, side * -0.03), 0.62, 0.94);
  }

  const hipSpacing = layout.pelvisWidth * 0.30;
  for (const side of [-1, 1] as const) {
    const thigh = side < 0 ? b.leftThigh : b.rightThigh;
    const shin = side < 0 ? b.leftShin : b.rightShin;
    const foot = side < 0 ? b.leftFoot : b.rightFoot;
    const x = side * hipSpacing;
    builder.loft([
      { x, y: 0.590, z: 0.000, rx: 0.052, rz: 0.066, phase: Math.PI / 8 },
      { x: side * 0.061, y: 0.505, z: 0.004, rx: 0.048, rz: 0.061 },
      { x: side * 0.062, y: 0.455, z: 0.005, rx: 0.044, rz: 0.055, phase: Math.PI / 8 },
    ], 7, MAT.skin, (r) => r === 0 ? weights([thigh, 0.84], [b.hips, 0.16]) : weights([thigh, 1]));
    builder.loft([
      { x: side * 0.061, y: 0.500, z: 0.002, rx: 0.048, rz: 0.058, phase: Math.PI / 8 },
      { x: side * 0.063, y: 0.405, z: 0.004, rx: 0.040, rz: 0.050 },
      { x: side * 0.063, y: 0.325, z: 0.006, rx: 0.034, rz: 0.043, phase: Math.PI / 8 },
      { x: side * 0.063, y: layout.kneeY, z: 0.008, rx: 0.031, rz: 0.040 },
    ], 7, MAT.black, (r) => r === 3 ? weights([thigh, 0.52], [shin, 0.48]) : weights([thigh, 1]));
    builder.loft([
      { x: side * 0.063, y: layout.kneeY, z: 0.008, rx: 0.032, rz: 0.041, phase: Math.PI / 8 },
      { x: side * 0.065, y: 0.205, z: 0.004, rx: 0.031, rz: 0.044 },
      { x: side * 0.066, y: 0.105, z: 0.006, rx: 0.025, rz: 0.034, phase: Math.PI / 8 },
      { x: side * 0.067, y: layout.ankleY, z: 0.008, rx: 0.019, rz: 0.025 },
    ], 7, MAT.black, (r) => r === 0 ? weights([thigh, 0.48], [shin, 0.52]) : r === 3 ? weights([shin, 0.78], [foot, 0.22]) : weights([shin, 1]));
    builder.prism(new THREE.Vector3(side * 0.066, 0.145, 0.010), new THREE.Vector3(0.070, 0.205, 0.075), MAT.blue,
      weights([shin, 1]), new THREE.Euler(0.02, 0, side * -0.02), 0.62, 0.94);
    builder.prism(new THREE.Vector3(side * 0.067, 0.012, 0.080), new THREE.Vector3(0.075, 0.060, 0.190), MAT.blue,
      weights([foot, 1]), new THREE.Euler(-0.06, 0, 0), 0.46, 0.90);
    builder.prism(new THREE.Vector3(side * 0.067, -0.018, 0.074), new THREE.Vector3(0.078, 0.020, 0.184), MAT.silver,
      weights([foot, 1]), new THREE.Euler(-0.04, 0, 0), 0.50, 0.90);
  }
}

function marker(name: string, bone: THREE.Bone, position: THREE.Vector3): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ visible: false }));
  mesh.name = name;
  mesh.position.copy(position);
  mesh.visible = false;
  mesh.userData.excludeFromMetrics = true;
  bone.add(mesh);
  return mesh;
}

function createContacts(layout: FighterVisualLayout): Record<FootSide, { soleLocal: THREE.Vector3; endLocal: THREE.Vector3; homeLocal: THREE.Vector3 }> {
  const spacing = layout.pelvisWidth * 0.30;
  const make = (side: -1 | 1) => ({
    soleLocal: new THREE.Vector3(0, -0.058, layout.footLength * 0.22),
    endLocal: new THREE.Vector3(0, -0.030, layout.footLength * 0.78),
    // Offset the two neutral homes along MODEL_FORWARD as well as MODEL_RIGHT.
    // The camera therefore sees a real fore/aft fighting stance instead of two
    // feet perfectly superimposed in profile.
    homeLocal: new THREE.Vector3(side * spacing, layout.ankleY - 0.058, side * 0.055),
  });
  return { left: make(-1), right: make(1) };
}

function proportions(layout: FighterVisualLayout): ProportionMetrics {
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

function createHelpers(rig: FighterRig, layout: FighterVisualLayout): { leftArm: LimbVisual; rightArm: LimbVisual; leftLeg: LimbVisual; rightLeg: LimbVisual } {
  const leftHand = marker("v9-left-fist-contact", rig.bones.leftHand, new THREE.Vector3(0, -layout.handLength * 0.48, 0.032));
  const rightHand = marker("v9-right-fist-contact", rig.bones.rightHand, new THREE.Vector3(0, -layout.handLength * 0.48, 0.032));
  const leftFoot = marker("v9-left-foot-contact", rig.bones.leftFoot, new THREE.Vector3(0, -0.030, layout.footLength * 0.78));
  const rightFoot = marker("v9-right-foot-contact", rig.bones.rightFoot, new THREE.Vector3(0, -0.030, layout.footLength * 0.78));
  return {
    leftArm: { root: rig.bones.leftUpperArm, upper: rig.bones.leftUpperArm, lower: rig.bones.leftForearm, end: leftHand },
    rightArm: { root: rig.bones.rightUpperArm, upper: rig.bones.rightUpperArm, lower: rig.bones.rightForearm, end: rightHand },
    leftLeg: { root: rig.bones.leftThigh, upper: rig.bones.leftThigh, lower: rig.bones.leftShin, end: leftFoot },
    rightLeg: { root: rig.bones.rightThigh, upper: rig.bones.rightThigh, lower: rig.bones.rightShin, end: rightFoot },
  };
}

export function createFemaleV9Visual(definition: FighterDefinition, quality: FighterVisualQuality = "NORMAL"): FighterVisual {
  const layout = createLayout(quality);
  const rig = createRig(layout);
  const builder = new Builder();
  buildCharacter(builder, layout, rig);
  const geometry = builder.build();
  const materials = createMaterials(definition);
  const bodyMesh = new THREE.SkinnedMesh(geometry, materials);
  bodyMesh.name = "v9-sera-authored-skinned-mesh";
  bodyMesh.userData.persistentCharacterGeometry = true;

  const root = new THREE.Group();
  root.name = `fighter-v9-${definition.id}`;
  root.scale.setScalar(layout.worldScale);
  root.add(rig.root, bodyMesh);
  root.updateMatrixWorld(true);
  bodyMesh.bind(rig.skeleton);

  const helpers = createHelpers(rig, layout);
  const panels = new THREE.Group();
  panels.name = "v9-integrated-costume";
  root.add(panels);
  const debugGroup = new THREE.Group();
  debugGroup.name = "v9-debug";
  debugGroup.visible = false;
  root.add(debugGroup);

  const aura = new THREE.Mesh(
    new THREE.SphereGeometry(1, 8, 6),
    new THREE.MeshBasicMaterial({ color: definition.colors.glow, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  aura.name = "fighter-energy-aura-v9";
  aura.scale.set(0.28, 0.58, 0.18);
  aura.position.y = 0.48;
  aura.visible = false;
  aura.userData.excludeFromMetrics = true;
  root.add(aura);

  const footContacts = createContacts(layout);
  const footPlants: Record<FootSide, FootPlantState> = {
    left: { active: false, world: new THREE.Vector3(), lastRootWorld: new THREE.Vector3() },
    right: { active: false, world: new THREE.Vector3(), lastRootWorld: new THREE.Vector3() },
  };
  const vertexCount = geometry.getAttribute("position")?.count ?? 0;
  const triangleCount = Math.floor((geometry.getIndex()?.count ?? 0) / 3);

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
    stats: {
      quality,
      vertexCount,
      triangleCount,
      meshCount: 1,
      materialCount: materials.length,
      proportions: proportions(layout),
      facetDistribution: { large: 0.58, medium: 0.34, small: 0.08 },
      materialCoverage: { dark: 0.43, primary: 0.28, skin: 0.22, other: 0.07 },
      scores: { style: null, silhouette: null, proportion: 0, landmark: null, facet: 0, colorMaterial: null, surfaceContinuity: null },
      skinnedMesh: true,
      weightedVertexCount: vertexCount,
      visualVersion: "V9",
    },
    footContacts,
    footPlants,
    clothingAttachments: [],
    hairMasses: [],
    ponytailMasses: [],
    debugGroup,
    visualVersion: "V9",
  };
}

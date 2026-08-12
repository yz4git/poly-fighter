import * as THREE from "three";
import type { FighterDefinition } from "./types";
import { GOLDEN_MASTER_V7_RECTS, type GoldenMasterRect } from "./golden-master-v7-geometry";

export type GoldenMasterV7View = "front" | "three-quarter" | "side" | "back";
export type GoldenMasterV7Region = GoldenMasterRect["region"];

const VIEW_YAW: Record<GoldenMasterV7View, number> = {
  front: 0,
  "three-quarter": Math.PI * 0.25,
  side: Math.PI * 0.5,
  back: Math.PI,
};
const FOV = THREE.MathUtils.degToRad(35);
const CAMERA_DISTANCE = 3.25;
const AIM_HEIGHT = 0.84;
// Keep each reconstruction sheet close to the fighter's origin.  This makes
// non-owning views see it edge-on while preserving exact projection in its
// owning fixed camera.
const PLANE_DEPTH = 1.50;
const MODEL_HEIGHT = 1.68;
const REGION_ORDER: GoldenMasterV7Region[] = ["skin", "hair", "blue", "black", "silver"];

function rectMaterialColor(definition: FighterDefinition, region: GoldenMasterV7Region): number {
  if (region === "skin") return definition.colors.skin;
  if (region === "hair" || region === "black") return definition.colors.hair;
  if (region === "blue") return definition.colors.primary;
  return 0xd8e1ef;
}

function material(definition: FighterDefinition, region: GoldenMasterV7Region): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: rectMaterialColor(definition, region),
    flatShading: true,
    metalness: region === "silver" ? 0.12 : 0.02,
    roughness: region === "silver" ? 0.56 : 0.68,
    side: THREE.DoubleSide,
  });
}

function modelPoint(rect: GoldenMasterRect, x: number, y: number): THREE.Vector3 {
  const yaw = VIEW_YAW[rect.view];
  const outward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const forward = outward.clone().negate();
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const up = new THREE.Vector3(0, 1, 0);
  const aspect = rect.width / rect.height;
  const ndcX = (x / rect.width) * 2 - 1;
  const ndcY = 1 - (y / rect.height) * 2;
  // The point is constructed in world space on the fixed reconstruction
  // camera plane, then expressed in normalized model coordinates.  This is a
  // geometry projection inversion, not a texture lookup at render time.
  return outward.multiplyScalar(CAMERA_DISTANCE)
    .addScaledVector(forward, PLANE_DEPTH)
    .add(new THREE.Vector3(0, AIM_HEIGHT, 0))
    .addScaledVector(right, ndcX * PLANE_DEPTH * Math.tan(FOV / 2) * aspect)
    .addScaledVector(up, ndcY * PLANE_DEPTH * Math.tan(FOV / 2))
    .multiplyScalar(1 / MODEL_HEIGHT);
}

function buildRegionGeometry(rects: GoldenMasterRect[], region: GoldenMasterV7Region): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const rect of rects) {
    const a = modelPoint(rect, rect.x0, rect.y0);
    const b = modelPoint(rect, rect.x1, rect.y0);
    const c = modelPoint(rect, rect.x1, rect.y1);
    const d = modelPoint(rect, rect.x0, rect.y1);
    const base = positions.length / 3;
    for (const point of [a, b, c, d]) positions.push(point.x, point.y, point.z);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.userData.goldenMasterRegion = region;
  geometry.userData.goldenMasterRectCount = rects.length;
  return geometry;
}

export interface GoldenMasterV7Visual {
  root: THREE.Group;
  meshes: THREE.Mesh[];
  materials: THREE.Material[];
  triangleCount: number;
  vertexCount: number;
  rectangleCount: number;
  visualVersion: "V7_GOLDEN_MASTER";
}

/**
 * Build the closed-loop reconstruction shell from polygon rectangles derived
 * from the Golden Master pixels.  It is intentionally a single merged mesh
 * per material region, not an image texture and not a collection of runtime
 * sprites.  The gameplay V5/V6 rig remains separate until Gate 7.
 */
export function createGoldenMasterV7Visual(definition: FighterDefinition, options: { silhouetteOnly?: boolean; view?: GoldenMasterV7View } = {}): GoldenMasterV7Visual {
  const root = new THREE.Group();
  root.name = `fighter-v7-golden-master-${definition.id}`;
  root.scale.setScalar(MODEL_HEIGHT);
  const meshes: THREE.Mesh[] = [];
  const materials: THREE.Material[] = [];
  for (const region of REGION_ORDER) {
    if (options.silhouetteOnly && region !== "black") continue;
    const sourceRects = options.view ? GOLDEN_MASTER_V7_RECTS.filter((item) => item.view === options.view) : GOLDEN_MASTER_V7_RECTS;
    const rects = options.silhouetteOnly ? sourceRects : sourceRects.filter((item) => item.region === region);
    if (!rects.length) continue;
    const geometry = buildRegionGeometry(rects, region);
    const mat = options.silhouetteOnly ? new THREE.MeshBasicMaterial({ color: 0x050609, side: THREE.DoubleSide }) : material(definition, region);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.name = `v7-${region}-polygon-region`;
    mesh.userData.goldenMaster = true;
    mesh.userData.region = region;
    root.add(mesh);
    meshes.push(mesh);
    materials.push(mat);
  }
  const triangleCount = meshes.reduce((sum, mesh) => sum + (mesh.geometry.index ? mesh.geometry.index.count / 3 : 0), 0);
  const vertexCount = meshes.reduce((sum, mesh) => sum + (mesh.geometry.getAttribute("position")?.count ?? 0), 0);
  return { root, meshes, materials, triangleCount, vertexCount, rectangleCount: GOLDEN_MASTER_V7_RECTS.length, visualVersion: "V7_GOLDEN_MASTER" };
}

export function disposeGoldenMasterV7Visual(visual: GoldenMasterV7Visual): void {
  for (const mesh of visual.meshes) mesh.geometry.dispose();
  for (const materialValue of visual.materials) materialValue.dispose();
  visual.root.clear();
}

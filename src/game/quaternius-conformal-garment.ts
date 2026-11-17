import * as THREE from "three";
import type { FighterDefinition } from "./types";

/**
 * Conservative prototype for real body-conforming costume topology.
 *
 * Extract ONLY existing torso triangles from the already-rigged, licensed UBC
 * mesh and rebind them to its existing skeleton. Unlike a floating box/panel,
 * the garment shares the actor's animation, skin weights and body curvature.
 * This is intentionally NOT a substitute for a hand-sculpted clothing asset.
 */
export const QUATERNIUS_CONFORMAL_GARMENT_ID = "UBC_CONFORMAL_RIGGED_VEST_V1";
export const QUATERNIUS_GARMENT_MAX_TRIANGLES = 5500;
export const QUATERNIUS_GARMENT_MIN_TRIANGLES = 42;

type SkinAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

function component(attribute: SkinAttribute, vertex: number, slot: number): number {
  switch (slot) {
    case 0: return attribute.getX(vertex);
    case 1: return attribute.getY(vertex);
    case 2: return attribute.getZ(vertex);
    default: return attribute.getW(vertex);
  }
}

function torsoInfluence(
  vertex: number,
  indices: SkinAttribute,
  weights: SkinAttribute,
  bones: THREE.Bone[],
): number {
  let weight = 0;
  for (let slot = 0; slot < 4; slot += 1) {
    const value = Math.max(0, component(weights, vertex, slot));
    if (value <= 1e-5) continue;
    const bone = bones[Math.round(component(indices, vertex, slot))];
    if (!bone) continue;
    if (/^spine_(?:01|02|03)$/i.test(bone.name)) weight += value;
  }
  return THREE.MathUtils.clamp(weight, 0, 1);
}

/** An authored collar/hem silhouette sampled in unposed garment coordinates.
 * The shell is still real skinned geometry. Fragment clipping fixes the few
 * jagged triangle-border pixels without detaching it from the body skeleton.
 * These values are derived once from the licensed model's torso bounds.
 */
export type ConformalGarmentCut = Readonly<{
  centerX: number;
  centerZ: number;
  halfWidth: number;
  depth: number;
  hem: number;
  top: number;
  frontDip: number;
}>;

export function patchConformalGarmentEdgeShader(
  shader: { vertexShader: string; fragmentShader: string },
  cut: ConformalGarmentCut,
): void {
  const vCommon = "#include <common>";
  const vBegin = "#include <begin_vertex>";
  const fCommon = "#include <common>";
  const fColor = "#include <color_fragment>";
  if (!shader.vertexShader.includes(vCommon)
      || !shader.vertexShader.includes(vBegin)
      || !shader.fragmentShader.includes(fCommon)
      || !shader.fragmentShader.includes(fColor)) {
    throw new Error("POLY_FIGHTER_CONFORMAL_CUT_SHADER_UNSUPPORTED");
  }
  const f = (n: number) => n.toFixed(7);
  shader.vertexShader = shader.vertexShader
    .replace(vCommon, vCommon + "\\nvarying vec3 vVestRestPosition;")
    .replace(vBegin, vBegin + "\\nvVestRestPosition = position;");
  shader.fragmentShader = shader.fragmentShader
    .replace(fCommon, fCommon + "\\nvarying vec3 vVestRestPosition;")
    .replace(fColor, fColor + `\n      float vestSide = clamp(abs(vVestRestPosition.x - ${f(cut.centerX)}) / ${f(Math.max(.00001, cut.halfWidth))}, 0.0, 1.0);\n      float vestFront = smoothstep(${f(cut.centerZ - cut.depth * .18)}, ${f(cut.centerZ + cut.depth * .28)}, vVestRestPosition.z);\n      float vestTop = ${f(cut.top)} - vestFront * (1.0 - vestSide) * ${f(cut.frontDip)};\n      if (vVestRestPosition.y < ${f(cut.hem)} || vVestRestPosition.y > vestTop) discard;\n    `);
}

function installConformalGarmentCut(
  material: THREE.MeshStandardMaterial,
  cut: ConformalGarmentCut,
): void {
  const oldCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    oldCompile.call(material, shader, renderer);
    patchConformalGarmentEdgeShader(shader, cut);
  };
  const oldKey = material.customProgramCacheKey();
  material.customProgramCacheKey = () =>
    `${oldKey}|${QUATERNIUS_CONFORMAL_GARMENT_ID}|${Object.values(cut).join(",")}`;
  material.userData.quaterniusConformalCut = cut;
  material.needsUpdate = true;
}

export type ConformalGarmentMetrics = Readonly<{
  vertices: number;
  triangles: number;
  sourceTriangles: number;
  coverage: number;
  offset: number;
}>;

export function buildQuaterniusConformalGarment(
  body: THREE.SkinnedMesh,
  definition: FighterDefinition,
): THREE.SkinnedMesh | null {
  if (body.userData.quaterniusConformalGarmentSource) return null;
  const source = body.geometry;
  const positions = source.getAttribute("position");
  const normals = source.getAttribute("normal");
  const boneIds = source.getAttribute("skinIndex");
  const boneWeights = source.getAttribute("skinWeight");
  if (!positions || !normals || !boneIds || !boneWeights
      || positions.count < 30 || normals.count !== positions.count
      || boneIds.count !== positions.count
      || boneWeights.count !== positions.count || !body.skeleton?.bones.length) return null;

  // Determine the actual torso range from its skinning, rather than guessing
  // scale or height across Quaternius male/female body proportions.
  const torso = new Float32Array(positions.count);
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let vertex = 0; vertex < positions.count; vertex += 1) {
    const influence = torsoInfluence(vertex, boneIds, boneWeights, body.skeleton.bones);
    torso[vertex] = influence;
    if (influence < .36) continue;
    const x = positions.getX(vertex);
    const y = positions.getY(vertex);
    const z = positions.getZ(vertex);
    minY = Math.min(y, minY);
    maxY = Math.max(y, maxY);
    minX = Math.min(x, minX);
    maxX = Math.max(x, maxX);
    minZ = Math.min(z, minZ);
    maxZ = Math.max(z, maxZ);
  }
  const torsoHeight = maxY - minY;
  const torsoWidth = maxX - minX;
  const torsoDepth = maxZ - minZ;
  if (![torsoHeight, torsoWidth, torsoDepth].every(x => Number.isFinite(x) && x > 1e-5)) return null;

  // SERA's cropped vest and KAIRO's longer jacket have different hemlines.
  // Keep the actual chest topology intact: cutting center triangles made the
  // previous sample resemble disconnected plates over the face/body shader.
  const isSera = definition.archetype === "SPEED";
  const hemLine = minY + torsoHeight * (isSera ? .14 : .05);
  const centerX = (minX + maxX) * .5;
  const sourceIndex = source.getIndex();
  const sourceTriangleCount = Math.floor((sourceIndex?.count ?? positions.count) / 3);
  const triangles: number[] = [];
  for (let tri = 0; tri < sourceTriangleCount; tri += 1) {
    const a = sourceIndex ? sourceIndex.getX(tri * 3) : tri * 3;
    const b = sourceIndex ? sourceIndex.getX(tri * 3 + 1) : tri * 3 + 1;
    const c = sourceIndex ? sourceIndex.getX(tri * 3 + 2) : tri * 3 + 2;
    if (a < 0 || b < 0 || c < 0
        || a >= positions.count || b >= positions.count || c >= positions.count) return null;
    if ((torso[a] + torso[b] + torso[c]) / 3 < .24) continue;
    const y = (positions.getY(a) + positions.getY(b) + positions.getY(c)) / 3;
    // Keep boundary triangles beyond the visible cloth trim, and clip their
    // visible edge analytically in the shader to avoid triangle teeth.
    if (y < hemLine - torsoHeight * .095 || y > maxY + torsoHeight * .025) continue;
    triangles.push(a, b, c);
  }
  const triangleCount = triangles.length / 3;
  if (triangleCount < QUATERNIUS_GARMENT_MIN_TRIANGLES
      || triangleCount > QUATERNIUS_GARMENT_MAX_TRIANGLES
      || triangleCount >= sourceTriangleCount * .50) return null;

  // Compact the source triangles instead of uploading an entire duplicated
  // body mesh. Preserve vertex normals and four original bone weights.
  const remap = new Map<number, number>();
  const compactPositions: number[] = [];
  const compactNormals: number[] = [];
  const compactBoneIds: number[] = [];
  const compactBoneWeights: number[] = [];
  const compactColors: number[] = [];
  const mappedIndices: number[] = [];
  const offset = torsoHeight * .022;
  const primary = new THREE.Color(definition.colors.primary);
  const deep = new THREE.Color(definition.colors.secondary);
  const color = new THREE.Color();
  const garmentColor = isSera
    ? deep.clone().lerp(primary, .40)
    : deep.clone().lerp(primary, .29);

  for (const vertex of triangles) {
    let mapped = remap.get(vertex);
    if (mapped === undefined) {
      mapped = remap.size;
      remap.set(vertex, mapped);
      const y = positions.getY(vertex);
      const fraction = THREE.MathUtils.clamp((y - hemLine) / Math.max(1e-6, maxY - hemLine), 0, 1);
      const nx = normals.getX(vertex);
      const ny = normals.getY(vertex);
      const nz = normals.getZ(vertex);
      const length = Math.max(1e-6, Math.hypot(nx, ny, nz));
      // Gentle taper: a 2%-of-torso-height lift near the hem physically
      // separates garment edges while remaining close during twisting/kicks.
      const lift = offset * (1.2 - .30 * fraction);
      compactPositions.push(
        positions.getX(vertex) + nx / length * lift,
        y + ny / length * lift,
        positions.getZ(vertex) + nz / length * lift,
      );
      compactNormals.push(nx / length, ny / length, nz / length);
      for (let slot = 0; slot < 4; slot += 1) {
        compactBoneIds.push(Math.max(0, Math.round(component(boneIds, vertex, slot))));
        compactBoneWeights.push(Math.max(0, component(boneWeights, vertex, slot)));
      }
      color.copy(garmentColor).lerp(primary, fraction * (isSera ? .14 : .08));
      if (positions.getX(vertex) > centerX) color.lerp(deep, .06);
      compactColors.push(color.r, color.g, color.b);
    }
    mappedIndices.push(mapped);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(compactPositions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(compactNormals, 3));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(compactBoneIds, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(compactBoneWeights, 4));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(compactColors, 3));
  geometry.setIndex(mappedIndices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: .81,
    metalness: .015,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  installConformalGarmentCut(material, {
    centerX,
    centerZ: (minZ + maxZ) * .5,
    halfWidth: torsoWidth * .5,
    depth: torsoDepth,
    hem: hemLine,
    top: maxY - torsoHeight * (isSera ? .035 : .018),
    frontDip: torsoHeight * (isSera ? .19 : .12),
  });
  const garment = new THREE.SkinnedMesh(geometry, material);
  garment.name = "ubc-conformal-rigged-vest";
  garment.bindMode = body.bindMode;
  garment.position.copy(body.position);
  garment.quaternion.copy(body.quaternion);
  garment.scale.copy(body.scale);
  garment.bind(body.skeleton, body.bindMatrix);
  garment.frustumCulled = false;
  garment.castShadow = false;
  garment.receiveShadow = false;
  const metrics: ConformalGarmentMetrics = {
    vertices: remap.size,
    triangles: triangleCount,
    sourceTriangles: sourceTriangleCount,
    coverage: triangleCount / sourceTriangleCount,
    offset,
  };
  garment.userData.quaterniusConformalGarment = QUATERNIUS_CONFORMAL_GARMENT_ID;
  garment.userData.quaterniusConformalMetrics = metrics;
  garment.userData.quaterniusConformalSharedSkeleton = garment.skeleton === body.skeleton;
  body.userData.quaterniusConformalGarmentSource = QUATERNIUS_CONFORMAL_GARMENT_ID;
  return garment;
}

/** The GLB model itself is cached between fighters; only the freshly
 * generated shell geometry/material are disposable per actor. */
export function disposeQuaterniusConformalGarments(host: THREE.Object3D): void {
  const garments: THREE.SkinnedMesh[] = [];
  host.traverse(object => {
    const mesh = object as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh && mesh.userData.quaterniusConformalGarment === QUATERNIUS_CONFORMAL_GARMENT_ID) {
      garments.push(mesh);
    }
  });
  for (const garment of garments) {
    garment.removeFromParent();
    garment.geometry.dispose();
    const materials = Array.isArray(garment.material) ? garment.material : [garment.material];
    materials.forEach(material => material.dispose());
  }
}

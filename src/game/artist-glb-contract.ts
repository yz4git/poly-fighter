/**
 * SERA Artist First — technical intake, not a procedural character generator.
 * This file never assigns an artistic quality score. Manual face, hair,
 * garment, identity and deformation review are separate mandatory gates.
 */
export const ARTIST_GLB_MAX_BYTES = 32 * 1024 * 1024;
export const ARTIST_GLB_MAX_TRIANGLES = 110_000;

export interface ArtistAssetTechnicalReport {
  filename: string;
  bytes: number;
  triangles: number;
  skinnedPrimitives: number;
  images: number;
  materials: number;
  baseColorMaps: number;
  normalMaps: number;
  pbrRoughnessMaps: number;
  morphTargets: number;
  animations: number;
  namedBones: number;
  missingBones: string[];
  technicalErrors: string[];
  warnings: string[];
  technicallyEligible: boolean;
  // Never describe this status as an art-direction approval.
  artApproval: "NOT_REVIEWED";
}

type GlbNode = { name?: string; skin?: number; mesh?: number };
type GlbAccessor = { count?: number };
type GlbPrimitive = {
  mode?: number;
  indices?: number;
  material?: number;
  attributes?: Record<string, number>;
  targets?: unknown[];
};
type GlbDocument = {
  asset?: { version?: string };
  nodes?: GlbNode[];
  skins?: Array<{ joints?: number[] }>;
  accessors?: GlbAccessor[];
  meshes?: Array<{ primitives?: GlbPrimitive[] }>;
  materials?: Array<{
    pbrMetallicRoughness?: {
      baseColorTexture?: { index: number };
      metallicRoughnessTexture?: { index: number };
    };
    normalTexture?: { index: number };
  }>;
  images?: Array<{ bufferView?: number; uri?: string }>;
  animations?: unknown[];
  buffers?: Array<{ uri?: string }>;
  extensionsRequired?: string[];
};

const CORE_BONES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["hips", ["hips", "pelvis"]],
  ["spine", ["spine", "spine1", "spine01"]],
  ["head", ["head"]],
  ["leftUpperArm", ["leftarm", "leftupperarm", "upperarml"]],
  ["rightUpperArm", ["rightarm", "rightupperarm", "upperarmr"]],
  ["leftForearm", ["leftforearm", "leftlowerarm", "lowerarml"]],
  ["rightForearm", ["rightforearm", "rightlowerarm", "lowerarmr"]],
  ["leftThigh", ["leftupleg", "leftthigh", "thighl"]],
  ["rightThigh", ["rightupleg", "rightthigh", "thighr"]],
  ["leftShin", ["leftleg", "leftshin", "calfl"]],
  ["rightShin", ["rightleg", "rightshin", "calfr"]],
  ["leftFoot", ["leftfoot", "footl"]],
  ["rightFoot", ["rightfoot", "footr"]],
];

function boneAlias(name: string): string {
  return name.split(":").pop()!.toLowerCase()
    .replace(/^(mixamorig|def|jnt)[-_]?/, "")
    .replace(/[^a-z0-9]/g, "");
}

function fatalReport(filename: string, byteLength: number, problem: string): ArtistAssetTechnicalReport {
  return {
    filename, bytes: byteLength, triangles: 0, skinnedPrimitives: 0,
    images: 0, materials: 0, baseColorMaps: 0, normalMaps: 0,
    pbrRoughnessMaps: 0, morphTargets: 0, animations: 0, namedBones: 0,
    missingBones: CORE_BONES.map(([label]) => label),
    technicalErrors: [problem], warnings: [], technicallyEligible: false,
    artApproval: "NOT_REVIEWED",
  };
}

export function inspectArtistGlb(arrayBuffer: ArrayBuffer, filename = "candidate.glb"): ArtistAssetTechnicalReport {
  if (arrayBuffer.byteLength > ARTIST_GLB_MAX_BYTES)
    return fatalReport(filename, arrayBuffer.byteLength, "GLB exceeds 32 MiB intake limit.");
  if (arrayBuffer.byteLength < 20)
    return fatalReport(filename, arrayBuffer.byteLength, "File is not a complete GLB.");
  const view = new DataView(arrayBuffer);
  if (view.getUint32(0, true) !== 0x46546c67 ||
      view.getUint32(4, true) !== 2 ||
      view.getUint32(8, true) !== arrayBuffer.byteLength ||
      view.getUint32(16, true) !== 0x4e4f534a)
    return fatalReport(filename, arrayBuffer.byteLength, "Expected an intact glTF 2.0 binary GLB.");
  const chunkBytes = view.getUint32(12, true);
  if (chunkBytes < 2 || chunkBytes + 20 > arrayBuffer.byteLength)
    return fatalReport(filename, arrayBuffer.byteLength, "GLB JSON chunk is corrupt.");
  let doc: GlbDocument;
  try {
    doc = JSON.parse(new TextDecoder().decode(
      new Uint8Array(arrayBuffer, 20, chunkBytes)));
  } catch {
    return fatalReport(filename, arrayBuffer.byteLength, "GLB JSON could not be decoded.");
  }
  const errors: string[] = [];
  const warnings: string[] = [];
  if (doc.asset?.version !== "2.0") errors.push("Only glTF 2.0 is supported.");
  if ((doc.buffers ?? []).some((buffer) => !!buffer.uri) ||
      (doc.images ?? []).some((image) => !!image.uri && !image.uri.startsWith("data:")))
    errors.push("External texture/buffer references are forbidden: embed all assets in the GLB.");
  if ((doc.extensionsRequired ?? []).includes("KHR_texture_basisu"))
    errors.push("KTX2/BasisU textures require a separate approved runtime decoder profile.");
  const nodeNames = new Set((doc.nodes ?? [])
    .map((node) => node.name ? boneAlias(node.name) : "").filter(Boolean));
  const missingBones = CORE_BONES
    .filter(([, aliases]) => !aliases.some((alias) => nodeNames.has(alias)))
    .map(([label]) => label);
  if (missingBones.length)
    errors.push("Game-ready deform skeleton missing: " + missingBones.join(", "));
  if (!(doc.skins?.length))
    errors.push("Character is not skinned; rigid concept models cannot enter combat.");
  const materials = doc.materials ?? [];
  const baseColorMaps = materials.filter((m) => m.pbrMetallicRoughness?.baseColorTexture).length;
  const normalMaps = materials.filter((m) => m.normalTexture).length;
  const pbrRoughnessMaps = materials.filter((m) => m.pbrMetallicRoughness?.metallicRoughnessTexture).length;
  if ((doc.images ?? []).length < 2 || baseColorMaps < 1)
    errors.push("Real UV/PBR texture maps are required (not solid-color placeholder materials).");
  if (!normalMaps)
    warnings.push("No baked normal maps: inspect close-up skin, hair and garment detail.");
  if (!pbrRoughnessMaps)
    warnings.push("No roughness maps: check that skin, hair and cloth do not look like plastic.");
  let triangles = 0, skinnedPrimitives = 0, morphTargets = 0;
  const accessors = doc.accessors ?? [];
  for (const mesh of doc.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      if ((primitive.mode ?? 4) !== 4) {
        errors.push("Non-triangle primitive found.");
        continue;
      }
      const position = accessors[primitive.attributes?.POSITION ?? -1]?.count ?? 0;
      const indexCount = primitive.indices != null ? accessors[primitive.indices]?.count : undefined;
      if (!position) errors.push("A primitive has no valid POSITION accessor.");
      triangles += (indexCount ?? position) / 3;
      if (primitive.attributes?.JOINTS_0 != null &&
          primitive.attributes?.WEIGHTS_0 != null) skinnedPrimitives++;
      morphTargets = Math.max(morphTargets, primitive.targets?.length ?? 0);
    }
  }
  if (triangles < 12_000) errors.push("Hero character too low-detail for the approved art-first lane (minimum 12k triangles).");
  if (triangles > ARTIST_GLB_MAX_TRIANGLES) errors.push("Hero character exceeds 110k triangles; author LOD/retopo first.");
  if (skinnedPrimitives < 1) errors.push("No skinned mesh primitives found.");
  if (!morphTargets) warnings.push("No facial morph targets; facial bone rig and expressions need manual verification.");
  if (!(doc.animations?.length))
    warnings.push("No embedded motion poses. A separate combat deformation capture is required.");
  return {
    filename, bytes: arrayBuffer.byteLength, triangles: Math.round(triangles),
    skinnedPrimitives, images: doc.images?.length ?? 0, materials: materials.length,
    baseColorMaps, normalMaps, pbrRoughnessMaps, morphTargets,
    animations: doc.animations?.length ?? 0, namedBones: nodeNames.size,
    missingBones, technicalErrors: errors, warnings,
    technicallyEligible: errors.length === 0, artApproval: "NOT_REVIEWED",
  };
}

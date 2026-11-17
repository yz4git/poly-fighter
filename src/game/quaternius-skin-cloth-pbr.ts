import * as THREE from "three";

/**
 * Real PBR distinction inside the SAME skinned UBC body mesh:
 * bone-weighted head/neck vertices are skin, while the torso/legs are cloth.
 *
 * MeshStandardMaterial has a single roughness and metalness per draw; adding
 * more materials would introduce extra draw calls and split animated skin.
 * One interpolated vertex channel instead supplies a small, bounded PBR
 * difference at no additional draw count. All authored eyes/hair are excluded
 * by the caller.
 */
export const QUATERNIUS_SKIN_CLOTH_PBR_ID = "UBC_SKIN_CLOTH_VERTEX_PBR_V1";
export const QUATERNIUS_SKIN_CLOTH_ATTRIBUTE = "tpsSkinSurface";

export function quaterniusSkinSurfaceWeight(headAndNeckWeight: number, scalpHair: boolean): number {
  if (!Number.isFinite(headAndNeckWeight) || scalpHair) return 0;
  const u = THREE.MathUtils.clamp((headAndNeckWeight - 0.18) / 0.60, 0, 1);
  return u * u * (3 - 2 * u);
}

export function patchQuaterniusSkinClothShader(shader: {
  vertexShader: string;
  fragmentShader: string;
}): void {
  const v = "varying float vTpsSkinSurface;";
  const a = `attribute float ${QUATERNIUS_SKIN_CLOTH_ATTRIBUTE};`;
  if (!shader.vertexShader.includes("#include <common>")
      || !shader.vertexShader.includes("#include <begin_vertex>")
      || !shader.fragmentShader.includes("#include <common>")
      || !shader.fragmentShader.includes("#include <roughnessmap_fragment>")
      || !shader.fragmentShader.includes("#include <metalnessmap_fragment>")) {
    throw new Error("POLY_FIGHTER_SKIN_CLOTH_SHADER_CHUNK_MISMATCH");
  }
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${v}\n${a}`)
    .replace("#include <begin_vertex>", `#include <begin_vertex>\nvTpsSkinSurface = ${QUATERNIUS_SKIN_CLOTH_ATTRIBUTE};`);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${v}`)
    .replace(
      "#include <roughnessmap_fragment>",
      "#include <roughnessmap_fragment>\nroughnessFactor = mix(0.80, 0.69, clamp(vTpsSkinSurface, 0.0, 1.0));",
    )
    .replace(
      "#include <metalnessmap_fragment>",
      "#include <metalnessmap_fragment>\nmetalnessFactor = mix(0.012, 0.0, clamp(vTpsSkinSurface, 0.0, 1.0));",
    );
}

export function installQuaterniusSkinClothPbr(material: THREE.MeshStandardMaterial): void {
  if (material.userData.tpsSkinClothPbr === QUATERNIUS_SKIN_CLOTH_PBR_ID) return;
  const earlierCompile = material.onBeforeCompile;
  const earlierKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    earlierCompile.call(material, shader, renderer);
    patchQuaterniusSkinClothShader(shader);
  };
  material.customProgramCacheKey = () => `${earlierKey}|${QUATERNIUS_SKIN_CLOTH_PBR_ID}`;
  material.userData.tpsSkinClothPbr = QUATERNIUS_SKIN_CLOTH_PBR_ID;
  material.needsUpdate = true;
}

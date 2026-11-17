import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  QUATERNIUS_SKIN_CLOTH_ATTRIBUTE,
  QUATERNIUS_SKIN_CLOTH_PBR_ID,
  quaterniusSkinSurfaceWeight,
  patchQuaterniusSkinClothShader,
  installQuaterniusSkinClothPbr,
} from "../src/game/quaternius-skin-cloth-pbr";

test("head/neck weights produce bounded smooth skin factor, but hair underlay is cloth", () => {
  assert.equal(quaterniusSkinSurfaceWeight(-1, false), 0);
  assert.equal(quaterniusSkinSurfaceWeight(.18, false), 0);
  assert.equal(quaterniusSkinSurfaceWeight(.48, false), .5);
  assert.equal(quaterniusSkinSurfaceWeight(.78, false), 1);
  assert.equal(quaterniusSkinSurfaceWeight(1, false), 1);
  assert.equal(quaterniusSkinSurfaceWeight(1, true), 0);
  assert.equal(quaterniusSkinSurfaceWeight(NaN, false), 0);
  assert.ok(Array.from({length:61}, (_,i)=>quaterniusSkinSurfaceWeight(i/60,false))
    .every((v,i,a)=>i===0||v>=a[i-1]));
});

test("skin/cloth PBR reuses the skinned material's existing draw and authored GLTF normal map slots", () => {
  const shader = {
    vertexShader: "#include <common>\n#include <begin_vertex>",
    fragmentShader: "#include <common>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>",
  };
  patchQuaterniusSkinClothShader(shader);
  assert.ok(shader.vertexShader.includes("attribute float tpsSkinSurface;"));
  assert.ok(shader.vertexShader.includes("vTpsSkinSurface = tpsSkinSurface;"));
  assert.ok(shader.fragmentShader.includes("roughnessFactor = mix(0.80, 0.69"));
  assert.ok(shader.fragmentShader.includes("metalnessFactor = mix(0.012, 0.0"));
  assert.ok(shader.fragmentShader.includes("#include <roughnessmap_fragment>"));
  assert.ok(shader.fragmentShader.includes("#include <metalnessmap_fragment>"));
  assert.equal(QUATERNIUS_SKIN_CLOTH_ATTRIBUTE,"tpsSkinSurface");
  assert.throws(() => patchQuaterniusSkinClothShader({vertexShader:"",fragmentShader:""}),
    /POLY_FIGHTER_SKIN_CLOTH_SHADER_CHUNK_MISMATCH/);
});

test("PBR skin shader installation is idempotent with stable program key", () => {
  const material = new THREE.MeshStandardMaterial();
  try {
    const before = material.customProgramCacheKey();
    installQuaterniusSkinClothPbr(material);
    const after = material.customProgramCacheKey();
    assert.equal(material.userData.tpsSkinClothPbr, QUATERNIUS_SKIN_CLOTH_PBR_ID);
    assert.ok(after.includes(QUATERNIUS_SKIN_CLOTH_PBR_ID));
    assert.notEqual(before, after);
    const compile = material.onBeforeCompile;
    installQuaterniusSkinClothPbr(material);
    assert.equal(compile, material.onBeforeCompile);
    assert.equal(after, material.customProgramCacheKey());
  } finally { material.dispose(); }
});

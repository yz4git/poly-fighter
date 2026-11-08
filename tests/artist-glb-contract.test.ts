import assert from "node:assert/strict";
import test from "node:test";
import { ARTIST_GLB_MAX_BYTES, inspectArtistGlb } from "../src/game/artist-glb-contract";

function buildGlb(doc: object): ArrayBuffer {
  const text = JSON.stringify(doc);
  const pad = (4 - (text.length % 4)) % 4;
  const length = 20 + text.length + pad;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, length, true);
  view.setUint32(12, text.length + pad, true);
  view.setUint32(16, 0x4e4f534a, true);
  const arr = new Uint8Array(buffer, 20);
  arr.set(new TextEncoder().encode(text));
  arr.fill(0x20, text.length);
  return buffer;
}
const bones = [
  "mixamorig:Hips","mixamorig:Spine","mixamorig:Head",
  "mixamorig:LeftArm","mixamorig:RightArm",
  "mixamorig:LeftForeArm","mixamorig:RightForeArm",
  "mixamorig:LeftUpLeg","mixamorig:RightUpLeg",
  "mixamorig:LeftLeg","mixamorig:RightLeg",
  "mixamorig:LeftFoot","mixamorig:RightFoot",
];
function model() {
  return {
    asset: { version: "2.0" }, nodes: bones.map((name) => ({ name })),
    skins: [{ joints: bones.map((_, i) => i) }],
    accessors: [{ count: 60000 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 0, WEIGHTS_0: 0 },
      targets: [{}, {}] }] }],
    materials: [{ pbrMetallicRoughness: {
      baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 1 },
    }, normalTexture: { index: 2 } }],
    images: [{ bufferView: 0 }, { bufferView: 1 }, { bufferView: 2 }],
    animations: [{}],
  };
}
test("accept technically valid imported artistic GLB but never auto approve quality", () => {
  const result = inspectArtistGlb(buildGlb(model()), "sera-artist.glb");
  assert.equal(result.technicallyEligible, true);
  assert.equal(result.triangles, 20000);
  assert.equal(result.artApproval, "NOT_REVIEWED");
  assert.equal(result.missingBones.length, 0);
});
test("deny invalid GLB signature", () => {
  const buffer = buildGlb(model());
  new DataView(buffer).setUint32(0, 0, true);
  assert.equal(inspectArtistGlb(buffer).technicallyEligible, false);
});
test("deny external image dependencies and lost bone chains", () => {
  const doc = model();
  doc.nodes[0].name = "ROOT_WITHOUT_HIPS";
  (doc.images[0] as { bufferView?: number; uri?: string }).uri = "https://example.com/secret.png";
  const report = inspectArtistGlb(buildGlb(doc));
  assert.equal(report.technicallyEligible, false);
  assert.ok(report.missingBones.includes("hips"));
});
test("solid-color procedural primitives do not pass as quality assets", () => {
  const doc = model();
  doc.materials = [{ pbrMetallicRoughness: {} }] as typeof doc.materials;
  assert.equal(inspectArtistGlb(buildGlb(doc)).technicallyEligible, false);
});
test("size cap is enforced before model parsing", () => {
  const buffer = new ArrayBuffer(ARTIST_GLB_MAX_BYTES + 1);
  assert.match(inspectArtistGlb(buffer).technicalErrors[0], /32 MiB/);
});

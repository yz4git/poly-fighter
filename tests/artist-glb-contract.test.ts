import assert from "node:assert/strict";
import test from "node:test";
import { ARTIST_GLB_MAX_BYTES, ARTIST_GLB_VISUAL_MAX_BYTES, inspectArtistGlb } from "../src/game/artist-glb-contract";

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
  "mixamorig:Hips","mixamorig:Spine","mixamorig:Spine1",
  "mixamorig:Spine2","mixamorig:Neck","mixamorig:Head",
  "mixamorig:LeftShoulder","mixamorig:RightShoulder",
  "mixamorig:LeftHand","mixamorig:RightHand",
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
  assert.equal(result.visualReviewEligible, true);
  assert.equal(result.combatRigCompatible, true);
  assert.equal(result.reviewStage, "MOBILE_TECH_PASS");
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
  assert.equal(inspectArtistGlb(buffer).visualReviewEligible, true);
  assert.equal(inspectArtistGlb(buffer).technicallyEligible, false);
});

test("allow an unrigged high-detail face sculpt for visual review, not fighting", () => {
  const doc = model();
  doc.skins = [];
  doc.nodes = [];
  doc.meshes[0].primitives[0].attributes = { POSITION: 0 } as typeof doc.meshes[0]["primitives"][0]["attributes"];
  doc.accessors[0].count = 480000;
  doc.materials = [{ pbrMetallicRoughness: {} }] as typeof doc.materials;
  doc.images = [];
  const report = inspectArtistGlb(buildGlb(doc),"face-approval-sculpt.glb");
  assert.equal(report.visualReviewEligible,true);
  assert.equal(report.technicallyEligible,false);
  assert.equal(report.combatRigCompatible,false);
  assert.equal(report.reviewStage,"VISUAL_ONLY");
  assert.equal(report.artApproval,"NOT_REVIEWED");
  assert.ok(report.warnings.some(x=>x.includes("Unrigged high-poly")));
});
test("reject suspiciously huge sculpt even for mobile visual inspection", () => {
  const report = inspectArtistGlb(new ArrayBuffer(ARTIST_GLB_VISUAL_MAX_BYTES+1));
  assert.equal(report.visualReviewEligible,false);
  assert.equal(report.reviewStage,"INVALID");
});
test("art inspection accepts unrigged but refuses remote external textures", () => {
  const doc=model();
  doc.skins=[];
  doc.images[0] = { uri:"https://external.example.net/skin.png" } as typeof doc.images[number];
  const report=inspectArtistGlb(buildGlb(doc));
  assert.equal(report.visualReviewEligible,false);
  assert.ok(report.technicalErrors.some(x=>x.includes("External")));
});
test("a production-ready technical pass does not confer artistic approval", () => {
  const report = inspectArtistGlb(buildGlb(model()));
  assert.equal(report.artApproval,"NOT_REVIEWED");
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { DEFAULT_FIGHTER_MODEL_ID, FIGHTER_MODEL_OPTIONS } from "../src/game/model-skins";
import {
  QUATERNIUS_OUTFIT_SKIN_ID,
  quaterniusOutfitToneForBoneName,
} from "../src/game/quaternius-outfit-skin";
import {
  QUATERNIUS_UBC_FEMALE_MODEL_URL,
  QUATERNIUS_UBC_MALE_MODEL_URL,
  QUATERNIUS_UAL_CORE_URL,
  quaterniusBodyTypeForDefinition,
  quaterniusModelUrlForBodyType,
} from "../src/game/visual-quaternius-runtime";

test("Quaternius UBC is the user-facing default model skin", () => {
  assert.equal(DEFAULT_FIGHTER_MODEL_ID, "QUATERNIUS_UBC");
  assert.equal(FIGHTER_MODEL_OPTIONS[0]?.id, "QUATERNIUS_UBC");
});

test("lightweight Quaternius male and female models both retain full UAL rig coverage", async () => {
  const male = JSON.parse(await readFile(new URL("../docs/quaternius-male-flat-report.json", import.meta.url), "utf8"));
  const female = JSON.parse(await readFile(new URL("../docs/quaternius-female-flat-report.json", import.meta.url), "utf8"));
  for (const report of [male, female]) {
    assert.equal(report.source.license, "CC0-1.0");
    assert.equal(report.model.textures, 0);
    assert.equal(report.model.skins, 1);
    assert.equal(report.compatibility.targetNameCoverage, 1);
    assert.equal(report.compatibility.sharedJointCount, 65);
    assert.equal(report.compatibility.sharedJointCount, report.compatibility.motionTargetCount);
    assert.deepEqual(report.compatibility.missingMotionTargets, []);
    assert.equal(report.compatibility.directlyBindableByNodeName, true);
  }
});

test("KAIRO uses male UBC and SERA uses female UBC", () => {
  assert.equal(quaterniusBodyTypeForDefinition(FIGHTER_DEFINITIONS.red), "MALE");
  assert.equal(quaterniusBodyTypeForDefinition(FIGHTER_DEFINITIONS.blue), "FEMALE");
  assert.equal(quaterniusModelUrlForBodyType("MALE"), QUATERNIUS_UBC_MALE_MODEL_URL);
  assert.equal(quaterniusModelUrlForBodyType("FEMALE"), QUATERNIUS_UBC_FEMALE_MODEL_URL);
  assert.match(QUATERNIUS_UBC_MALE_MODEL_URL, /ubc-superhero-male-flat\.glb$/);
  assert.match(QUATERNIUS_UBC_FEMALE_MODEL_URL, /ubc-superhero-female-flat\.glb$/);
  assert.match(QUATERNIUS_UAL_CORE_URL, /ual-fight-core\.glb$/);
});

test("Quaternius runtime retargets rest-pose deltas and preserves canonical combat poses", async () => {
  const runtime = await readFile(new URL("../src/game/visual-quaternius-runtime.ts", import.meta.url), "utf8");
  assert.doesNotMatch(runtime, /ual2-fight-core\.glb/);
  assert.doesNotMatch(runtime, /ubc-superhero-male\.glb[`\"]/);
  assert.match(runtime, /targetRest \* inverse\(sourceRest\) \* sourceAnimated/);
  assert.match(runtime, /retargetMotionClips/);
  assert.match(runtime, /quaterniusRetargetMode = "rest-delta"/);
  assert.match(runtime, /function neutralPoseCorrection/);
  assert.match(runtime, /neutralPoseCorrection\(runtime, fighter\)/);
  assert.match(runtime, /function guardPoseCorrection/);
  assert.match(runtime, /guardPoseCorrection\(runtime, fighter\)/);
  assert.match(runtime, /getVisualContactPoint/);
  assert.match(runtime, /updateQuaterniusModelPreview/);
  assert.match(runtime, /quaterniusAnimationRigCoverage = 1/);
});

test("Quaternius hero graphics use fitted cloth panels and bind-delta followers", async () => {
  const polish = await readFile(new URL("../src/game/quaternius-graphics-polish.ts", import.meta.url), "utf8");
  assert.match(polish, /QUATERNIUS_HERO_KIT_V5_FITTED_OUTFIT/);
  assert.match(polish, /BIND_TO_ANIMATED_DELTA/);
  assert.match(polish, /inverseBindBoneRootQuaternion/);
  assert.match(polish, /poseDelta\.copy\(currentBoneRootQuaternion\)\.multiply\(inverseBindBoneRootQuaternion\)/);
  assert.doesNotMatch(polish, /mesh\.quaternion\.copy\(localQuaternion\)/);
  assert.match(polish, /function panelGeometry/);
  assert.match(polish, /THIN_CONFORMING_BIND_DELTA_PANELS/);

  for (const required of [
    "ubc-kairo-outfit-jacket-left",
    "ubc-kairo-outfit-jacket-right",
    "ubc-kairo-outfit-abdomen",
    "ubc-kairo-outfit-belt",
    "ubc-kairo-outfit-left-sleeve",
    "ubc-kairo-outfit-left-trouser",
    "ubc-kairo-outfit-left-boot-shaft",
    "ubc-kairo-outfit-left-shoe",
    "ubc-sera-outfit-jacket-left",
    "ubc-sera-outfit-jacket-right",
    "ubc-sera-outfit-bodysuit",
    "ubc-sera-outfit-waist",
    "ubc-sera-outfit-left-sleeve",
    "ubc-sera-outfit-left-legging",
    "ubc-sera-outfit-left-boot",
    "ubc-sera-outfit-left-shoe",
  ]) {
    assert.match(polish, new RegExp(required));
  }

  assert.match(polish, /ubc-kairo-left-gauntlet/);
  assert.match(polish, /ubc-kairo-left-shin-guard/);
  assert.match(polish, /new THREE\.CylinderGeometry\(0\.034, 0\.041, 0\.108/);
  assert.match(polish, /ubc-sera-left-forearm-guard/);
  assert.match(polish, /lowerarm_l/);
  assert.match(polish, /ubc-sera-left-shin-guard/);
  assert.match(polish, /calf_l/);
  assert.match(polish, /ubc-sera-ponytail-upper/);
  assert.match(polish, /ubc-sera-ponytail-lower/);
});

test("weighted UBC outfit skin maps face to skin and the remaining rig to clothing", async () => {
  assert.equal(QUATERNIUS_OUTFIT_SKIN_ID, "QUATERNIUS_OUTFIT_SKIN_V2_MATERIAL_AWARE_VERTEX_COLOR");
  assert.equal(quaterniusOutfitToneForBoneName("Head", "POWER"), "SKIN");
  assert.equal(quaterniusOutfitToneForBoneName("neck_01", "SPEED"), "SKIN");

  assert.equal(quaterniusOutfitToneForBoneName("spine_03", "POWER"), "LIGHT");
  assert.equal(quaterniusOutfitToneForBoneName("spine_02", "POWER"), "PRIMARY");
  assert.equal(quaterniusOutfitToneForBoneName("pelvis", "POWER"), "DARK");
  assert.equal(quaterniusOutfitToneForBoneName("upperarm_l", "POWER"), "PRIMARY");
  assert.equal(quaterniusOutfitToneForBoneName("hand_l", "POWER"), "DARK");
  assert.equal(quaterniusOutfitToneForBoneName("thigh_l", "POWER"), "DARK");

  assert.equal(quaterniusOutfitToneForBoneName("spine_03", "SPEED"), "LIGHT");
  assert.equal(quaterniusOutfitToneForBoneName("spine_02", "SPEED"), "DARK");
  assert.equal(quaterniusOutfitToneForBoneName("pelvis", "SPEED"), "PRIMARY");
  assert.equal(quaterniusOutfitToneForBoneName("upperarm_r", "SPEED"), "PRIMARY");
  assert.equal(quaterniusOutfitToneForBoneName("lowerarm_r", "SPEED"), "LIGHT");
  assert.equal(quaterniusOutfitToneForBoneName("thigh_r", "SPEED"), "DARK");
  assert.equal(quaterniusOutfitToneForBoneName("calf_r", "SPEED"), "LIGHT");
  assert.equal(quaterniusOutfitToneForBoneName("foot_r", "SPEED"), "PRIMARY");

  const outfitSkin = await readFile(new URL("../src/game/quaternius-outfit-skin.ts", import.meta.url), "utf8");
  assert.match(outfitSkin, /geometry\.setAttribute\("color"/);
  assert.match(outfitSkin, /material\.vertexColors = true/);
  assert.match(outfitSkin, /skinIndex/);
  assert.match(outfitSkin, /skinWeight/);
  assert.match(outfitSkin, /clothingRatio/);
  assert.match(outfitSkin, /shouldKeepAuthoredMaterial\(mesh, material\)/);
  assert.match(outfitSkin, /quaterniusOutfitSkinMaterialCount/);
});

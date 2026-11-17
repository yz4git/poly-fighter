import assert from "node:assert/strict";
import test from "node:test";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { DEFAULT_FIGHTER_MODEL_ID, FIGHTER_MODEL_OPTIONS } from "../src/game/model-skins";
import {
  QUATERNIUS_OUTFIT_SKIN_ID,
  QUATERNIUS_OUTFIT_SURFACE_ID,
  quaterniusSurfaceFinishForTag,
  quaterniusOutfitToneForBoneName,
  quaterniusShouldTintScalp,
} from "../src/game/quaternius-outfit-skin";
import {
  QUATERNIUS_UBC_FEMALE_MODEL_URL,
  QUATERNIUS_UBC_MALE_MODEL_URL,
  quaterniusBodyTypeForDefinition,
  quaterniusModelUrlForBodyType,
} from "../src/game/visual-quaternius-runtime";

test("Quaternius UBC is the user-facing default model skin", () => {
  assert.equal(DEFAULT_FIGHTER_MODEL_ID, "QUATERNIUS_UBC");
  assert.equal(FIGHTER_MODEL_OPTIONS[0]?.id, "QUATERNIUS_UBC");
});

test("KAIRO uses male UBC and SERA uses female UBC", () => {
  assert.equal(quaterniusBodyTypeForDefinition(FIGHTER_DEFINITIONS.red), "MALE");
  assert.equal(quaterniusBodyTypeForDefinition(FIGHTER_DEFINITIONS.blue), "FEMALE");
  assert.equal(quaterniusModelUrlForBodyType("MALE"), QUATERNIUS_UBC_MALE_MODEL_URL);
  assert.equal(quaterniusModelUrlForBodyType("FEMALE"), QUATERNIUS_UBC_FEMALE_MODEL_URL);
});

test("weighted UBC outfit skin keeps the face skin-coloured while tinting exposed upper scalp as hair", () => {
  assert.equal(QUATERNIUS_OUTFIT_SKIN_ID, "QUATERNIUS_OUTFIT_SKIN_V3_SCALP_HAIR_VERTEX_COLOR");
  assert.equal(quaterniusOutfitToneForBoneName("Head", "POWER"), "SKIN");
  assert.equal(quaterniusOutfitToneForBoneName("neck_01", "SPEED"), "SKIN");

  assert.equal(quaterniusShouldTintScalp(0.44, 1.0, "POWER"), false);
  assert.equal(quaterniusShouldTintScalp(0.8, 0.67, "POWER"), false);
  assert.equal(quaterniusShouldTintScalp(0.8, 0.68, "POWER"), true);
  assert.equal(quaterniusShouldTintScalp(0.8, 0.65, "SPEED"), false);
  assert.equal(quaterniusShouldTintScalp(0.8, 0.66, "SPEED"), true);

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

});

test("original UBC skin uses smooth PBR anatomy, matte cloth, hard trim and preserves authored eyes", () => {
  assert.equal(QUATERNIUS_OUTFIT_SURFACE_ID, "UBC_SEMANTIC_SURFACE_V1");
  const face = quaterniusSurfaceFinishForTag("UBC.Body Skin");
  const cloth = quaterniusSurfaceFinishForTag("UBC.Fabric Jacket");
  const hard = quaterniusSurfaceFinishForTag("UBC.armor metal");
  const eye = quaterniusSurfaceFinishForTag("UBC.Head Eye_L");
  const hair = quaterniusSurfaceFinishForTag("UBC Hair");
  assert.equal(face.role, "SKIN");
  assert.equal(face.flatShading, false, "no low-poly face normals");
  assert.equal(face.metalness, 0, "skin must not have metallic highlights");
  assert.equal(cloth.role, "FABRIC");
  assert.equal(cloth.flatShading, false);
  assert.ok(cloth.roughness >= .7);
  assert.equal(hard.role, "HARDWARE");
  assert.equal(hard.flatShading, true);
  assert.ok(hard.metalness > cloth.metalness);
  assert.equal(eye.role, "AUTHORED", "original eye material must not be repainted");
  assert.equal(hair.role, "AUTHORED", "original groom must not be repainted");
  assert.equal(quaterniusSurfaceFinishForTag("ubc_male"), quaterniusSurfaceFinishForTag("ubc_default"));
});

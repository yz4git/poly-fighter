import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { DEFAULT_FIGHTER_MODEL_ID, FIGHTER_MODEL_OPTIONS } from "../src/game/model-skins";
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

test("Quaternius hero graphics use full armor and bind-to-animated delta followers", async () => {
  const polish = await readFile(new URL("../src/game/quaternius-graphics-polish.ts", import.meta.url), "utf8");
  assert.match(polish, /QUATERNIUS_HERO_KIT_V3_FULL_ARMOR/);
  assert.match(polish, /BIND_TO_ANIMATED_DELTA/);
  assert.match(polish, /inverseBindBoneRootQuaternion/);
  assert.match(polish, /poseDelta\.copy\(currentBoneRootQuaternion\)\.multiply\(inverseBindBoneRootQuaternion\)/);
  assert.doesNotMatch(polish, /mesh\.quaternion\.copy\(localQuaternion\)/);
  assert.match(polish, /ubc-kairo-torso-core/);
  assert.match(polish, /ubc-kairo-left-gauntlet/);
  assert.match(polish, /ubc-kairo-left-shin-guard/);
  assert.match(polish, /ubc-sera-left-forearm-guard/);
  assert.match(polish, /lowerarm_l/);
  assert.match(polish, /ubc-sera-left-shin-guard/);
  assert.match(polish, /calf_l/);
  assert.match(polish, /ubc-sera-ponytail-upper/);
  assert.match(polish, /ubc-sera-ponytail-lower/);
});

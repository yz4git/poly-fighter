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

test("Quaternius runtime retargets rest-pose deltas and preserves canonical contact poses", async () => {
  const runtime = await readFile(new URL("../src/game/visual-quaternius-runtime.ts", import.meta.url), "utf8");
  assert.doesNotMatch(runtime, /ual2-fight-core\.glb/);
  assert.doesNotMatch(runtime, /ubc-superhero-male\.glb[`\"]/);
  assert.match(runtime, /targetRest \* inverse\(sourceRest\) \* sourceAnimated/);
  assert.match(runtime, /retargetMotionClips/);
  assert.match(runtime, /quaterniusRetargetMode = "rest-delta"/);
  assert.match(runtime, /function guardPoseCorrection/);
  assert.match(runtime, /guardPoseCorrection\(runtime, fighter\)/);
  assert.match(runtime, /getVisualContactPoint/);
  assert.match(runtime, /updateQuaterniusModelPreview/);
  assert.match(runtime, /quaterniusAnimationRigCoverage = 1/);
});

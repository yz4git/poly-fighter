import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_FIGHTER_MODEL_ID, FIGHTER_MODEL_OPTIONS } from "../src/game/model-skins";

test("Quaternius UBC is the user-facing default model skin", () => {
  assert.equal(DEFAULT_FIGHTER_MODEL_ID, "QUATERNIUS_UBC");
  assert.equal(FIGHTER_MODEL_OPTIONS[0]?.id, "QUATERNIUS_UBC");
});

test("Quaternius UBC and both researched animation libraries share all motion target names", async () => {
  const first = JSON.parse(await readFile(new URL("../docs/quaternius-base-model-report.json", import.meta.url), "utf8"));
  const second = JSON.parse(await readFile(new URL("../docs/quaternius-ual2-model-report.json", import.meta.url), "utf8"));
  for (const report of [first, second]) {
    assert.equal(report.source.license, "CC0-1.0");
    assert.equal(report.compatibility.targetNameCoverage, 1);
    assert.equal(report.compatibility.sharedJointCount, report.compatibility.motionTargetCount);
    assert.deepEqual(report.compatibility.missingMotionTargets, []);
    assert.equal(report.compatibility.directlyBindableByNodeName, true);
  }
});

test("Quaternius runtime uses the lightweight UAL1 core and canonical contact correction", async () => {
  const runtime = await readFile(new URL("../src/game/visual-quaternius-runtime.ts", import.meta.url), "utf8");
  assert.match(runtime, /models\/quaternius\/ubc-superhero-male\.glb/);
  assert.match(runtime, /ual-fight-core\.glb/);
  assert.doesNotMatch(runtime, /ual2-fight-core\.glb/);
  assert.match(runtime, /getVisualContactPoint/);
  assert.match(runtime, /updateQuaterniusModelPreview/);
  assert.match(runtime, /quaterniusAnimationRigCoverage = 1/);
});

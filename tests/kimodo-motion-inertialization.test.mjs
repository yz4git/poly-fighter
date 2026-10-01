import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Kimodo-inspired inertialization preserves outgoing local velocity while decaying into the destination clip", async () => {
  const source = await readFile(new URL("../src/game/kimodo-motion-inertialization.ts", import.meta.url), "utf8");

  assert.match(source, /KIMODO_INSPIRED_INERTIAL_V1/);
  assert.match(source, /linearVelocity/);
  assert.match(source, /angularVelocity/);
  assert.match(source, /previous\.clone\(\)\.invert\(\)\.multiply\(current\)/);
  assert.match(source, /tau \* \(1 - Math\.exp\(-age \/ tau\)\)/);
  assert.match(source, /1 - u \* u \* \(3 - 2 \* u\)/);
  assert.match(source, /MAX_ROTATION_PREDICTION/);
  assert.match(source, /weightScale = 1/);
  assert.match(source, /THREE\.MathUtils\.clamp\(weightScale, 0, 1\)/);
  assert.match(source, /validDelta \? previous\.linearVelocity\.clone\(\)\.lerp\(measuredLinear, 0\.62\) : previous\.linearVelocity\.clone\(\)/);
});

test("runtime samples gameplay-authored motion before inertialization and conditions after it", async () => {
  const source = await readFile(new URL("../src/game/visual-quaternius-runtime.ts", import.meta.url), "utf8");

  const begin = source.indexOf("beginInertialTransition(runtime.bones, runtime.poseHistory, runtime.transitionPose);");
  const syncFn = source.indexOf("function synchronizeMotion");
  const sample = source.indexOf("sampleCombatMotionTimeline(", syncFn);
  const apply = source.indexOf("applyInertialTransition(", syncFn);
  const conditioning = source.indexOf("applyKimodoMotionConditioning(", apply);
  const record = source.indexOf("recordInertialPose(runtime.bones, runtime.poseHistory, motionDelta);", conditioning);

  assert.ok(begin >= 0);
  assert.ok(sample > syncFn);
  assert.ok(apply > sample);
  assert.ok(conditioning > apply);
  assert.ok(record > conditioning);
  assert.match(source, /kimodoInertialTransitionActive/);
  assert.match(source, /kimodoInertialMaxLinearVelocity/);
  assert.match(source, /kimodoInertialMaxAngularVelocity/);
  assert.match(source, /combatMotionContactWeight/);
  assert.match(source, /kimodoInertialAuthoredContactSuppression/);
  assert.match(source, /fighter\.visual\.root\.userData\.unimateMotionExpansionOverlap/);
  assert.match(source, /fighter\.visual\.root\.userData\.kimodoInertialTransitionWeight/);
  assert.match(source, /fighter\.visual\.root\.userData\.unimateReplacementMode/);
});

test("hitstop freezes transition age but keeps the last measured velocity available", async () => {
  const runtime = await readFile(new URL("../src/game/visual-quaternius-runtime.ts", import.meta.url), "utf8");
  const inertial = await readFile(new URL("../src/game/kimodo-motion-inertialization.ts", import.meta.url), "utf8");

  assert.match(runtime, /if \(!frozen\) \{/);
  assert.match(runtime, /runtime\.transitionAge \+= delta/);
  assert.match(runtime, /const motionDelta = advance\(runtime, timeSeconds, fighter\.hitStop > 0\)/);
  assert.match(inertial, /validDelta \? previous\.angularVelocity\.clone\(\)\.lerp\(measuredAngular, 0\.62\) : previous\.angularVelocity\.clone\(\)/);
});

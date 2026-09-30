import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Motion Foundry accepts Kimodo SOMA BVH as a first-class prior", async () => {
  const mocap = await readFile(new URL("../tools/blender/motion_foundry_v6_mocap.py", import.meta.url), "utf8");
  const kicks = await readFile(new URL("../tools/blender/build-fight-motion-foundry-v2-kicks-base.py", import.meta.url), "utf8");

  assert.match(mocap, /KIMODO_SOMA_TO_UAL/);
  assert.match(mocap, /"LeftShin", "calf_l"/);
  assert.match(mocap, /KIMODO_SOMA_BVH_WORLD_DELTA_V1/);
  assert.match(mocap, /motionPriorSourceProfile/);
  assert.match(kicks, /--kimodo-front/);
  assert.match(kicks, /--kimodo-low/);
  assert.match(kicks, /--kimodo-rising/);
  assert.match(kicks, /args\.kimodo_front or args\.mocap_front/);
  assert.match(kicks, /mocap_meta\.provider/);
});

test("Poly Fighter Kimodo authoring uses generated SOMA channels for candidate selection", async () => {
  const presets = JSON.parse(await readFile(new URL("../tools/kimodo/poly-fighter-presets.json", import.meta.url), "utf8"));
  const runner = await readFile(new URL("../tools/kimodo/generate-poly-fighter-kicks.sh", import.meta.url), "utf8");
  const selector = await readFile(new URL("../tools/kimodo/select-poly-fighter-kick.py", import.meta.url), "utf8");

  assert.equal(presets.model, "Kimodo-SOMA-RP-v1.1");
  assert.deepEqual(Object.keys(presets.moves).sort(), ["frontKick", "lowKick", "risingKick"]);
  for (const spec of Object.values(presets.moves)) {
    assert.equal(spec.seeds.length, 4);
    assert.ok(spec.duration >= 1 && spec.duration <= 1.25);
  }

  assert.match(runner, /kimodo_gen/);
  assert.match(runner, /kimodo_convert/);
  assert.match(runner, /select-poly-fighter-kick\.py/);
  assert.match(selector, /posed_joints/);
  assert.match(selector, /foot_contacts/);
  assert.match(selector, /smooth_root_pos/);
  assert.match(selector, /supportContactNearPeak/);
  assert.match(selector, /rotationVelocityRms/);
  assert.match(selector, /rotationAccelerationRms/);
  assert.match(selector, /maxRotationStepRad/);
});


test("Kimodo hand-strike generation feeds all six combat strikes into existing Foundry builders", async () => {
  const presets = JSON.parse(await readFile(new URL("../tools/kimodo/poly-fighter-strike-presets.json", import.meta.url), "utf8"));
  const runner = await readFile(new URL("../tools/kimodo/generate-poly-fighter-strikes.sh", import.meta.url), "utf8");
  const selector = await readFile(new URL("../tools/kimodo/select-poly-fighter-strike.py", import.meta.url), "utf8");
  const buildSelected = await readFile(new URL("../tools/kimodo/build-selected-strikes.sh", import.meta.url), "utf8");
  const rig = await readFile(new URL("../tools/blender/motion_foundry_v2_rig.py", import.meta.url), "utf8");
  const shared = await readFile(new URL("../tools/blender/build-fight-motion-foundry-v2-strikes.py", import.meta.url), "utf8");
  const cross = await readFile(new URL("../tools/blender/build-fight-motion-foundry-v2-cross.py", import.meta.url), "utf8");
  const power = await readFile(new URL("../tools/blender/build-fight-motion-foundry-v1.py", import.meta.url), "utf8");

  assert.deepEqual(Object.keys(presets.moves).sort(), ["backfist", "bodyBlow", "counter", "cross", "jab", "power"]);
  for (const spec of Object.values(presets.moves)) assert.equal(spec.seeds.length, 4);

  assert.match(runner, /kimodo_gen/);
  assert.match(runner, /kimodo_convert/);
  assert.match(selector, /LeftHand/);
  assert.match(selector, /RightHand/);
  assert.match(selector, /supportContactNearPeak/);
  assert.match(selector, /guardHandExcursion/);
  assert.match(selector, /rotationVelocityRms/);
  assert.match(selector, /rotationAccelerationRms/);
  assert.match(selector, /maxRotationStepRad/);
  assert.match(buildSelected, /--kimodo-jab/);
  assert.match(buildSelected, /--kimodo-counter/);
  assert.match(buildSelected, /--kimodo-prior "\$CROSS"/);
  assert.match(buildSelected, /--kimodo-prior "\$POWER"/);

  assert.match(rig, /prior_path: Optional\[str\] = None/);
  assert.match(rig, /event_kind="strike"/);
  assert.match(rig, /KIMODO_PRIOR_V1/);
  assert.match(shared, /--kimodo-jab/);
  assert.match(shared, /--kimodo-body-blow/);
  assert.match(shared, /--kimodo-backfist/);
  assert.match(shared, /--kimodo-counter/);
  assert.match(shared, /BF_Counter_R/);
  assert.match(cross, /--kimodo-prior/);
  assert.match(power, /--kimodo-prior/);
});

test("generated Counter is optional and preserves the procedural runtime fallback", async () => {
  const runtime = await readFile(new URL("../src/game/visual-quaternius-runtime.ts", import.meta.url), "utf8");
  const timeline = await readFile(new URL("../src/game/combat-motion-timeline.ts", import.meta.url), "utf8");

  assert.match(runtime, /runtime\.clips\.has\("BF_Counter_R"\)/);
  assert.match(runtime, /generatedCounter \? "BF_Counter_R"/);
  assert.match(runtime, /CM_Counter_/);
  assert.match(runtime, /quaterniusCounterMotionSource/);
  assert.match(timeline, /BF_Counter_R: events\(17 \/ 34\)/);
});


test("Poly Fighter synthesizes official Kimodo constraints at gameplay contact phases", async () => {
  const builder = await readFile(new URL("../tools/kimodo/build-poly-fighter-constraints.py", import.meta.url), "utf8");
  const kicks = JSON.parse(await readFile(new URL("../tools/kimodo/poly-fighter-presets.json", import.meta.url), "utf8"));
  const strikes = JSON.parse(await readFile(new URL("../tools/kimodo/poly-fighter-strike-presets.json", import.meta.url), "utf8"));
  const kickRunner = await readFile(new URL("../tools/kimodo/generate-poly-fighter-kicks.sh", import.meta.url), "utf8");
  const strikeRunner = await readFile(new URL("../tools/kimodo/generate-poly-fighter-strikes.sh", import.meta.url), "utf8");

  assert.match(builder, /"type": "fullbody"/);
  assert.match(builder, /"type": "root2d"/);
  assert.match(builder, /_constraint_type\(kind, spec\["strikeSide"\]\)/);
  assert.match(builder, /_support_type\(spec\["supportSide"\]\)/);
  assert.match(builder, /global_root_heading/);
  assert.match(builder, /matrix_to_axis_angle/);
  assert.match(builder, /target_contact/);
  assert.match(builder, /source_contact/);

  for (const collection of [kicks, strikes]) {
    assert.equal(collection.refinement.textWeight, 1.8);
    assert.equal(collection.refinement.constraintWeight, 2.8);
    assert.equal(collection.refinement.diffusionSteps, 140);
    for (const spec of Object.values(collection.moves)) {
      assert.equal(spec.refineSeeds.length, 2);
      assert.ok(spec.constraintProfile.contactPhase > 0.45 && spec.constraintProfile.contactPhase < 0.60);
      assert.ok(spec.constraintProfile.maxRootTravelM > 0 && spec.constraintProfile.maxRootTravelM <= 0.12);
      assert.equal(spec.constraintProfile.lockHeading, true);
    }
  }

  for (const runner of [kickRunner, strikeRunner]) {
    assert.match(runner, /selection\.initial\.json/);
    assert.match(runner, /build-poly-fighter-constraints\.py/);
    assert.match(runner, /--constraints "\$constraints"/);
    assert.match(runner, /--cfg_type separated/);
    assert.match(runner, /--cfg_weight "\$text_weight" "\$constraint_weight"/);
    assert.match(runner, /--diffusion_steps "\$steps"/);
  }
});

test("final Kimodo ranking compares exploratory and constrained candidates against gameplay timing", async () => {
  const kickSelector = await readFile(new URL("../tools/kimodo/select-poly-fighter-kick.py", import.meta.url), "utf8");
  const strikeSelector = await readFile(new URL("../tools/kimodo/select-poly-fighter-strike.py", import.meta.url), "utf8");
  for (const selector of [kickSelector, strikeSelector]) {
    assert.match(selector, /expectedGameplayImpactFrame/);
    assert.match(selector, /impactTimingErrorFrames/);
    assert.match(selector, /candidateKind/);
    assert.match(selector, /"_refine_"/);
    assert.match(selector, /glob\(f"\{move_id\}_\*\.npz"\)/);
  }
});

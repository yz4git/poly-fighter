import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("optional UniMate bridge uses the official custom-asset and replacement in-betweening paths", async () => {
  const runner = await readFile(new URL("../tools/unimate/run-poly-fighter-neural-inbetween.sh", import.meta.url), "utf8");

  assert.match(runner, /run_preprocess_char\.sh/);
  assert.match(runner, /FACE_R="thigh_r"/);
  assert.match(runner, /FACE_L="thigh_l"/);
  assert.match(runner, /dataset_stats\.npy/);
  assert.match(runner, /"objaverse" not in stats/);
  assert.match(runner, /dataset_list.*objaverse/);
  assert.match(runner, /python3 -m unimate\.inference\.sample/);
  assert.match(runner, /--inbetween/);
  assert.match(runner, /--keep_frames "\$KEEP_30"/);
  assert.match(runner, /--gt_start_frame 0/);
  assert.match(runner, /run_animate_motion\.sh" objaverse/);
  assert.match(runner, /ANIM_MODE="fk"/);
  assert.match(runner, /EXTRA_BONES_STRATEGY="keep"/);
  assert.match(runner, /export-animated-ual-bvh\.py/);
  assert.match(runner, /mode": "deterministic-fallback"/);
  assert.match(runner, /UNIMATE_UAL_BVH_REPLACEMENT_V1/);
});

test("UniMate animated GLB exporter preserves the UAL vocabulary for the Foundry prior adapter", async () => {
  const exporter = await readFile(new URL("../tools/unimate/export-animated-ual-bvh.py", import.meta.url), "utf8");
  const adapter = await readFile(new URL("../tools/blender/motion_foundry_v6_mocap.py", import.meta.url), "utf8");

  assert.match(exporter, /bpy\.ops\.import_scene\.gltf/);
  assert.match(exporter, /bpy\.ops\.export_anim\.bvh/);
  assert.match(exporter, /"pelvis"/);
  assert.match(exporter, /"upperarm_l"/);
  assert.match(exporter, /"thigh_r"/);
  assert.match(adapter, /UNIMATE_UAL_TO_UAL/);
  assert.match(adapter, /return "UNIMATE_UAL"/);
  assert.match(adapter, /UNIMATE_UAL_BVH_REPLACEMENT_V1/);
  assert.match(adapter, /\("pelvis", "pelvis"\)/);
  assert.match(adapter, /"left_hand": "hand_l"/);
  assert.match(adapter, /"right_foot": "foot_r"/);
});

test("all nine core combat moves have seven immutable 60 Hz anchor frames for neural replacement", async () => {
  const presets = JSON.parse(await readFile(new URL("../tools/unimate/poly-fighter-neural-inbetween-presets.json", import.meta.url), "utf8"));
  const expected = ["backfist", "bodyBlow", "counter", "cross", "frontKick", "jab", "lowKick", "power", "risingKick"];

  assert.deepEqual(Object.keys(presets.moves).sort(), expected);
  for (const spec of Object.values(presets.moves)) {
    assert.equal(spec.keepFrames60Hz.length, 7);
    assert.equal(spec.keepFrames60Hz[0], 1);
    assert.ok(spec.keepFrames60Hz.every((frame, index, frames) => index === 0 || frame > frames[index - 1]));
    assert.ok(spec.source.startsWith("public/models/quaternius/"));
    assert.ok(spec.prompt.length > 70);
  }
});

test("batch authoring keeps shipping packs unchanged when a complete neural set is unavailable", async () => {
  const generate = await readFile(new URL("../tools/unimate/generate-poly-fighter-neural-priors.sh", import.meta.url), "utf8");
  const build = await readFile(new URL("../tools/unimate/build-neural-priors-through-foundry.sh", import.meta.url), "utf8");

  assert.match(generate, /neuralCount/);
  assert.match(generate, /fallbackCount/);
  assert.match(generate, /run-poly-fighter-neural-inbetween\.sh/);
  assert.match(build, /Shared strikes: neural set incomplete; leave shipping pack unchanged/);
  assert.match(build, /Kicks: neural set incomplete; leave measured V6 shipping pack unchanged/);
  assert.match(build, /--motion-prior-jab/);
  assert.match(build, /--motion-prior-front/);
  assert.match(build, /--motion-prior "\$CROSS"/);
  assert.match(build, /--motion-prior "\$POWER"/);
});

test("Foundry exposes provider-neutral prior flags while preserving Kimodo legacy aliases", async () => {
  const shared = await readFile(new URL("../tools/blender/build-fight-motion-foundry-v2-strikes.py", import.meta.url), "utf8");
  const cross = await readFile(new URL("../tools/blender/build-fight-motion-foundry-v2-cross.py", import.meta.url), "utf8");
  const power = await readFile(new URL("../tools/blender/build-fight-motion-foundry-v1.py", import.meta.url), "utf8");
  const kicks = await readFile(new URL("../tools/blender/build-fight-motion-foundry-v2-kicks-base.py", import.meta.url), "utf8");
  const rig = await readFile(new URL("../tools/blender/motion_foundry_v2_rig.py", import.meta.url), "utf8");

  assert.match(shared, /--motion-prior-jab", "--kimodo-jab"/);
  assert.match(shared, /HYBRID_MOTION_PRIOR_V1/);
  assert.match(cross, /--motion-prior", "--kimodo-prior"/);
  assert.match(power, /--motion-prior", "--kimodo-prior"/);
  assert.match(kicks, /--motion-prior-front/);
  assert.match(kicks, /args\.motion_prior_front or args\.kimodo_front or args\.mocap_front/);
  assert.match(rig, /UNIMATE_NEURAL_REPLACEMENT_PRIOR_V1/);
  assert.match(rig, /KIMODO_PRIOR_V1/);
  assert.match(rig, /MOCAP_PRIOR_V6/);
});

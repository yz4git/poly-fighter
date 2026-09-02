import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Blender Motion Foundry authors Power with Blender IK and native visual bake", async () => {
  const source = await read("tools/blender/build-fight-motion-foundry-v1.py");
  assert.match(source, /ACTION_NAME = "BF_Power_R"/);
  assert.match(source, /BF_RightHandContactIK/);
  assert.match(source, /BF_LeftFootLockIK/);
  assert.match(source, /source_u_for_destination_u/);
  assert.match(source, /capture_visual_pose/);
  assert.match(source, /bake_visual_action/);
  assert.match(source, /bpy\.ops\.nla\.bake/);
  assert.match(source, /visual_keying=True/);
  assert.match(source, /export_scene\.gltf/);
});

test("runtime prefers Blender Power but preserves procedural fallback", async () => {
  const runtime = await read("src/game/visual-quaternius-runtime.ts");
  assert.match(runtime, /QUATERNIUS_BLENDER_CORE_URL/);
  assert.match(runtime, /power: "BF_Power_R"/);
  assert.match(runtime, /PROCEDURAL_FALLBACK/);
  assert.match(runtime, /BLENDER_MOTION_FOUNDRY_V1/);
  assert.match(runtime, /blenderClips\.has\("BF_Power_R"\)/);
});

test("Model View captures procedural and Blender Power at the same timeline position", async () => {
  const viewer = await read("src/game/model-viewer-motion.ts");
  const audit = await read("scripts/capture-model-view-audit.mjs");
  assert.match(viewer, /"BLENDER" \| "PROCEDURAL" \| "BASE"/);
  assert.match(viewer, /QUATERNIUS_BLENDER_CORE_URL/);
  assert.match(audit, /poseMotionViewer\(sessionId, "PF_Power_R", 0\.5\)/);
  assert.match(audit, /poseMotionViewer\(sessionId, "BF_Power_R", 0\.5\)/);
  assert.match(audit, /model-view-motion-procedural-power\.png/);
  assert.match(audit, /model-view-motion-blender-power\.png/);
});

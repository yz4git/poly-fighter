import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("UniMate-inspired replacement profile uses skeleton graph distance rather than a flat whole-body mask", async () => {
  const source = await readFile(new URL("../src/game/unimate-motion-replacement.ts", import.meta.url), "utf8");

  assert.match(source, /UNIMATE_INSPIRED_TOPOLOGY_REPLACEMENT_V1/);
  assert.match(source, /skeletonAdjacency/);
  assert.match(source, /graphDistances/);
  assert.match(source, /ATTACK_GRAPH_FALLOFF/);
  assert.match(source, /SUPPORT_GRAPH_FALLOFF/);
  assert.match(source, /contactBone\(input\.visualContact\)/);
  assert.match(source, /supportFoot\(input\.visualContact\)/);
  assert.match(source, /LOCOMOTION_LOWER_BODY/);
  assert.match(source, /GUARD_UPPER_BODY/);
  assert.match(source, /LANDING_LOWER_BODY/);
});

test("inertialization accepts per-bone replacement scales so authored joints can stay exact", async () => {
  const source = await readFile(new URL("../src/game/kimodo-motion-inertialization.ts", import.meta.url), "utf8");

  assert.match(source, /boneWeightScales\?: ReadonlyMap<string, number>/);
  assert.match(source, /const boneScale = THREE\.MathUtils\.clamp\(boneWeightScales\?\.get\(name\) \?\? 1, 0, 1\)/);
  assert.match(source, /const localWeight = weight \* boneScale/);
  assert.match(source, /replacementPinnedBones/);
  assert.match(source, /minimumBoneScale/);
});

test("runtime combines UniMate topology pinning with gameplay contact suppression and combo overlap", async () => {
  const source = await readFile(new URL("../src/game/visual-quaternius-runtime.ts", import.meta.url), "utf8");

  const profile = source.indexOf("buildUniMateReplacementProfile({");
  const inertial = source.indexOf("applyInertialTransition(", profile);
  assert.ok(profile >= 0);
  assert.ok(inertial > profile);
  assert.match(source, /uniMateProfile\.scales/);
  assert.match(source, /unimateReplacementMode/);
  assert.match(source, /unimateReplacementProtectedBones/);
  assert.match(source, /isAuthoredAttackClip\(previous\) && isAuthoredAttackClip\(next\)/);
  assert.match(source, /return \.075/);
  assert.match(source, /unimateMotionExpansionOverlap/);
});

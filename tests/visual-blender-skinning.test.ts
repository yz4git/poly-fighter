import assert from "node:assert/strict";
import test from "node:test";
import { classifySeraRuntimeColor, isSeraHeadLockedSemantic } from "../src/game/visual-blender-semantics";
import { classifySeraRuntimeRegion } from "../src/game/visual-blender-skinning";

function rgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

test("Blender SERA palette preserves gameplay-relevant semantics", () => {
  assert.equal(classifySeraRuntimeColor(...rgb(0xD7A38A)), "skin");
  assert.equal(classifySeraRuntimeColor(...rgb(0x2059C1)), "blue");
  assert.equal(classifySeraRuntimeColor(...rgb(0x387AD3)), "blueHi");
  assert.equal(classifySeraRuntimeColor(...rgb(0x0D0E16)), "black");
  assert.equal(classifySeraRuntimeColor(...rgb(0x9FADC2)), "silver");
  assert.equal(classifySeraRuntimeColor(...rgb(0x17151A)), "hair");
  assert.equal(classifySeraRuntimeColor(...rgb(0x8A4D55)), "lip");
});

test("hair and facial accents are head-locked semantics", () => {
  for (const semantic of ["hair", "eye", "brow", "lip", "skinShadow"] as const) {
    assert.equal(isSeraHeadLockedSemantic(semantic), true);
  }
  assert.equal(isSeraHeadLockedSemantic("black"), false);
  assert.equal(classifySeraRuntimeColor(Number.NaN, 0, 0), "unknown");
});

test("Blender SERA classifier keeps identity pieces off unrelated limbs", () => {
  assert.equal(classifySeraRuntimeRegion(0.06, 0.72, -0.11, "hair"), "HEAD");
  assert.equal(classifySeraRuntimeRegion(0.00, 0.82, 0.00, "blueHi"), "COLLAR");
  assert.equal(classifySeraRuntimeRegion(-0.17, 0.58, 0.00, "silver"), "LEFT_FOREARM");
  assert.equal(classifySeraRuntimeRegion(0.17, 0.58, 0.00, "silver"), "RIGHT_FOREARM");
  assert.equal(classifySeraRuntimeRegion(0.03, 0.49, 0.05, "blueHi"), "FRONT_SKIRT");
  assert.equal(classifySeraRuntimeRegion(-0.11, 0.49, 0.01, "blue"), "LEFT_SKIRT");
  assert.equal(classifySeraRuntimeRegion(0.11, 0.49, 0.01, "black"), "RIGHT_SKIRT");
  assert.equal(classifySeraRuntimeRegion(-0.05, 0.20, 0.00, "blueHi"), "LEFT_SHIN");
  assert.equal(classifySeraRuntimeRegion(0.05, 0.06, 0.04, "black"), "RIGHT_FOOT");
});

test("unknown colors use conservative axial fallback instead of arm assignment", () => {
  assert.equal(classifySeraRuntimeRegion(0.22, 0.76, 0.00, "unknown"), "TORSO");
  assert.equal(classifySeraRuntimeRegion(-0.22, 0.62, 0.00, "unknown"), "HIPS");
  assert.equal(classifySeraRuntimeRegion(0.18, 0.42, 0.00, "unknown"), "RIGHT_THIGH");
});

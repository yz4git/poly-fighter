import assert from "node:assert/strict";
import test from "node:test";
import { classifySeraRuntimeColor, isSeraHeadLockedSemantic } from "../src/game/visual-blender-semantics";

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

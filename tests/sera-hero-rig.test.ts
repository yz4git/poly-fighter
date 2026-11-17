import assert from "node:assert/strict";
import test from "node:test";
import { SERA_HERO_BONE_MAP, SERA_HERO_REQUIRED_BONES, SERA_HERO_RUNTIME_VERSION } from "../src/game/visual-hero-runtime";

test("SERA Hero binds required body joints to unique Mixamo targets", () => {
  const targets = new Set<string>();
  for (const name of SERA_HERO_REQUIRED_BONES) {
    const target = SERA_HERO_BONE_MAP[name];
    assert.ok(target, "Missing target " + name);
    assert.ok(!targets.has(target), "Duplicate target " + target);
    targets.add(target);
  }
  assert.ok(SERA_HERO_RUNTIME_VERSION.includes("PBR"));
});

test("SERA Hero maps both fighting hands, legs and feet", () => {
  for (const side of ["l", "r"] as const) {
    for (const part of ["upperarm", "lowerarm", "hand", "thigh", "calf", "foot"] as const) {
      assert.ok(SERA_HERO_BONE_MAP[(part + "_" + side) as keyof typeof SERA_HERO_BONE_MAP]);
    }
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { classifySeraRuntimeColor, isSeraHeadLockedSemantic } from "../src/game/visual-blender-semantics";
import {
  assignSeraBlenderSkinning,
  classifySeraRuntimeRegion,
  normalizeSeraInfluences,
  SERA_AUTHORED_PART,
  solveSeraAuthoredPartInfluences,
  solveSeraRuntimeInfluences,
} from "../src/game/visual-blender-skinning";

function rgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

const BONES: Record<string, number> = {
  hips: 1,
  spineLower: 2,
  spineUpper: 3,
  chest: 4,
  neck: 5,
  head: 6,
  leftUpperArm: 7,
  leftForearm: 8,
  leftHand: 9,
  rightUpperArm: 10,
  rightForearm: 11,
  rightHand: 12,
  leftThigh: 13,
  leftShin: 14,
  leftFoot: 15,
  rightThigh: 16,
  rightShin: 17,
  rightFoot: 18,
};

function weightSum(values: readonly (readonly [number, number])[]): number {
  return values.reduce((sum, [, weight]) => sum + weight, 0);
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

test("Blender SERA solver keeps head and authored guards on intended bones", () => {
  assert.deepEqual(solveSeraRuntimeInfluences("HEAD", 0.90, BONES, "hair"), [[BONES.head, 1]]);
  const leftGuard = solveSeraRuntimeInfluences("LEFT_FOREARM", 0.58, BONES, "silver");
  assert.equal(leftGuard[0][0], BONES.leftForearm);
  assert.ok(leftGuard[0][1] >= 0.95);
  const shinGuard = solveSeraRuntimeInfluences("RIGHT_SHIN", 0.20, BONES, "blueHi");
  assert.equal(shinGuard[0][0], BONES.rightShin);
  assert.ok(shinGuard[0][1] >= 0.96);
});

test("authored runtime parts are rigidly attached to their intended canonical bones", () => {
  const expected = [
    [SERA_AUTHORED_PART.HEAD, BONES.head],
    [SERA_AUTHORED_PART.LEFT_FOREARM_GUARD, BONES.leftForearm],
    [SERA_AUTHORED_PART.RIGHT_FOREARM_GUARD, BONES.rightForearm],
    [SERA_AUTHORED_PART.LEFT_SHIN_GUARD, BONES.leftShin],
    [SERA_AUTHORED_PART.RIGHT_SHIN_GUARD, BONES.rightShin],
    [SERA_AUTHORED_PART.LEFT_BOOT, BONES.leftFoot],
    [SERA_AUTHORED_PART.RIGHT_BOOT, BONES.rightFoot],
  ] as const;
  for (const [part, bone] of expected) {
    assert.deepEqual(solveSeraAuthoredPartInfluences(part, BONES), [[bone, 1]], `part ${part}`);
  }
  assert.equal(solveSeraAuthoredPartInfluences(SERA_AUTHORED_PART.HEURISTIC, BONES), null);
});

test("seraPart identity overrides misleading position and palette heuristics", () => {
  const parts = [
    SERA_AUTHORED_PART.LEFT_FOREARM_GUARD,
    SERA_AUTHORED_PART.RIGHT_FOREARM_GUARD,
    SERA_AUTHORED_PART.LEFT_SHIN_GUARD,
    SERA_AUTHORED_PART.RIGHT_SHIN_GUARD,
    SERA_AUTHORED_PART.LEFT_BOOT,
    SERA_AUTHORED_PART.RIGHT_BOOT,
    SERA_AUTHORED_PART.HEAD,
  ] as const;
  const expectedBones = [
    BONES.leftForearm,
    BONES.rightForearm,
    BONES.leftShin,
    BONES.rightShin,
    BONES.leftFoot,
    BONES.rightFoot,
    BONES.head,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    0.31, 0.91, 0.20,
    -0.31, 0.08, -0.20,
    0.28, 0.82, 0.16,
    -0.28, 0.82, -0.16,
    0.22, 0.70, 0.10,
    -0.22, 0.70, -0.10,
    0.00, 0.12, 0.00,
  ], 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(new Array(parts.length * 3).fill(0.5), 3));
  geometry.setAttribute("seraPart", new THREE.Float32BufferAttribute([...parts], 1));

  const diagnostics = assignSeraBlenderSkinning(geometry, BONES);
  const indices = geometry.getAttribute("skinIndex") as THREE.BufferAttribute;
  const weights = geometry.getAttribute("skinWeight") as THREE.BufferAttribute;
  for (let vertex = 0; vertex < parts.length; vertex += 1) {
    assert.equal(indices.getX(vertex), expectedBones[vertex], `part ${parts[vertex]} bone`);
    assert.equal(weights.getX(vertex), 1, `part ${parts[vertex]} weight`);
    assert.equal(weights.getY(vertex), 0);
    assert.equal(weights.getZ(vertex), 0);
    assert.equal(weights.getW(vertex), 0);
  }
  assert.equal(diagnostics.rigidAuthoredVertices, parts.length);
  assert.equal(diagnostics.invalidWeightVertices, 0);
  assert.equal(geometry.getAttribute("seraPart"), undefined);
  assert.equal(geometry.userData.skinningVersion, "SERA_BLENDER_SKIN_V3_PART_AWARE");
});

test("every profile produces finite normalized weights with at most four influences", () => {
  const samples = [
    ["COLLAR", 0.82, "blueHi"],
    ["TORSO", 0.74, "blue"],
    ["HIPS", 0.63, "blue"],
    ["FRONT_SKIRT", 0.45, "blueHi"],
    ["LEFT_SKIRT", 0.44, "blue"],
    ["RIGHT_SHOULDER", 0.74, "skin"],
    ["LEFT_UPPER_ARM", 0.64, "skin"],
    ["RIGHT_FOREARM", 0.54, "skin"],
    ["LEFT_HAND", 0.46, "skin"],
    ["RIGHT_THIGH", 0.48, "black"],
    ["LEFT_SHIN", 0.22, "black"],
    ["RIGHT_FOOT", 0.06, "black"],
  ] as const;
  for (const [region, y, semantic] of samples) {
    const weights = solveSeraRuntimeInfluences(region, y, BONES, semantic);
    assert.ok(weights.length >= 1 && weights.length <= 4, region);
    assert.ok(weights.every(([bone, weight]) => Number.isInteger(bone) && bone >= 0 && Number.isFinite(weight) && weight > 0), region);
    assert.ok(Math.abs(weightSum(weights) - 1) < 1e-6, region);
  }

  assert.deepEqual(normalizeSeraInfluences([[3, 0.5], [3, 0.25], [4, 0.25], [-1, 1], [8, Number.NaN]]), [[3, 0.75], [4, 0.25]]);
});

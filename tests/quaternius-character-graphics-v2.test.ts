import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { QUATERNIUS_CHARACTER_GRAPHICS_V2_ID } from "../src/game/quaternius-character-graphics-v2";

test("Character Graphics v2 keeps the UBC rig and adds layered face/silhouette detail", async () => {
  assert.equal(
    QUATERNIUS_CHARACTER_GRAPHICS_V2_ID,
    "QUATERNIUS_CHARACTER_GRAPHICS_V2_FACIAL_SILHOUETTE_LAYERING",
  );

  const v2 = await readFile(new URL("../src/game/quaternius-character-graphics-v2.ts", import.meta.url), "utf8");
  assert.match(v2, /BIND_TO_ANIMATED_DELTA/);
  assert.match(v2, /inverseBindBoneRootQuaternion/);
  assert.match(v2, /poseDelta\.copy\(currentBoneRootQuaternion\)\.multiply\(inverseBindBoneRootQuaternion\)/);
  assert.match(v2, /characterGraphicsV2Layer/);
  assert.match(v2, /quaterniusCharacterGraphicsV2TriangleCount/);

  for (const required of [
    "ubc-kairo-v2-left-brow",
    "ubc-kairo-v2-right-brow",
    "ubc-kairo-v2-left-cheek-plane",
    "ubc-kairo-v2-chest-chevron",
    "ubc-kairo-v2-left-shoulder-fin",
    "ubc-kairo-v2-left-knuckle-cap",
    "ubc-kairo-v2-left-thigh-plate",
    "ubc-sera-v2-left-face-lock",
    "ubc-sera-v2-ponytail-tip",
    "ubc-sera-v2-left-brow",
    "ubc-sera-v2-left-cheek-plane",
    "ubc-sera-v2-chest-prism",
    "ubc-sera-v2-left-shoulder-wing",
    "ubc-sera-v2-left-waist-sash",
    "ubc-sera-v2-right-waist-tab",
    "ubc-sera-v2-left-thigh-panel",
  ]) {
    assert.match(v2, new RegExp(required));
  }

  assert.doesNotMatch(v2, /ubc-sera-v2-left-forearm-fin/);
  assert.doesNotMatch(v2, /ubc-sera-v2-right-forearm-fin/);
  assert.match(v2, /KAIRO_FORGE_V2_FACE_FRAME_COLLAR_ARMORED_SILHOUETTE/);
  assert.match(v2, /SERA_PRISM_V2_FACE_FRAME_ASYMMETRIC_SASH_LAYERED_SILHOUETTE/);
});

test("fighter visual entry schedules Character Graphics v2 only for Quaternius UBC", async () => {
  const entry = await readFile(new URL("../src/game/visual-entry.ts", import.meta.url), "utf8");
  assert.match(entry, /scheduleQuaterniusCharacterGraphicsV2/);
  assert.match(
    entry,
    /if \(modelId === "QUATERNIUS_UBC"\) \{[\s\S]*scheduleQuaterniusGraphicsPolish\(polished, definition\);[\s\S]*scheduleQuaterniusCharacterGraphicsV2\(polished, definition\);[\s\S]*scheduleQuaterniusOutfitSkin\(polished, definition\);/,
  );
});

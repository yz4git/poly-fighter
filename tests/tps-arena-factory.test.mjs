import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TPS arena construction is isolated from fight orchestration", async () => {
  const [core, arena] = await Promise.all([
    readFile(new URL("../src/game/tps-game-base.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/game/tps-arena-factory.ts", import.meta.url), "utf8"),
  ]);

  assert.match(core, /createCircularArena, TPS_ARENA_RADIUS as ARENA_RADIUS/);
  assert.doesNotMatch(core, /function createCircularArena\(/);
  assert.match(arena, /export const TPS_ARENA_RADIUS = 6\.8/);
  assert.match(arena, /export function createCircularArena\(\)/);
  assert.match(arena, /new THREE\.CircleGeometry\(TPS_ARENA_RADIUS/);
  assert.match(arena, /tps-circular-arena/);
});

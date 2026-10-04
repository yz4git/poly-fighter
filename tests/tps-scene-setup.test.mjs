import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TPS scene setup owns renderer, lighting, arena, and lock-on meshes", async () => {
  const [setup, core] = await Promise.all([
    readFile(new URL("../src/game/tps-scene-setup.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/game/tps-game-base.ts", import.meta.url), "utf8"),
  ]);

  assert.match(setup, /export function createTpsSceneSetup/);
  assert.match(setup, /new THREE\.WebGLRenderer/);
  assert.match(setup, /new THREE\.HemisphereLight/);
  assert.match(setup, /createCircularArena\(\)/);
  assert.match(setup, /new THREE\.TorusGeometry/);
  assert.match(setup, /new THREE\.RingGeometry/);
  assert.match(core, /const setup = createTpsSceneSetup/);
  assert.doesNotMatch(core, /const lockGeometry = new THREE\.TorusGeometry/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TPS geometry helpers are isolated from fight orchestration", async () => {
  const source = await readFile(new URL("../src/game/tps-geometry.ts", import.meta.url), "utf8");

  assert.match(source, /export function horizontalDirection/);
  assert.match(source, /export function horizontalDistance/);
  assert.match(source, /export function horizontalRadius/);
  assert.match(source, /export function clampToArena/);
  assert.match(source, /TPS_ARENA_RADIUS - margin/);
  assert.match(source, /export function ease/);
});

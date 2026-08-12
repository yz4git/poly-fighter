import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("startup keeps Safari orientation locking optional and reports game construction failures", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(!orientation\?\.lock\) return;/);
  assert.doesNotMatch(page, /lock\?\.\("landscape"\)\.catch/);
  assert.match(page, /game startup failed/);
  assert.match(page, /setFallback\("3D描画を開始できませんでした/);
});

test("the render loop has a user-visible recovery path for runtime and WebGL failures", async () => {
  const game = await readFile(new URL("../src/game/game.ts", import.meta.url), "utf8");
  assert.match(game, /webglcontextlost/);
  assert.match(game, /handleRuntimeFailure/);
  assert.match(game, /ゲーム描画中にエラーが発生しました/);
});

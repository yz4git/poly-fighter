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

test("touch controls force-release interrupted iPhone pointer ownership", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const safety = await readFile(new URL("../app/TouchInputSafety.tsx", import.meta.url), "utf8");

  assert.match(layout, /<TouchInputSafety \/>/);
  assert.match(safety, /\.virtual-pad, \.touch-action/);
  assert.match(safety, /document\.addEventListener\("pointerdown", onPointerDown, true\)/);
  assert.match(safety, /window\.addEventListener\("pointerup", onPointerFinished, true\)/);
  assert.match(safety, /window\.addEventListener\("pointercancel", onPointerFinished, true\)/);
  assert.match(safety, /document\.addEventListener\("lostpointercapture", onLostPointerCapture, true\)/);
  assert.match(safety, /window\.addEventListener\("blur", releaseAll\)/);
  assert.match(safety, /window\.addEventListener\("pagehide", releaseAll\)/);
  assert.match(safety, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
  assert.match(safety, /document\.addEventListener\("touchcancel", releaseAll, true\)/);
  assert.match(safety, /event\.touches\.length === 0/);
  assert.match(safety, /releasePointerCapture/);
  assert.match(safety, /createSyntheticPointerCancel/);
  assert.match(safety, /active\.target\.dispatchEvent/);
});

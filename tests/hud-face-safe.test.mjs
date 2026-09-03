import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/hud-face-safe.css", import.meta.url), "utf8");
const camera = await readFile(new URL("../src/game/camera.ts", import.meta.url), "utf8");

test("face-safe HUD override loads after the general playtest polish", () => {
  const polishIndex = layout.indexOf('import "./playtest-polish.css"');
  const faceSafeIndex = layout.indexOf('import "./hud-face-safe.css"');
  assert.ok(polishIndex >= 0, "playtest polish import missing");
  assert.ok(faceSafeIndex > polishIndex, "face-safe HUD must load last");
});

test("short landscape HUD collapses fighter labels and health into one visual row", () => {
  assert.match(css, /orientation: landscape/);
  assert.match(css, /max-height: 560px/);
  assert.match(css, /grid-template-rows: 24px/);
  assert.match(css, /\.hud-name[\s\S]*grid-row: 1/);
  assert.match(css, /\.health-track[\s\S]*grid-row: 1/);
  assert.match(css, /height: 18px/);
  assert.match(css, /max-height: 430px/);
  assert.match(css, /grid-template-rows: 20px/);
  assert.match(css, /height: 16px/);
});

test("duel camera reserves headroom below the top HUD without changing fighter positions", () => {
  assert.match(camera, /Face-safe composition/);
  assert.match(camera, /1\.62 \+ Math\.max\(p1\.position\.y, p2\.position\.y\) \* 0\.24/);
  assert.match(camera, /1\.44,/);
  assert.match(camera, /2\.18,/);
  assert.equal(camera.includes("p1.position.y ="), false);
  assert.equal(camera.includes("p2.position.y ="), false);
});

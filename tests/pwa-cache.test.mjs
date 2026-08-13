import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Blender prototype PRs reuse the existing real WebGL audit workflow; this file
// is an intentional audit trigger without changing the game runtime.
test("PWA manifest and cache version exist", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  const serviceWorker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.equal(manifest.name, "POLY FIGHTER");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.orientation, "landscape");
  assert.match(serviceWorker, /poly-fighter-v17/);
  assert.match(serviceWorker, /models\/sera-v10\.glb/);
  assert.match(serviceWorker, /models\/sera-v10\.metrics\.json/);
  assert.match(serviceWorker, /skipWaiting/);
  assert.match(serviceWorker, /clients\.claim/);
});

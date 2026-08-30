import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("PWA manifest and Blender runtime cache version exist", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  const serviceWorker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.equal(manifest.name, "POLY FIGHTER");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.orientation, "landscape");
  assert.match(serviceWorker, /poly-fighter-v20/);
  assert.match(serviceWorker, /models\/sera-blender-runtime\.glb/);
  assert.match(serviceWorker, /models\/sera-blender-runtime\.metrics\.json/);
  assert.match(serviceWorker, /models\/sera-v10\.glb/);
  assert.match(serviceWorker, /models\/sera-v10\.metrics\.json/);
  assert.match(serviceWorker, /skipWaiting/);
  assert.match(serviceWorker, /clients\.claim/);
});

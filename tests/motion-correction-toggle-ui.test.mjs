import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("settings UI exposes motion correction toggle", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /MOTION CORRECTION/);
  assert.match(page, /settings\.motionCorrections \? "ON" : "OFF"/);
});

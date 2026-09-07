import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TPS lock-on is the only playable main match route", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /PolyFightGame/);
  assert.doesNotMatch(source, /type BattleMode/);
  assert.doesNotMatch(source, /setScreen\(\"MATCH\"\)/);
  assert.doesNotMatch(source, />START MATCH</);
  assert.match(source, />START FIGHT</);
  assert.match(source, /TPS LOADOUT/);
  assert.match(source, /new TpsFightGame/);
  assert.match(source, /setScreen\(\"TPS_MATCH\"\)/);
  assert.match(source, /tps-two-button-actions/);
});

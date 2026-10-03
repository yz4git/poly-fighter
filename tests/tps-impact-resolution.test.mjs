import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TPS impact resolution keeps damage and reaction policy separate from runtime mutation", async () => {
  const [resolution, presentation, core] = await Promise.all([
    readFile(new URL("../src/game/tps-impact-resolution.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/game/tps-impact-presentation.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/game/tps-game-base.ts", import.meta.url), "utf8"),
  ]);

  assert.match(resolution, /export function computeTpsHitResolution/);
  assert.match(resolution, /1\.22 \* playerDna\.interceptDamageScale/);
  assert.match(resolution, /1\.18 \* playerDna\.reversalDamageScale/);
  assert.match(resolution, /defenderWasAttacking \? 1\.12 : 1/);
  assert.match(resolution, /reactionType: TpsReactionType/);
  assert.match(resolution, /export function tpsImpactHeightForMove/);
  assert.match(presentation, /export function applyTpsImpactPresentation/);
  assert.match(presentation, /tpsImpactPairRole = "ATTACKER"/);
  assert.match(presentation, /tpsReactionType = reactionType/);
  assert.match(core, /const resolution = computeTpsHitResolution/);
  assert.match(core, /applyTpsImpactPresentation/);
  assert.doesNotMatch(core, /const damageScale = interceptStrike/);
});

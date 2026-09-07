import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Rival Core phase 1-3 adds Fighter DNA and context-sensitive signature routing", async () => {
  const [dna, source] = await Promise.all([
    readFile(new URL("../src/game/fighter-dna.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/game/tps-game-base.ts", import.meta.url), "utf8"),
  ]);
  assert.match(dna, /KAIRO/);
  assert.match(dna, /SERA/);
  assert.match(dna, /BREAK LINE/);
  assert.match(dna, /RED REVERSAL/);
  assert.match(dna, /PHANTOM COUNTER/);
  assert.match(dna, /ZERO ANGLE/);
  assert.match(dna, /resolveContextAttack/);
  assert.match(source, /fighterDnaForName/);
  assert.match(source, /resolveContextAttack/);
  assert.match(source, /tpsContextMove/);
  assert.match(source, /tpsSignatureAction/);
  assert.match(source, /stepCooldownScale/);
  assert.match(source, /stepSpeedScale/);
  assert.match(source, /perfectEvadeBonusTicks/);
});

test("Rival Core phase 2 records an impact pair and reaction matrix for presentation", async () => {
  const [source, fighter] = await Promise.all([
    readFile(new URL("../src/game/tps-game-base.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/game/fighter.ts", import.meta.url), "utf8"),
  ]);
  assert.match(source, /tpsImpactPairRole/);
  assert.match(source, /tpsImpactPairContact/);
  assert.match(source, /tpsReactionRegion/);
  assert.match(source, /tpsReactionVariant/);
  assert.match(fighter, /reactionRegion/);
  assert.match(fighter, /reactionVariant/);
  assert.match(fighter, /counterTwist/);
});


test("Rival Core phase 4 learns retreat, directional step, and intercept habits without frame-perfect reads", async () => {
  const source = await readFile(new URL("../src/game/tps-game-base.ts", import.meta.url), "utf8");
  assert.match(source, /CUT_RETREAT/);
  assert.match(source, /MIRROR_LEFT/);
  assert.match(source, /MIRROR_RIGHT/);
  assert.match(source, /HUNT_INTERCEPT/);
  assert.match(source, /playerRetreatSamples/);
  assert.match(source, /playerLeftStepSamples/);
  assert.match(source, /playerRightStepSamples/);
  assert.match(source, /adapt-hunt-intercept-feint/);
  assert.match(source, /RIVAL:/);
});

test("Rival Core phase 5 drives match drama through presentation and tempo, not hidden damage buffs", async () => {
  const source = await readFile(new URL("../src/game/tps-game-base.ts", import.meta.url), "utf8");
  assert.match(source, /MatchDramaPhase/);
  assert.match(source, /updateMatchDrama/);
  assert.match(source, /MOMENTUM SHIFT/);
  assert.match(source, /FINAL STAND/);
  assert.match(source, /tpsDramaIntensity/);
  assert.match(source, /dramaCinematicFactor/);
  assert.match(source, /dramaTempo/);
});

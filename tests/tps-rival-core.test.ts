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


test("Rival Core phase 6 makes DNA authoritative in the real TPS extension and adds a bounded final-impact lens beat", async () => {
  const source = await readFile(new URL("../src/game/tps-game.ts", import.meta.url), "utf8");
  assert.match(source, /resolveContextAttack/);
  assert.match(source, /useSignatureContext/);
  assert.match(source, /game\.p1Dna\.stepSpeedScale/);
  assert.match(source, /game\.p2Dna\.moveSpeedScale/);
  assert.match(source, /__finalImpactSeconds/);
  assert.match(source, /tpsFinalImpactFactor/);
  assert.match(source, /baseFov - factor \* 3\.2/);
  assert.match(source, /tpsSignaturePursuitLunge/);
  assert.match(source, /PERFECT_COUNTER_MAX_LUNGE/);
});

test("Rival Core phase 7 layers signature audio and distinct haptic patterns", async () => {
  const [audio, source] = await Promise.all([
    readFile(new URL("../src/game/audio.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/game/tps-game-base.ts", import.meta.url), "utf8"),
  ]);
  assert.match(audio, /combatSignature/);
  assert.match(audio, /FINAL_IMPACT/);
  assert.match(source, /combatSignature\("INTERCEPT"/);
  assert.match(source, /combatSignature\("REVERSAL"/);
  assert.match(source, /\[28, 18, 42\]/);
});

test("Rival Core phase 8 exposes a six-step interactive training path on the audited TPS runtime", async () => {
  const [training, page, css] = await Promise.all([
    readFile(new URL("../src/game/tps-training.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/playtest-polish.css", import.meta.url), "utf8"),
  ]);
  assert.match(training, /PERFECT STEP/);
  assert.match(training, /INTERCEPT/);
  assert.match(training, /advanceTpsTrainingStage/);
  assert.match(page, /TRAINING/);
  assert.match(page, /startTraining/);
  assert.match(page, /training-coach/);
  assert.match(css, /\.training-coach/);
});



test("training requires fresh resolved successes, never headlines or a KO", async () => {
  const { advanceTpsTrainingStage, EMPTY_TPS_TRAINING } = await import("../src/game/tps-training");
  const hud = { phase: "MATCH", round: 1, timer: 99, p1Health: 100, p2Health: 0,
    p1Wins: 1, p2Wins: 0, p1Name: "KAIRO", p2Name: "SERA", message: "RED REVERSAL",
    p1State: "IDLE", p2State: "KO", tpsTraining: { ...EMPTY_TPS_TRAINING } } as const;
  assert.equal(advanceTpsTrainingStage(2, hud, EMPTY_TPS_TRAINING), 2);
  assert.equal(advanceTpsTrainingStage(4, { ...hud, message: "BREAK LINE" }, EMPTY_TPS_TRAINING), 4);
  const keys = ["hits", "sideSteps", "perfectEvades", "punishes", "intercepts"] as const;
  for (const stage of [0, 1, 2, 3, 4] as const) {
    const progress = { ...EMPTY_TPS_TRAINING, [keys[stage]]: 1 };
    const success = { ...hud, message: "MOMENTUM SHIFT", tpsTraining: progress };
    assert.equal(advanceTpsTrainingStage(stage, success, EMPTY_TPS_TRAINING), stage + 1);
    assert.equal(advanceTpsTrainingStage(stage, success, progress), stage, "old successes cannot clear the next lesson");
  }
  assert.equal(advanceTpsTrainingStage(5, hud, EMPTY_TPS_TRAINING), 5);
});

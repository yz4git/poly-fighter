import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { TpsFightGame } from "../src/game/tps-game-base";
import { TpsFightGame as LiveTpsFightGame } from "../src/game/tps-game";
import { FighterRuntime } from "../src/game/fighter";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { fighterDnaForName } from "../src/game/fighter-dna";
import { EMPTY_INPUT, type InputFrame } from "../src/game/types";
import { adaptTpsCpuDecision, tpsEnemyRecoveryHabit } from "../src/game/tps-enemy-policy";
import { chooseTpsOpeningStrike, tpsOpeningRange } from "../src/game/tps-fight-fundamentals";
import { applyTpsImpactPresentation } from "../src/game/tps-impact-presentation";

// Real simulation methods and FighterRuntime, with only rendering/audio omitted.
// This reproduces the REACT cue -> STEP -> active contact regression without WebGL.
type Sim = {
  p1: FighterRuntime; p2: FighterRuntime;
  trainingProgress: { perfectEvades: number; punishes: number };
  playerReversalTicks: number;
  enemyDirectorTelegraphTicks: number;
  enemyDirectorPendingMove: string | null;
  enemyTelegraphAim: THREE.Vector3 | null;
  updatePlayer(input: InputFrame): void;
  updateEnemy(): void;
  trackCommittedAttack(a: FighterRuntime, d: FighterRuntime): void;
  applyAttackStepIn(a: FighterRuntime, d: FighterRuntime): void;
  resolveAttack(a: FighterRuntime, d: FighterRuntime, guarding: boolean): void;
};
function simulation(telegraphTicks = 12, distance = 1.44, live = false): Sim {
  const p1 = new FighterRuntime("p1", FIGHTER_DEFINITIONS.red);
  const p2 = new FighterRuntime("p2", FIGHTER_DEFINITIONS.blue, true);
  p1.resetForRound(0, distance / 2, 1); p2.resetForRound(0, -distance / 2, -1);
  const wait = { intent: "WAIT", holdTicks: 30, telegraphTicks: 0, reason: "test", comebackMercy: 0, pressure: 0 };
  const game = Object.assign(Object.create(live ? LiveTpsFightGame.prototype : TpsFightGame.prototype), {
    p1, p2, difficulty: "NORMAL", p1Dna: fighterDnaForName(p1.definition.name), p2Dna: fighterDnaForName(p2.definition.name),
    attackCommitments: new WeakMap(), simulationTicks: 0,
    playerEvadeTicks: 0, playerEvadeCooldown: 0, playerEvadeSign: 0,
    playerStepDirection: new THREE.Vector3(), playerStepForwardWeight: 0, playerStepSideWeight: 0,
    playerComboStage: 0, playerComboGraceTicks: 0, playerAttackQueued: false, playerStepAttackQueued: false,
    playerFlankWindowTicks: 0, playerFlankAttackTicks: 0, playerPerfectEvadeTicks: 0,
    playerStepThreatTicks: 0, playerStepThreatMoveId: null, playerStepThreatPosition: null,
    playerInterceptTicks: 0, playerReversalTicks: 0, playerAttackSamples: 0, playerStepSamples: 0,
    playerLeftStepSamples: 0, playerRightStepSamples: 0, playerRetreatSamples: 0,
    enemyFunDirector: { observe() {}, decide() { return wait; } }, enemyCooldown: 0,
    enemyOpeningGraceTicks: 0, enemyAdaptReviewTicks: 999, enemyTacticTicks: 999,
    enemyPersona: "SKIRMISHER", enemyAdaptation: "NEUTRAL", enemyOrbitSign: 1,
    enemyDirectorDecision: { ...wait, intent: "JAB", holdTicks: 1 }, enemyDirectorHoldTicks: 0,
    enemyDirectorPendingMove: "jab", enemyDirectorTelegraphTicks: telegraphTicks, enemyDirectorTelegraphTotalTicks: telegraphTicks,
    enemyTelegraphAim: null, enemyTelegraphAimMove: null, enemyAttackCount: 0,
    enemyPostAttackTicks: 0, enemyPostAttackIntent: "WAIT", enemyLastMoveId: null,
    trainingProgress: { hits: 0, sideSteps: 0, perfectEvades: 0, punishes: 0, intercepts: 0 },
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
    __hypeDirector: { step() {}, comboShift() {}, hit() {}, dash() {} },
    audio: { rush() {}, comboShift() {}, hypeImpact() {} },
    emitImpactFeedback() {},
  });
  return game as Sim;
}
function tick(game: Sim, input: Partial<InputFrame> = {}) {
  game.updatePlayer({ ...EMPTY_INPUT, ...input });
  game.updateEnemy();
  game.trackCommittedAttack(game.p1, game.p2); game.trackCommittedAttack(game.p2, game.p1);
  game.applyAttackStepIn(game.p1, game.p2); game.applyAttackStepIn(game.p2, game.p1);
  game.resolveAttack(game.p1, game.p2, false);
  game.resolveAttack(game.p2, game.p1, false);
}

test("REACT cue sidestep physically escapes the first jab and earns exactly one reversal", () => {
  const game = simulation();
  tick(game, { right: true, guard: true });
  for (let i = 0; i < 24 && game.trainingProgress.perfectEvades === 0; i++) tick(game);
  assert.equal(game.p1.health, 100);
  assert.equal(game.trainingProgress.perfectEvades, 1);
  assert.ok(game.playerReversalTicks > 0);
  for (let i = 0; i < 5; i++) tick(game);
  assert.equal(game.trainingProgress.perfectEvades, 1, "one attack cannot pay the dodge reward twice");
});

test("live TPS controller converts a physically earned sidestep into a reachable counter", () => {
  const game = simulation(12, 1.44, true);
  tick(game, { right: true, guard: true });
  for (let i = 0; i < 30 && game.trainingProgress.perfectEvades === 0; i++) tick(game);
  assert.equal(game.trainingProgress.perfectEvades, 1);
  tick(game, { punch: true });
  for (let i = 0; i < 35 && game.trainingProgress.punishes === 0; i++) tick(game);
  assert.equal(game.trainingProgress.punishes, 1);
  assert.ok(game.p2.health < 100);
});

test("a STEP begun just before contact is still hit while inside the attack lane", () => {
  const game = simulation(0, 1.34);
  game.enemyDirectorPendingMove = null;
  game.p2.beginMove("jab"); game.p2.moveTick = game.p2.currentMove!.startup - 1;
  game.trackCommittedAttack(game.p2, game.p1);
  tick(game, { right: true, guard: true });
  assert.ok(game.p1.health < 100);
  assert.equal(game.trainingProgress.perfectEvades, 0);
});

test("standing still takes the jab; an early/out-of-range step cannot bank a perfect evade", () => {
  const still = simulation();
  for (let i = 0; i < 23; i++) tick(still);
  assert.ok(still.p1.health < 100, "the REACT cue itself is not an invulnerability window");
  const early = simulation(28);
  tick(early, { right: true, guard: true });
  for (let i = 0; i < 45; i++) tick(early);
  assert.equal(early.trainingProgress.perfectEvades, 0);
  const far = simulation(12, 3.4);
  tick(far, { right: true, guard: true });
  for (let i = 0; i < 24; i++) tick(far);
  assert.equal(far.trainingProgress.perfectEvades, 0, "dodging an attack that could not reach is not a perfect evade");
});

test("touch opener keeps its range across boundary jitter and changes after a deliberate move", () => {
  let band = tpsOpeningRange(1.45);
  for (const d of [1.60, 1.68, 1.63, 1.73]) {
    band = tpsOpeningRange(d, band);
    assert.equal(chooseTpsOpeningStrike({ distance: d, previousRange: band, forward: false, back: false, lateral: false }).moveId, "jab");
  }
  band = tpsOpeningRange(1.85, band);
  assert.equal(band, "FAR");
  for (const d of [1.72, 1.60, 1.65]) assert.equal(tpsOpeningRange(d, band), "FAR");
  assert.equal(tpsOpeningRange(1.45, band), "CLOSE");
});

test("CPU phrases and post-attack habits are readable while tactical adaptation keeps priority", () => {
  const decision = { intent: "JAB" as const, holdTicks: 1, telegraphTicks: 12, reason: "neutral", comebackMercy: 0, pressure: 0 };
  const phrase = [0, 1, 2, 3].map(attackCount => adaptTpsCpuDecision(decision, {
    persona: "BRAWLER", adaptation: "NEUTRAL", liveDistance: 1.4, simulationTicks: 0, attackCount,
  }).intent);
  assert.deepEqual(phrase, ["JAB", "STRAIGHT", "POWER", "JAB"]);
  assert.equal(adaptTpsCpuDecision(decision, { persona: "BRAWLER", adaptation: "ANTI_STEP", liveDistance: 1.4, simulationTicks: 0, attackCount: 2 }).intent, "COUNTER");
  assert.deepEqual(tpsEnemyRecoveryHabit("SKIRMISHER", "lowKick"), { intent: "RETREAT", ticks: 12 });
  assert.deepEqual(tpsEnemyRecoveryHabit("BRAWLER", "power"), { intent: "WAIT", ticks: 10 });
});

test("resolved contacts select body-region reactions and restart repeated guard contacts", () => {
  const game = simulation();
  for (const [moveId, region] of [["jab", "HEAD"], ["kick", "BODY"], ["lowKick", "LEGS"]] as const) {
    game.p1.state = "IDLE"; game.p1.beginMove(moveId);
    applyTpsImpactPresentation({ attacker: game.p1, defender: game.p2, simulationTicks: 1,
      moveId, contact: { x: 0, y: 1.8, z: 0 }, direction: { x: 0, z: -1 },
      reactionType: "NORMAL", reactionRegion: region, reactionVariant: 0, reactionStrength: 1, impactPairStrength: 1,
    });
    assert.match(game.p2.visual.root.userData.tpsContactReactionClip, new RegExp(`^CM_Hit_${region}_`));
  }
  const serial = game.p2.reactionSerial;
  for (let i = 0; i < 2; i++) applyTpsImpactPresentation({ attacker: game.p1, defender: game.p2, simulationTicks: i + 2,
    moveId: "lowKick", contact: { x: 0, y: .9, z: 0 }, direction: { x: 0, z: -1 },
    reactionType: "BLOCK", reactionRegion: "LEGS", reactionVariant: 0, reactionStrength: .72, impactPairStrength: .72,
  });
  assert.match(game.p2.visual.root.userData.tpsContactReactionClip, /^CM_Block_/);
  assert.equal(game.p2.reactionSerial, serial + 2);
});

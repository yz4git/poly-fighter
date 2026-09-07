import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readTpsSource(): Promise<string> {
  const [core, extension] = await Promise.all([
    readFile(new URL("../src/game/tps-game-base.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/game/tps-game.ts", import.meta.url), "utf8"),
  ]);
  return `${core}\n${extension}`;
}

test("TPS lock-on battle owns circular 360-degree locomotion and over-shoulder camera", async () => {
  const source = await readTpsSource();
  assert.match(source, /ARENA_RADIUS = 6\.8/);
  assert.match(source, /new THREE\.CircleGeometry\(ARENA_RADIUS/);
  assert.match(source, /horizontalDirection\(this\.p1\.position, this\.p2\.position\)/);
  assert.match(source, /new THREE\.Vector3\(-toEnemy\.z, 0, toEnemy\.x\)/);
  assert.match(source, /fighter\.visual\.root\.quaternion\.setFromUnitVectors\(MODEL_FORWARD, forward\)/);
  assert.match(source, /cameraTarget\.copy\(this\.cameraFocus\)/);
  assert.match(source, /cameraLookTarget/);
  assert.match(source, /ease\(this\.cameraLookTarget, this\.cameraTarget, 12\.0, delta\)/);
  assert.match(source, /closeFactor = THREE\.MathUtils\.clamp/);
  assert.match(source, /aspect < 2\.4 \? 52 : 47/);
  assert.match(source, /compactLandscapeFactor/);
  assert.match(source, /TPS_CAMERA_CLOSE_SHOULDER_BONUS = 3\.75/);
  assert.match(source, /TPS_CAMERA_CLOSE_BACK_DELTA = -0\.95/);
  assert.match(source, /TPS_CAMERA_CLOSE_ANCHOR_BLEND = 0\.88/);
  assert.match(source, /TPS_CAMERA_CLOSE_TARGET_MIDPOINT_BLEND = 0\.42/);
  assert.match(source, /TPS_CAMERA_CLOSE_TARGET_SIDE_SHIFT = 0\.36/);
  assert.match(source, /TPS_CAMERA_CLOSE_TARGET_LIFT = 0\.14/);
  assert.match(source, /TPS_CAMERA_IMPACT_BACK_DELTA = 0\.24/);
  assert.match(source, /TPS_CAMERA_IMPACT_SHOULDER = 0\.18/);
  assert.match(source, /TPS_CAMERA_MAX_TRAVEL_SPEED = 15\.0/);
  assert.match(source, /TPS_CLOSE_ORBIT_SPEED_SCALE = 0\.65/);
  assert.match(source, /locomotionSpeedScale/);
  assert.match(source, /cameraFrameStart/);
  assert.match(source, /TPS_IMPACT_CONTACT_MINIMUM = 1\.52/);
  assert.match(source, /TPS_IMPACT_CONTACT_MINIMUM_HEAVY = 1\.58/);
  assert.match(source, /TPS_IMPACT_CONTACT_MINIMUM_KICK = 1\.62/);
  assert.match(source, /TPS_IMPACT_HEIGHTS/);
  assert.match(source, /risingKick: 2\.06/);
  assert.match(source, /impactPosition\.y = TPS_IMPACT_HEIGHTS\[move\.id\]/);
  assert.match(source, /tpsContactSpacingMode/);
  assert.match(source, /impactReadabilityFactor/);
  assert.match(source, /tpsImpactReadabilityFactor/);
  assert.match(source, /tpsCloseReadabilityFactor/);
  assert.match(source, /tpsCloseAnchorBlend/);
  assert.match(source, /cameraAnchor\.copy\(this\.p1\.position\)\.lerp\(this\.cameraPairMidpoint/);
  assert.match(source, /lockLift = inStrikeRange \? 0\.62 : 0\.46/);
  assert.match(source, /enemyThreatStatus/);
  assert.match(source, /enemyThreat\.windup/);
  assert.match(source, /enemyThreat\.incoming/);
  assert.match(source, /tps-target-ground-ring/);
});

test("TPS player combat is ATTACK plus directional STEP with range attacks, combos, dash attacks, and flank punishment", async () => {
  const source = await readTpsSource();
  assert.match(source, /TPS_CLOSE_ATTACK_RANGE = 1\.58/);
  assert.match(source, /TPS_STEP_TICKS = 9/);
  assert.match(source, /TPS_STEP_COOLDOWN_TICKS = 18/);
  assert.match(source, /TPS_STEP_DISTANCE_SCALE = 2/);
  assert.match(source, /TPS_PERFECT_EVADE_TICKS = 18/);
  assert.match(source, /playerStepDirection/);
  assert.match(source, /playerStepForwardWeight/);
  assert.match(source, /playerStepSideWeight/);
  assert.match(source, /TPS_STEP_DISTANCE_SCALE - 1/);
  assert.match(source, /playerComboStage/);
  assert.match(source, /playerAttackQueued/);
  assert.match(source, /tpsComboLinkWindow\(activeMove\)/);
  assert.match(source, /chooseTpsComboContinuationRoute/);
  assert.match(source, /tpsComboLinkState = "BUFFERED"/);
  assert.match(source, /tpsComboLinkState = "LINKED"/);
  assert.match(source, /tpsComboLinkBlendSeconds = 0\.075/);
  assert.match(source, /__comboQueuedBranch/);
  assert.match(source, /const comboConfirmed = this\.p1\.hitTargets\.has\(this\.p2\.id\)/);
  assert.match(source, /!comboConfirmed \|\| this\.playerComboStage >= 3/);
  assert.match(source, /resolveContextAttack/);
  assert.match(source, /this\.playerEvadeTicks = TPS_STEP_TICKS/);
  assert.match(source, /this\.playerStepDirection\.copy\(stepVector\)/);
  assert.match(source, /this\.playerStepForwardWeight > 0\.45/);
  assert.match(source, /beginDashAttack\(toEnemy\)/);
  assert.match(source, /beginMove\("dashKick"\)/);
  assert.match(source, /playerFlankWindowTicks/);
  assert.match(source, /playerFlankAttackTicks/);
  assert.match(source, /directionalStepBonus/);
  assert.match(source, /flankLaneShift/);
  assert.match(source, /PERFECT STEP/);
  assert.match(source, /SIDE STEP/);
  assert.match(source, /playerStepThreatTicks/);
  assert.match(source, /const reactiveSideStep = Boolean/);
  assert.match(source, /incomingDistance <= incomingMove\.reach \+ 0\.9/);
  assert.match(source, /TPS_STEP_TICKS \+ TPS_FLANK_WINDOW_TICKS/);
  assert.match(source, /Math\.max\(this\.playerFlankWindowTicks, TPS_FLANK_WINDOW_TICKS\)/);
  assert.match(source, /TPS_PERFECT_EVADE_TICKS \+ this\.p1Dna\.perfectEvadeBonusTicks/);
  assert.match(source, /const trackedSideEvade/);
  assert.match(source, /const interceptStrike = attacker === this\.p1/);
  assert.match(source, /&& !reversalStrike && !interceptStrike/);
  assert.match(source, /distance > move\.reach \+ 0\.72/);
  assert.match(source, /applyAttackStepIn\(this\.p1, this\.p2\)/);
  assert.match(source, /enemyTactic/);
  assert.match(source, /enemyOpeningGraceTicks = 132/);
  assert.match(source, /ENEMY_TRACK_RATE = 0\.16/);
  assert.match(source, /ENEMY_SIDE_STEP_TRACK_RATE = 0\.06/);
  assert.match(source, /ENEMY_SPACING_DEAD_ZONE = 0\.30/);
  assert.match(source, /ENEMY_ORBIT_ACTIVE_TICKS = 28/);
  assert.match(source, /ENEMY_ATTACK_ALIGNMENT = 0\.82/);
  assert.match(source, /enemyVisualForward/);
  assert.match(source, /desiredDistance = game\.enemyTactic === "PRESSURE"/);
  assert.match(source, /game\.p2\.state = "IDLE"/);
});

test("TPS enemy decisions use the shared player-fun director without losing circular movement", async () => {
  const source = await readTpsSource();
  assert.match(source, /new CpuFunDirector\(this\.difficulty, 47\)/);
  assert.match(source, /this\.enemyFunDirector\.observe\(situation\(\)\)/);
  assert.match(source, /this\.enemyFunDirector\.decide\(situation\(\)\)/);
  assert.match(source, /tpsCpuDirectorPolicy = "FUN_DIRECTOR_V1"/);
  assert.match(source, /tpsCpuDirectorReason/);
  assert.match(source, /tpsCpuDirectorComebackMercy/);
  assert.match(source, /tpsCpuDirectorTelegraphTicks/);
  assert.match(source, /directorIntent === "APPROACH"/);
  assert.match(source, /directorIntent === "RETREAT"/);
  assert.match(source, /directorIntent === "SIDESTEP"/);
  assert.match(source, /game\.p2\.currentMove\.id !== directorMove/);
});

test("TPS result records a visible winner instead of a zero-zero duel score", async () => {
  const source = await readFile(new URL("../src/game/tps-game-base.ts", import.meta.url), "utf8");
  assert.match(source, /resultWinner/);
  assert.match(source, /this\.resultWinner = winner/);
  assert.match(source, /p1Wins: this\.finished && this\.resultWinner === "p1" \? 1 : 0/);
  assert.match(source, /p2Wins: this\.finished && this\.resultWinner === "p2" \? 1 : 0/);
});

test("TPS main UI exposes exactly ATTACK and STEP with no legacy duel route", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /TPS_MATCH/);
  assert.doesNotMatch(page, /TPS LOCK-ON BATTLE/);
  assert.match(page, /tps-two-button-actions/);
  assert.match(page, /"guard", "Step", tpsIncoming \? "STEP NOW" : tpsWindup \? "READY" : "STEP"/);
  assert.match(page, /"punch", "Attack", tpsPunish \? "PUNISH" : tpsIntercept \? "INTERCEPT" : "ATTACK"/);
  assert.match(page, /AUTO PUNCH \/ KICK/);
  assert.match(page, /STEP OR INTERCEPT/);
  assert.match(page, /PERFECT STEP/);
  assert.match(page, /→ REVERSAL/);
  assert.match(page, /tpsWindup/);
  assert.match(page, /tpsPunish/);
  assert.match(page, /tps-threat-action/);
  assert.match(page, /tps-windup-action/);
  assert.match(page, /tps-punish-action/);
  assert.match(page, /WINDUP/);
  assert.match(page, /FORWARD STEP → ATTACK = DASH/);
  assert.doesNotMatch(page, /G\+K/);
  assert.doesNotMatch(page, /G\+P/);
  assert.doesNotMatch(page, /P\+K/);
  assert.match(page, /setScreen\("TPS_MATCH"\)/);
  assert.doesNotMatch(page, /battleMode/);
  assert.doesNotMatch(page, /setScreen\("MATCH"\)/);
});


test("TPS KO presentation waits for the defeated fighter to land before RESULT", async () => {
  const source = await readFile(new URL("../src/game/tps-game-base.ts", import.meta.url), "utf8");
  assert.match(source, /TPS_KO_MIN_SHOW_TICKS = 72/);
  assert.match(source, /TPS_KO_SETTLED_HOLD_TICKS = 30/);
  assert.match(source, /finishPending/);
  assert.match(source, /this\.p1\.updatePhysics\(FIXED_STEP\)/);
  assert.match(source, /this\.p2\.updatePhysics\(FIXED_STEP\)/);
  assert.match(source, /defeated\.grounded/);
  assert.match(source, /this\.finishSettledTicks >= TPS_KO_SETTLED_HOLD_TICKS/);
  assert.match(source, /this\.options\.onResult\?\.\(winner\)/);
  assert.doesNotMatch(source, /setTimeout\(\(\) => this\.options\.onResult/);
});

test("TPS messages use a face-safe HUD lane and RESULT removes live fight controls", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/hud-face-safe.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /tpsComboMessage/);
  assert.match(page, /tpsKoMessage/);
  assert.match(page, /tpsFaceSafeMessage/);
  assert.match(page, /Boolean\(hud\?\.message\)/);
  assert.match(page, /tps-face-safe-badge/);
  assert.match(page, /tps-combo-badge/);
  assert.match(page, /tps-ko-badge/);
  assert.match(page, /const isGameSurface = screen === "TPS_MATCH";/);
  assert.match(page, /tps-face-safe-active/);
  assert.match(css, /\.tps-badge\.tps-face-safe-badge/);
  assert.match(css, /\.tps-badge\.tps-combo-badge/);
  assert.match(css, /\.tps-badge\.tps-ko-badge/);
  assert.match(css, /left: max\(24px/);
  assert.match(css, /transform: none/);
  assert.match(css, /\.tps-face-safe-active \.round-readout small/);
});


test("TPS reactive two-button HUD makes threat, windup, and punish turns explicit", async () => {
  const [source, page, css] = await Promise.all([
    readFile(new URL("../src/game/tps-game-base.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/playtest-polish.css", import.meta.url), "utf8"),
  ]);
  assert.match(source, /enemyThreatStatus/);
  assert.match(source, /enemyDirectorPendingMove !== null/);
  assert.match(source, /canStillHit/);
  assert.match(source, /inThreatReach/);
  assert.match(source, /"WINDUP"/);
  assert.match(page, /hud\?\.message === "WINDUP"/);
  assert.match(page, /\["PERFECT STEP", "FLANK OPEN", "REVERSAL"\]/);
  assert.match(page, /tpsIncoming \? "STEP NOW" : tpsWindup \? "READY" : "STEP"/);
  assert.match(page, /tpsPunish \? "PUNISH" : tpsIntercept \? "INTERCEPT" : "ATTACK"/);
  assert.match(css, /tps-step-action\.tps-threat-action/);
  assert.match(css, /tps-attack-action\.tps-punish-action/);
});


test("TPS Combat v2 adds intercepts, reversals, adaptive personas, reaction grading, and final impact", async () => {
  const [source, page, css] = await Promise.all([
    readFile(new URL("../src/game/tps-game-base.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/playtest-polish.css", import.meta.url), "utf8"),
  ]);
  assert.match(source, /TPS_INTERCEPT_TICKS = 26/);
  assert.match(source, /TPS_REVERSAL_TICKS = 24/);
  assert.match(source, /playerInterceptTicks/);
  assert.match(source, /playerReversalTicks/);
  assert.match(source, /setCombatBeat\("INTERCEPT"\)/);
  assert.match(source, /setCombatBeat\("REVERSAL"\)/);
  assert.match(source, /reversalOpen: reversalStrike/);
  assert.match(source, /defenderWasAttacking/);
  assert.match(source, /counter: defenderWasAttacking \|\| interceptStrike/);
  assert.match(source, /tpsReactionType/);
  assert.match(source, /"FINISHER"/);
  assert.match(source, /setCombatBeat\("FINAL IMPACT"/);
  assert.match(source, /EnemyPersona = "BRAWLER" \| "SKIRMISHER"/);
  assert.match(source, /EnemyAdaptation = "NEUTRAL" \| "ANTI_STEP" \| "ANTI_RUSH"/);
  assert.match(source, /tpsCpuPersona/);
  assert.match(source, /tpsCpuAdaptation/);
  assert.match(source, /adapt-anti-step-counter/);
  assert.match(page, /tpsIntercept/);
  assert.match(page, /tpsIntercept \? "INTERCEPT" : "ATTACK"/);
  assert.match(page, /"PERFECT STEP", "FLANK OPEN", "REVERSAL"/);
  assert.match(page, /"KO", "FINAL IMPACT"/);
  assert.match(css, /tps-intercept-action/);
});

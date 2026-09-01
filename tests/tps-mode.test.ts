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
  assert.match(source, /cameraTarget\.copy\(this\.p2\.position\)/);
  assert.match(source, /closeFactor = THREE\.MathUtils\.clamp/);
  assert.match(source, /aspect < 2\.4 \? 52 : 47/);
  assert.match(source, /compactLandscapeFactor/);
  assert.match(source, /TPS_CAMERA_CLOSE_SHOULDER_BONUS = 1\.95/);
  assert.match(source, /TPS_CAMERA_CLOSE_BACK_BONUS = 0\.24/);
  assert.match(source, /TPS_CAMERA_CLOSE_TARGET_LIFT = 0\.14/);
  assert.match(source, /tpsCloseReadabilityFactor/);
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
  assert.match(source, /const comboConfirmed = this\.p1\.hitTargets\.has\(this\.p2\.id\)/);
  assert.match(source, /!comboConfirmed \|\| this\.playerComboStage >= 3/);
  assert.match(source, /closeMoves = \["jab", "straight", "power"\]/);
  assert.match(source, /farMoves = \["kick", "lowKick", "risingKick"\]/);
  assert.match(source, /distance <= TPS_CLOSE_ATTACK_RANGE \? closeMoves\[stage\] : farMoves\[stage\]/);
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
  assert.match(source, /Math\.max\(this\.playerPerfectEvadeTicks, TPS_PERFECT_EVADE_TICKS\)/);
  assert.match(source, /const trackedSideEvade/);
  assert.match(source, /const flankStrike = attacker === this\.p1/);
  assert.match(source, /&& !flankStrike/);
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
  assert.match(source, /p1Wins: this\.resultWinner === "p1" \? 1 : 0/);
  assert.match(source, /p2Wins: this\.resultWinner === "p2" \? 1 : 0/);
});

test("TPS touch UI exposes exactly ATTACK and STEP while the duel mode keeps legacy controls", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /TPS_MATCH/);
  assert.match(page, /TPS LOCK-ON BATTLE/);
  assert.match(page, /tps-two-button-actions/);
  assert.match(page, /"guard", "Step", "STEP"/);
  assert.match(page, /"punch", "Attack", "ATTACK"/);
  assert.match(page, /AUTO PUNCH \/ KICK/);
  assert.match(page, /TAP COMBO/);
  assert.match(page, /PERFECT STEP/);
  assert.match(page, /SIDE STEP/);
  assert.match(page, /BACK STEP = SPACE/);
  assert.match(page, /FORWARD STEP → ATTACK = DASH/);
  assert.doesNotMatch(page, /G\+K/);
  assert.doesNotMatch(page, /G\+P/);
  assert.doesNotMatch(page, /P\+K/);
  assert.match(page, /battleMode === "TPS" \? "TPS_MATCH" : "MATCH"/);
});

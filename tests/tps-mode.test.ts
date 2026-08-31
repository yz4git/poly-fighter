import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TPS lock-on battle owns circular 360-degree locomotion and over-shoulder camera", async () => {
  const source = await readFile(new URL("../src/game/tps-game.ts", import.meta.url), "utf8");
  assert.match(source, /ARENA_RADIUS = 6\.8/);
  assert.match(source, /new THREE\.CircleGeometry\(ARENA_RADIUS/);
  assert.match(source, /horizontalDirection\(this\.p1\.position, this\.p2\.position\)/);
  assert.match(source, /new THREE\.Vector3\(-toEnemy\.z, 0, toEnemy\.x\)/);
  assert.match(source, /fighter\.visual\.root\.quaternion\.setFromUnitVectors\(MODEL_FORWARD, forward\)/);
  assert.match(source, /cameraTarget\.copy\(this\.p2\.position\)/);
  assert.match(source, /closeFactor = THREE\.MathUtils\.clamp/);
  assert.match(source, /aspect < 2\.4 \? 52 : 47/);
  assert.match(source, /compactLandscapeFactor/);
  assert.match(source, /shoulderOffset = 2\.50 \+ closeFactor \* 1\.70/);
  assert.match(source, /tps-target-ground-ring/);
});

test("TPS player combat is ATTACK plus directional STEP with range attacks, combos, dash attacks, and flank punishment", async () => {
  const source = await readFile(new URL("../src/game/tps-game.ts", import.meta.url), "utf8");
  assert.match(source, /TPS_CLOSE_ATTACK_RANGE = 1\.58/);
  assert.match(source, /TPS_STEP_TICKS = 9/);
  assert.match(source, /TPS_STEP_COOLDOWN_TICKS = 18/);
  assert.match(source, /TPS_PERFECT_EVADE_TICKS = 18/);
  assert.match(source, /playerStepDirection/);
  assert.match(source, /playerStepForwardWeight/);
  assert.match(source, /playerStepSideWeight/);
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
});

test("TPS result records a visible winner instead of a zero-zero duel score", async () => {
  const source = await readFile(new URL("../src/game/tps-game.ts", import.meta.url), "utf8");
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

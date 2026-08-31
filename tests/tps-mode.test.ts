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
  assert.match(source, /backDistance = 5\.65 \+ closeFactor \* 1\.35/);
  assert.match(source, /shoulderOffset = 2\.0 \+ closeFactor \* 1\.15/);
  assert.match(source, /new THREE\.TorusGeometry\(0\.34/);
  assert.match(source, /ARENA_RADIUS \+ 2\.15/);
});

test("TPS attacks reuse fighter move data while resolving radial range, knockback, and defender guard", async () => {
  const source = await readFile(new URL("../src/game/tps-game.ts", import.meta.url), "utf8");
  assert.match(source, /beginMove\("power"\)/);
  assert.match(source, /beginMove\(forwardAxis > 0 \? "straight" : "jab"\)/);
  assert.match(source, /beginMove\(sideAxis !== 0 \? "dashKick" : "kick"\)/);
  assert.match(source, /distance > move\.reach \+ 0\.72/);
  assert.match(source, /defender\.velocity\.z = direction\.z \* knockback/);
  assert.match(source, /resolveAttack\(this\.p1, this\.p2, this\.p2\.state === "GUARD"\)/);
  assert.match(source, /resolveAttack\(this\.p2, this\.p1, this\.p1\.state === "GUARD"\)/);
  assert.match(source, /applyAttackStepIn\(this\.p1, this\.p2\)/);
  assert.match(source, /moveSpeed \* 0\.42/);
  assert.match(source, /fighter\.visual\.aura\.visible = false/);
  assert.match(source, /playerEvadeTicks = 9/);
  assert.match(source, /playerEvadeCooldown = 32/);
  assert.match(source, /defender === this\.p1 && this\.playerEvadeTicks > 3/);
  assert.match(source, /move\.hitLevel !== "THROW"/);
  assert.match(source, /visual\.layout\.ribY/);
  assert.match(source, /threat \? 0xff667f : inStrikeRange \? 0xffd45c/);
});

test("TPS result records a visible winner instead of a zero-zero duel score", async () => {
  const source = await readFile(new URL("../src/game/tps-game.ts", import.meta.url), "utf8");
  assert.match(source, /resultWinner/);
  assert.match(source, /this\.resultWinner = winner/);
  assert.match(source, /p1Wins: this\.resultWinner === "p1" \? 1 : 0/);
  assert.match(source, /p2Wins: this\.resultWinner === "p2" \? 1 : 0/);
});

test("title and result flow expose TPS as an independent mode", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /TPS_MATCH/);
  assert.match(page, /TPS LOCK-ON BATTLE/);
  assert.match(page, /startTpsMatch/);
  assert.match(page, /battleMode === "TPS" \? "TPS_MATCH" : "MATCH"/);
  assert.match(page, /CIRCULAR ARENA/);
  assert.match(page, /GUARD STEP/);
});

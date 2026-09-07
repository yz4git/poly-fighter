from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise RuntimeError(f"missing patch anchor: {label}")
    return source.replace(old, new, 1)


p = Path("src/game/tps-game-base.ts")
s = p.read_text()

s = replace_once(
    s,
    'import { EffectsManager } from "./effects";\n',
    'import { EffectsManager } from "./effects";\nimport { fighterDnaForName, resolveContextAttack, type FighterDna } from "./fighter-dna";\n',
    "fighter dna import",
)
s = replace_once(
    s,
    '  private readonly difficulty: CpuDifficulty;\n',
    '  private readonly difficulty: CpuDifficulty;\n  private readonly p1Dna: FighterDna;\n  private readonly p2Dna: FighterDna;\n',
    "dna fields",
)
s = replace_once(
    s,
    '    this.p1 = new FighterRuntime("p1", options.p1Definition, false, createFighterVisual(options.p1Definition, settings.quality, options.p1Model ?? "ORIGINAL"));\n    this.p2 = new FighterRuntime("p2", options.p2Definition, true, createFighterVisual(options.p2Definition, settings.quality, options.p2Model ?? "ORIGINAL"));\n    this.scene.add(this.p1.visual.root, this.p2.visual.root);\n',
    '    this.p1 = new FighterRuntime("p1", options.p1Definition, false, createFighterVisual(options.p1Definition, settings.quality, options.p1Model ?? "ORIGINAL"));\n    this.p2 = new FighterRuntime("p2", options.p2Definition, true, createFighterVisual(options.p2Definition, settings.quality, options.p2Model ?? "ORIGINAL"));\n    this.p1Dna = fighterDnaForName(this.p1.definition.name);\n    this.p2Dna = fighterDnaForName(this.p2.definition.name);\n    this.scene.add(this.p1.visual.root, this.p2.visual.root);\n',
    "dna constructor",
)
s = replace_once(
    s,
    '    const moveSpeed = this.p1.definition.archetype === "SPEED" ? 4.0 : 3.35;\n',
    '    const moveSpeed = (this.p1.definition.archetype === "SPEED" ? 4.0 : 3.35) * this.p1Dna.moveSpeedScale;\n',
    "player move speed",
)
s = replace_once(
    s,
    '      this.playerEvadeCooldown = TPS_STEP_COOLDOWN_TICKS;\n',
    '      this.playerEvadeCooldown = Math.max(12, Math.round(TPS_STEP_COOLDOWN_TICKS * this.p1Dna.stepCooldownScale));\n',
    "step cooldown",
)
s = replace_once(
    s,
    '        this.playerPerfectEvadeTicks = TPS_STEP_TICKS + TPS_PERFECT_EVADE_TICKS;\n',
    '        this.playerPerfectEvadeTicks = TPS_STEP_TICKS + TPS_PERFECT_EVADE_TICKS + this.p1Dna.perfectEvadeBonusTicks;\n',
    "reactive perfect step",
)
s = replace_once(
    s,
    '      const stepMultiplier = baseStepMultiplier + directionalStepBonus;\n',
    '      const stepMultiplier = (baseStepMultiplier + directionalStepBonus) * this.p1Dna.stepSpeedScale;\n',
    "step speed",
)
s = replace_once(
    s,
    '      this.playerPerfectEvadeTicks = Math.max(this.playerPerfectEvadeTicks, TPS_PERFECT_EVADE_TICKS);\n',
    '      this.playerPerfectEvadeTicks = Math.max(this.playerPerfectEvadeTicks, TPS_PERFECT_EVADE_TICKS + this.p1Dna.perfectEvadeBonusTicks);\n',
    "resolved perfect step",
)

start = s.index('  private beginContextAttack(): boolean {')
end = s.index('  private beginDashAttack(', start)
replacement = '''  private beginContextAttack(): boolean {
    if (!this.p1.canAct()) return false;
    const distance = Math.hypot(this.p2.position.x - this.p1.position.x, this.p2.position.z - this.p1.position.z);
    const stage = Math.min(2, this.playerComboStage);
    const reversalStrike = this.playerReversalTicks > 0 && this.playerStepSideWeight > 0.45;
    const flankStrike = this.playerFlankWindowTicks > 0 && this.playerStepSideWeight > 0.45;
    const interceptStrike = this.playerInterceptTicks > 0;
    const defenderNearWall = Math.hypot(this.p2.position.x, this.p2.position.z) >= ARENA_RADIUS - 1.35;
    const choice = resolveContextAttack({
      fighterName: this.p1.definition.name,
      distance,
      comboStage: stage,
      flankOpen: flankStrike,
      reversalOpen: reversalStrike,
      interceptOpen: interceptStrike,
      defenderAttacking: this.p2.state === "ATTACK",
      defenderNearWall,
      selfHealth: this.p1.health,
      defenderHealth: this.p2.health,
    });
    if (!this.p1.beginMove(choice.moveId)) return false;
    this.playerComboStage = reversalStrike ? 1 : stage + 1;
    this.playerComboGraceTicks = TPS_COMBO_GRACE_TICKS;
    this.p1.visual.root.userData.tpsFighterDna = this.p1Dna.id;
    this.p1.visual.root.userData.tpsContextMove = choice.moveId;
    this.p1.visual.root.userData.tpsSignatureAction = choice.signature;
    this.p1.visual.root.userData.tpsContextBeat = choice.beat;
    if (choice.beat) this.setCombatBeat(choice.beat);
    if (reversalStrike) this.playerReversalTicks = 0;
    if (flankStrike) {
      this.playerFlankAttackTicks = 28;
      this.playerFlankWindowTicks = 0;
    }
    return true;
  }

'''
s = s[:start] + replacement + s[end:]

s = replace_once(
    s,
    '      const baseSpeed = this.p2.definition.archetype === "SPEED" ? 3.45 : 2.95;\n',
    '      const baseSpeed = (this.p2.definition.archetype === "SPEED" ? 3.45 : 2.95) * this.p2Dna.moveSpeedScale;\n',
    "cpu move speed",
)
s = replace_once(
    s,
    '    const damageScale = interceptStrike ? 1.22 : reversalStrike ? 1.18 : defenderWasAttacking ? 1.12 : 1;\n',
    '    const damageScale = interceptStrike\n      ? 1.22 * this.p1Dna.interceptDamageScale\n      : reversalStrike\n        ? 1.18 * this.p1Dna.reversalDamageScale\n        : defenderWasAttacking ? 1.12 : 1;\n',
    "dna damage scaling",
)
old = '''    if (interceptStrike) {
      this.playerInterceptTicks = 0;
      this.enemyDirectorPendingMove = null;
      this.enemyDirectorTelegraphTicks = 0;
      this.enemyDirectorDecision = null;
      this.enemyDirectorHoldTicks = Math.max(this.enemyDirectorHoldTicks, 12);
      this.setCombatBeat("INTERCEPT");
    } else if (reversalStrike) {
      this.setCombatBeat("REVERSAL");
    } else if (defenderWasAttacking && !blocked) {
      this.setCombatBeat("COUNTER HIT");
    }

    const reactionType = lethalImpact ? "FINISHER" : interceptStrike ? "INTERCEPT" : reversalStrike ? "REVERSAL" : defenderWasAttacking ? "COUNTER" : blocked ? "BLOCK" : move.power >= 1.45 ? "HEAVY" : "NORMAL";
    defender.visual.root.userData.tpsReactionType = reactionType;
    defender.visual.root.userData.tpsReactionStrength = reactionStrength;
    defender.visual.root.userData.tpsReactionDirectionX = direction.x;
    defender.visual.root.userData.tpsReactionDirectionZ = direction.z;
    defender.visual.root.userData.tpsReactionTick = this.simulationTicks;
'''
new = '''    if (interceptStrike) {
      this.playerInterceptTicks = 0;
      this.enemyDirectorPendingMove = null;
      this.enemyDirectorTelegraphTicks = 0;
      this.enemyDirectorDecision = null;
      this.enemyDirectorHoldTicks = Math.max(this.enemyDirectorHoldTicks, 12);
      this.setCombatBeat(this.p1Dna.signature.intercept);
    } else if (reversalStrike) {
      this.setCombatBeat(this.p1Dna.signature.reversal);
    } else if (defenderWasAttacking && !blocked) {
      this.setCombatBeat("COUNTER HIT");
    }

    const reactionType = lethalImpact ? "FINISHER" : interceptStrike ? "INTERCEPT" : reversalStrike ? "REVERSAL" : defenderWasAttacking ? "COUNTER" : blocked ? "BLOCK" : move.power >= 1.45 ? "HEAVY" : "NORMAL";
    const reactionRegion = move.reactionTarget ?? (move.hitLevel === "LOW" ? "LEGS" : "BODY");
    const reactionVariant = (this.simulationTicks + move.id.length * 3 + (attacker === this.p1 ? 0 : 1)) % 3;
    const impactPairStrength = THREE.MathUtils.clamp(reactionStrength * (lethalImpact ? 1.18 : 1), 0.7, 1.9);
    attacker.visual.root.userData.tpsImpactPairRole = "ATTACKER";
    attacker.visual.root.userData.tpsImpactPairTick = this.simulationTicks;
    attacker.visual.root.userData.tpsImpactPairMove = move.id;
    attacker.visual.root.userData.tpsImpactPairStrength = impactPairStrength;
    attacker.visual.root.userData.tpsImpactPairContact = [impactPosition.x, impactPosition.y, impactPosition.z];
    defender.visual.root.userData.tpsImpactPairRole = "DEFENDER";
    defender.visual.root.userData.tpsImpactPairTick = this.simulationTicks;
    defender.visual.root.userData.tpsImpactPairMove = move.id;
    defender.visual.root.userData.tpsImpactPairStrength = impactPairStrength;
    defender.visual.root.userData.tpsImpactPairContact = [impactPosition.x, impactPosition.y, impactPosition.z];
    defender.visual.root.userData.tpsReactionType = reactionType;
    defender.visual.root.userData.tpsReactionRegion = reactionRegion;
    defender.visual.root.userData.tpsReactionVariant = reactionVariant;
    defender.visual.root.userData.tpsReactionStrength = reactionStrength;
    defender.visual.root.userData.tpsReactionDirectionX = direction.x;
    defender.visual.root.userData.tpsReactionDirectionZ = direction.z;
    defender.visual.root.userData.tpsReactionTick = this.simulationTicks;
'''
s = replace_once(s, old, new, "impact pair and reaction matrix")
s = replace_once(
    s,
    '    fighter.visual.root.userData.combatTps = true;\n    fighter.visual.root.userData.combatMotionForward = forward.toArray();\n',
    '    fighter.visual.root.userData.combatTps = true;\n    fighter.visual.root.userData.tpsFighterDna = fighter === this.p1 ? this.p1Dna.id : this.p2Dna.id;\n    fighter.visual.root.userData.combatMotionForward = forward.toArray();\n',
    "dna telemetry",
)
p.write_text(s)

p = Path("src/game/fighter.ts")
s = p.read_text()
old = '''      const hitSample = sampleQuaterniusMotion("Hit_Chest", hitPhase);
      const hitHead = quaterniusMotionDelta("Hit_Chest", hitPhase, "head");
      visual.rig.bones.spineUpper.rotation.z = -0.18 + hitHead[0] * 1.35;
      visual.rig.bones.spineUpper.rotation.x += -hitHead[2] * 1.20;
      visual.head.rotation.z = 0.18 + hitHead[0] * 1.45;
      visual.leftArm.root.rotation.z = -0.42;
      visual.rightArm.root.rotation.z = 0.42;
'''
new = '''      const hitSample = sampleQuaterniusMotion("Hit_Chest", hitPhase);
      const hitHead = quaterniusMotionDelta("Hit_Chest", hitPhase, "head");
      const reactionStrength = THREE.MathUtils.clamp(Number(visual.root.userData.tpsReactionStrength ?? 1), 0.72, 1.9);
      const reactionVariant = Number(visual.root.userData.tpsReactionVariant ?? 0) % 3;
      const reactionRegion = String(visual.root.userData.tpsReactionRegion ?? "BODY");
      const reactionType = String(visual.root.userData.tpsReactionType ?? "NORMAL");
      const variantLean = reactionVariant === 0 ? -0.055 : reactionVariant === 1 ? 0.035 : 0.075;
      const headScale = reactionRegion === "HEAD" ? 1.26 : reactionRegion === "LEGS" ? 0.72 : 1;
      const bodyScale = reactionRegion === "BODY" ? 1.18 : reactionRegion === "LEGS" ? 0.82 : 1;
      const counterTwist = ["COUNTER", "INTERCEPT", "REVERSAL", "FINISHER"].includes(reactionType) ? 0.10 : 0;
      visual.rig.bones.spineUpper.rotation.z = (-0.18 + hitHead[0] * 1.35 + variantLean - counterTwist) * reactionStrength * bodyScale;
      visual.rig.bones.spineUpper.rotation.x += -hitHead[2] * 1.20 * reactionStrength * bodyScale;
      visual.head.rotation.z = (0.18 + hitHead[0] * 1.45 - variantLean) * reactionStrength * headScale;
      visual.leftArm.root.rotation.z = -0.42 * reactionStrength;
      visual.rightArm.root.rotation.z = 0.42 * reactionStrength;
      if (reactionRegion === "LEGS") {
        visual.hips.position.y -= 0.035 * reactionStrength;
        visual.leftLeg.root.rotation.z -= 0.12 * reactionStrength;
        visual.rightLeg.root.rotation.z += 0.12 * reactionStrength;
      }
'''
s = replace_once(s, old, new, "reaction matrix presentation")
p.write_text(s)

Path("tests/tps-rival-core.test.ts").write_text('''import assert from "node:assert/strict";
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
''')

p = Path("tests/tps-mode.test.ts")
s = p.read_text()
s = s.replace('  assert.match(source, /closeMoves = \\["jab", "straight", "power"\\]/);\n', '')
s = s.replace('  assert.match(source, /farMoves = \\["kick", "lowKick", "risingKick"\\]/);\n', '')
s = s.replace('  assert.match(source, /distance <= TPS_CLOSE_ATTACK_RANGE \\? closeMoves\\[stage\\] : farMoves\\[stage\\]/);\n', '  assert.match(source, /resolveContextAttack/);\n')
s = s.replace('  assert.match(source, /Math\\.max\\(this\\.playerPerfectEvadeTicks, TPS_PERFECT_EVADE_TICKS\\)/);\n', '  assert.match(source, /TPS_PERFECT_EVADE_TICKS \\+ this\\.p1Dna\\.perfectEvadeBonusTicks/);\n')
s = s.replace('  assert.match(source, /moveId = reversalStrike \\? "counter"/);\n', '  assert.match(source, /reversalOpen: reversalStrike/);\n')
p.write_text(s)

print("Rival Core phase 1-3 patch applied")

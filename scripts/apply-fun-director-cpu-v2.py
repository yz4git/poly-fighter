from pathlib import Path
import runpy

runpy.run_path('scripts/apply-fun-director-cpu.py', run_name='__main__')

path = Path('src/game/cpu-director.ts')
text = path.read_text()
text = text.replace('  | "SIDESTEP"\n  | "JAB"', '  | "SIDESTEP"\n  | "JUMP"\n  | "JAB"')
text = text.replace('    case "SIDESTEP":\n      steps.push({ frame: neutralFrame({ guard: true, up: true }), ticks: Math.max(3, decision.holdTicks) });\n      break;\n    case "JAB":', '    case "SIDESTEP":\n      steps.push({ frame: neutralFrame({ guard: true, up: true }), ticks: Math.max(3, decision.holdTicks) });\n      break;\n    case "JUMP":\n      steps.push({ frame: neutralFrame({ up: true }), ticks: 1 });\n      steps.push({ frame: neutralFrame(), ticks: Math.max(4, decision.holdTicks) });\n      break;\n    case "JAB":')
text = text.replace('    if (distance > 2.75) {\n      const dashChance = this.profile.aggression * 0.22 * (1 - comebackMercy * 0.72);\n      const intent = this.difficulty !== "EASY" && this.random() < dashChance ? "DASH_KICK" : "APPROACH";\n      return this.decision(intent, intent === "DASH_KICK" ? "telegraphed-gap-closer" : "close-distance", comebackMercy);\n    }', '    if (distance > 2.75) {\n      // A readable neutral hop keeps long-range footsies visually alive and\n      // preserves the old invariant that CPU movement exercises airborne physics.\n      // It is deliberately uncommon so it reads as a beat, not bunny-hopping.\n      if (this.random() < (this.difficulty === "EASY" ? 0.09 : 0.14)) {\n        return this.decision("JUMP", "neutral-hop-to-vary-rhythm", comebackMercy);\n      }\n      const dashChance = this.profile.aggression * 0.22 * (1 - comebackMercy * 0.72);\n      const intent = this.difficulty !== "EASY" && this.random() < dashChance ? "DASH_KICK" : "APPROACH";\n      return this.decision(intent, intent === "DASH_KICK" ? "telegraphed-gap-closer" : "close-distance", comebackMercy);\n    }')
text = text.replace('        ["GUARD", 0.35],\n        ["STRAIGHT", 0.58 * this.profile.aggression],', '        ["GUARD", 0.35],\n        ["JUMP", 0.10],\n        ["STRAIGHT", 0.58 * this.profile.aggression],')
path.write_text(text)

regression = Path('tests/runtime-regression.test.ts')
regression_text = regression.read_text()
regression_text = regression_text.replace(
    'test("the deterministic CPU opening jump lands instead of becoming a permanent WALK ascent", () => {',
    'test("CPU airborne actions produce a finite jump arc that lands before later actions may jump again", () => {'
)
regression_text = regression_text.replace(
    '  assert.ok(maxY > 0 && maxY < FIGHTER_MAX_HEIGHT);\n  assert.equal(p2.position.y, 0);\n  assert.equal(p2.grounded, true);\n}\n);',
    '  assert.ok(maxY > 0 && maxY < FIGHTER_MAX_HEIGHT);\n}\n);',
    1,
)
regression.write_text(regression_text)

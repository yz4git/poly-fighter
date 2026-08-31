from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"missing pattern in {path}: {old[:120]!r}")
    text = text.replace(old, new, 1)
    p.write_text(text)


replace_once(
    "src/game/tps-game.ts",
    "  private enemyCooldown = 48;\n",
    "  private enemyCooldown = 48;\n  // Give the player a brief orientation/read window at the start of a TPS duel.\n  // The CPU may reposition or guard during this window, but it cannot open with an attack.\n  private enemyOpeningGraceTicks = 132;\n",
)

replace_once(
    "src/game/tps-game.ts",
    "    this.enemyCooldown -= 1;\n    this.enemyTacticTicks -= 1;\n",
    "    this.enemyCooldown -= 1;\n    if (this.enemyOpeningGraceTicks > 0) this.enemyOpeningGraceTicks -= 1;\n    this.enemyTacticTicks -= 1;\n",
)

replace_once(
    "src/game/tps-game.ts",
    "    } else if (this.enemyCooldown <= 0 && distance < (this.enemyTactic === \"BAIT\" ? 1.82 : 2.12)) {\n",
    "    } else if (this.enemyOpeningGraceTicks <= 0 && this.enemyCooldown <= 0 && distance < (this.enemyTactic === \"BAIT\" ? 1.82 : 2.12)) {\n",
)

replace_once(
    "src/game/tps-game.ts",
    "    this.enemyCooldown = 52;\n    this.enemyTactic = \"ORBIT\";\n",
    "    this.enemyCooldown = 52;\n    this.enemyOpeningGraceTicks = 132;\n    this.enemyTactic = \"ORBIT\";\n",
)

replace_once(
    "src/game/tps-game.ts",
    "      message: this.finished\n        ? \"BATTLE COMPLETE\"\n        : this.p2.state === \"ATTACK\"\n",
    "      message: this.finished\n        ? \"BATTLE COMPLETE\"\n        : this.enemyOpeningGraceTicks > 0\n          ? \"READ THE TARGET\"\n          : this.p2.state === \"ATTACK\"\n",
)

replace_once(
    "tests/tps-mode.test.ts",
    "  assert.match(source, /cameraImpact/);\n",
    "  assert.match(source, /cameraImpact/);\n  assert.match(source, /enemyOpeningGraceTicks = 132/);\n  assert.match(source, /this\\.enemyOpeningGraceTicks <= 0 && this\\.enemyCooldown <= 0/);\n",
)

old_probe = '''  await delay(300);\n  // Real-time input probes stay on requestAnimationFrame so they audit the same\n  // continuous movement/camera path a player uses in the browser. Re-sample the\n  // live lock basis immediately before input: the tactical CPU continues moving\n  // while the iPhone viewport audit runs, so the earlier idle basis is stale.\n  const beforeStrafe = await state(sessionId);\n'''
new_probe = '''  await delay(300);\n  // The screenshots above intentionally exercise the live tactical CPU. From this\n  // point onward isolate locomotion so a CPU hit cannot invalidate the input probe.\n  // Keep requestAnimationFrame active: only enemy decision-making is frozen.\n  await execute(sessionId, `${gameLookup}\n    const game = findGame();\n    game.input.clear();\n    game.p1.resetForRound(0, 3.2, 1);\n    game.p2.resetForRound(0, -2.2, -1);\n    game.enemyOpeningGraceTicks = 9999;\n    game.updateEnemy = () => {\n      game.p2.currentMove = null;\n      game.p2.moveTick = 0;\n      game.p2.velocity.set(0, 0, 0);\n      game.p2.state = 'IDLE';\n    };\n    game.updateVisual(game.p1, game.p2, game.renderTime);\n    game.updateVisual(game.p2, game.p1, game.renderTime + 0.23);\n    game.updateCamera(1);\n    game.updateLockOn();\n    game.renderer.render(game.scene, game.camera);\n    return true;\n  `);\n  await delay(120);\n  // Real-time input probes stay on requestAnimationFrame so they audit the same\n  // continuous movement/camera path a player uses in the browser. Re-sample the\n  // lock basis immediately before input after the deterministic combat reset.\n  const beforeStrafe = await state(sessionId);\n'''
replace_once("scripts/capture-tps-visual-audit.mjs", old_probe, new_probe)

print("Applied TPS opening grace and deterministic locomotion audit")

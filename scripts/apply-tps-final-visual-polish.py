from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"missing pattern in {path}: {old[:160]!r}")
    p.write_text(text.replace(old, new, 1))


replace_once(
    "src/game/tps-game.ts",
    '''    this.camera.aspect = width / height;\n    this.camera.updateProjectionMatrix();\n    this.renderer.setSize(width, height, false);\n''',
    '''    const aspect = width / height;\n    this.camera.aspect = aspect;\n    // iPhone landscape has much less vertical room than the wide desktop audit.\n    // A slightly wider lens keeps both fighters readable without shrinking touch UI.\n    this.camera.fov = width > height && aspect < 2.4 ? 52 : 47;\n    this.camera.updateProjectionMatrix();\n    this.renderer.setSize(width, height, false);\n''',
)

replace_once(
    "src/game/tps-game.ts",
    '''    const closeFactor = THREE.MathUtils.clamp((2.6 - fightDistance) / 1.7, 0, 1);\n    // Open a screen-space lane to the opponent at contact by widening laterally.\n    const backDistance = 4.85 - closeFactor * 0.45;\n    const shoulderOffset = 2.2 + closeFactor * 1.25;\n    const cameraHeight = 2.28 + closeFactor * 0.17;\n''',
    '''    const closeFactor = THREE.MathUtils.clamp((2.6 - fightDistance) / 1.7, 0, 1);\n    const compactLandscapeFactor = THREE.MathUtils.clamp((2.45 - this.camera.aspect) / 0.45, 0, 1);\n    // Open a screen-space lane to the opponent at contact by widening laterally.\n    // Compact iPhone landscape gets extra shoulder separation because the player\n    // silhouette otherwise covers the opponent at melee distance.\n    const backDistance = 4.85 - closeFactor * 0.45 + compactLandscapeFactor * 0.30;\n    const shoulderOffset = 2.2 + closeFactor * 1.25 + compactLandscapeFactor * (0.55 + closeFactor * 0.55);\n    const cameraHeight = 2.28 + closeFactor * 0.17 + compactLandscapeFactor * 0.04;\n''',
)

replace_once(
    "src/game/fighter.ts",
    '''    } else if (state === "SIDESTEP") {\n      visual.torso.rotation.y = Math.sin(timeSeconds * 16) * 0.12;\n      visual.leftLeg.root.rotation.z = 0.24;\n      visual.rightLeg.root.rotation.z = -0.24;\n''',
    '''    } else if (state === "SIDESTEP") {\n      visual.torso.rotation.y = Math.sin(timeSeconds * 16) * 0.10;\n      // Keep the evasive silhouette but avoid lifting both soles visibly off the\n      // floor when TPS translates the grounded fighter laterally.\n      visual.hips.position.y -= 0.045;\n      visual.leftLeg.root.rotation.z = 0.14;\n      visual.rightLeg.root.rotation.z = -0.14;\n''',
)

replace_once(
    "tests/tps-mode.test.ts",
    '''  assert.match(source, /new THREE\\.PerspectiveCamera\\(47/);\n''',
    '''  assert.match(source, /new THREE\\.PerspectiveCamera\\(47/);\n  assert.match(source, /aspect < 2\\.4 \\? 52 : 47/);\n  assert.match(source, /compactLandscapeFactor/);\n''',
)

print("Applied TPS final visual polish")

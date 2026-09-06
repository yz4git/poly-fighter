from pathlib import Path

FOLLOWERS = [
    Path("src/game/quaternius-character-graphics-v2.ts"),
    Path("src/game/quaternius-graphics-polish.ts"),
]

old = "    mesh.quaternion.copy(poseDelta).multiply(authoredRestRotation);\n  };"
new = "    mesh.quaternion.copy(poseDelta).multiply(authoredRestRotation);\n    // onBeforeRender runs after Three.js has already propagated matrixWorld.\n    // Refresh this follower immediately so fast kicks never render one pose behind.\n    mesh.updateMatrixWorld(true);\n  };"

for path in FOLLOWERS:
    source = path.read_text()
    if new in source:
        continue
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one follower sync anchor, found {count}")
    path.write_text(source.replace(old, new, 1))


test_path = Path("tests/quaternius-character-graphics-v2.test.ts")
test_source = test_path.read_text()
marker = 'test("bone followers refresh matrixWorld in the render callback", async () => {'
if marker not in test_source:
    test_source += '''\n\ntest("bone followers refresh matrixWorld in the render callback", async () => {\n  for (const relative of [\n    "../src/game/quaternius-character-graphics-v2.ts",\n    "../src/game/quaternius-graphics-polish.ts",\n  ]) {\n    const source = await readFile(new URL(relative, import.meta.url), "utf8");\n    assert.match(\n      source,\n      /mesh\\.quaternion\\.copy\\(poseDelta\\)\\.multiply\\(authoredRestRotation\\);[\\s\\S]{0,260}mesh\\.updateMatrixWorld\\(true\\);/,\n      `${relative}: follower transform must reach matrixWorld in the same rendered frame`,\n    );\n  }\n});\n'''
    test_path.write_text(test_source)

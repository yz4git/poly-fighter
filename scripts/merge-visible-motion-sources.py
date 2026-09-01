from pathlib import Path

runtime_path = Path("src/game/visual-quaternius-runtime.ts")
text = runtime_path.read_text()
old = '''function loadMotion(): Promise<MotionResources> {
  if (motionPromise) return motionPromise;
  motionPromise = new GLTFLoader().loadAsync(QUATERNIUS_PROCEDURAL_CORE_URL).then((gltf) => ({
    source: gltf.scene,
    clips: gltf.animations,
  })).catch((error) => {
    motionPromise = null;
    throw error;
  });
  return motionPromise;
}
'''
new = '''function loadMotion(): Promise<MotionResources> {
  if (motionPromise) return motionPromise;
  const loader = new GLTFLoader();
  motionPromise = Promise.all([
    loader.loadAsync(QUATERNIUS_UAL_CORE_URL),
    loader.loadAsync(QUATERNIUS_PROCEDURAL_CORE_URL),
  ]).then(([base, procedural]) => ({
    // Keep canonical UAL locomotion/state clips and layer Procedural Fight v2
    // combat clips into the same visible fighter runtime.
    source: base.scene,
    clips: [...base.animations, ...procedural.animations],
  })).catch((error) => {
    motionPromise = null;
    throw error;
  });
  return motionPromise;
}
'''
if old not in text:
    raise SystemExit("loadMotion anchor missing")
runtime_path.write_text(text.replace(old, new, 1))

path = Path("tests/quaternius-model-skin.test.ts")
test = path.read_text()
anchor = '  assert.match(runtime, /loadAsync\\(QUATERNIUS_PROCEDURAL_CORE_URL\\)/);\n'
replacement = (
    '  assert.match(runtime, /loadAsync\\(QUATERNIUS_UAL_CORE_URL\\)/);\n'
    '  assert.match(runtime, /loadAsync\\(QUATERNIUS_PROCEDURAL_CORE_URL\\)/);\n'
    '  assert.match(runtime, /clips: \\[\\.\\.\\.base\\.animations, \\.\\.\\.procedural\\.animations\\]/);\n'
)
if anchor not in test:
    raise SystemExit("model-skin test anchor missing")
path.write_text(test.replace(anchor, replacement, 1))

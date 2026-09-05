from pathlib import Path

path = Path('tests/motion-foundry-v6-leg-anatomy-v62.test.mjs')
text = path.read_text()
text = text.replace(
    "  assert.match(kicks, /for frame in range\\(start_frame, end_frame \\+ 1\\):/);",
    "  assert.match(kicks, /frames = list\\(range\\(start_frame, end_frame \\+ 1\\)\\)/);",
)
path.write_text(text)
print('updated V6.6 dense-frame static contract')

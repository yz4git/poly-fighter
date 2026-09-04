#!/usr/bin/env python3
from pathlib import Path

path = Path('tools/blender/build-fight-motion-foundry-v2-kicks.py')
text = path.read_text()
old = '(1.0 if spec.strike_suffix == "l" else -1.0)'
new = '(-1.0 if spec.strike_suffix == "l" else 1.0)'
count = text.count(old)
if count != 2:
    raise SystemExit(f'expected two outward sign expressions, found {count}')
text = text.replace(old, new)
path.write_text(text)

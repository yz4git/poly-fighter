#!/usr/bin/env python3
from pathlib import Path

path = Path('tools/blender/build-fight-motion-foundry-v2-kicks.py')
text = path.read_text()
old = '                max(spec.ik_influences[1], 0.52),\n'
new = '                max(spec.ik_influences[1], 0.66 if spec.action_name == "BF_RisingKick_R" else 0.52),\n'
if new in text:
    raise SystemExit('V6 rising chamber shaping is already applied')
if text.count(old) != 1:
    raise SystemExit(f'expected exactly one V6 load IK line, found {text.count(old)}')
text = text.replace(old, new, 1)
path.write_text(text)

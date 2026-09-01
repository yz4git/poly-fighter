from pathlib import Path

helper = Path("scripts/apply-full-body-motion-balance.py")
source = helper.read_text()
old = "('torso(6, rising ? -15 : dash ? -18 : -11);', 'torso(6, rising ? -8 : dash ? -5 : -6);', 'kick torso envelope')"
new = "('torso(6, rising ? -15 : dash ? -18 : -11, -2);', 'torso(6, rising ? -8 : dash ? -5 : -6, -2);', 'kick torso envelope')"
if old not in source:
    raise SystemExit("kick torso helper target not found")
source = source.replace(old, new, 1)
exec(compile(source, str(helper), "exec"), {"__name__": "__main__"})

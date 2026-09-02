from pathlib import Path
import re

p = Path('scripts/generate-procedural-fight-motions-v3.mjs')
s = p.read_text()
marker = '// KICK_MOTION_V7: chamber -> extension -> re-chamber with support-foot-safe authored curves.'
if marker not in s:
    s = s.replace('const VERSION = "PROCEDURAL_FIGHT_V3";\n', 'const VERSION = "PROCEDURAL_FIGHT_V3";\n' + marker + '\n')

pattern = re.compile(r'''    case "FRONT_KICK":\n    case "RISING_KICK":\n    case "DASH_KICK": \{.*?\n    case "LOW_KICK":.*?\n      break;''', re.S)
replacement = '''    case "FRONT_KICK":
    case "RISING_KICK":
    case "DASH_KICK": {
      const rising = spec.style === "RISING_KICK";
      const dash = spec.style === "DASH_KICK";
      const chamber = Math.max(launch + 0.05, preContact - 0.04);
      const reChamber = Math.min(settle - 0.08, overtravel + 0.09);
      // Keep the planted leg out of the authored curves. Runtime Foot Lock remains
      // the final solve, while the strike leg now reads as chamber -> extension -> recoil.
      torso(4, rising ? -11 : dash ? -7 : -9, rising ? -1 : -2);
      rootDrive(dash ? 0.068 : rising ? 0.028 : 0.040, 0, dash ? 0.012 : 0.028, rising ? 0.014 : dash ? 0.024 : 0.004);
      bones.thigh_r = [
        K(0, R()),
        K(anticipate, R(20, 0, 0), "hold"),
        K(launch, R(-8, 0, 0), "snap"),
        K(chamber, R(rising ? -48 : dash ? -42 : -40, 0, 0), "easeIn"),
        K(impact, R(rising ? -116 : dash ? -94 : -86, 0, 0), "snap"),
        K(overtravel, R(rising ? -120 : dash ? -98 : -90, 0, 0), "easeOut"),
        K(reChamber, R(rising ? -54 : dash ? -48 : -46, 0, 0), "snap"),
        K(settle, R(-18, 0, 0), "easeOut"),
        K(1, R()),
      ];
      bones.calf_r = [
        K(0, R()),
        K(launch, R(18, 0, 0), "easeIn"),
        K(chamber, R(rising ? 74 : dash ? 68 : 70, 0, 0), "snap"),
        K(impact, R(rising ? 3 : 2, 0, 0), "snap"),
        K(overtravel, R(0, 0, 0), "easeOut"),
        K(reChamber, R(rising ? 74 : dash ? 70 : 72, 0, 0), "snap"),
        K(settle, R(26, 0, 0), "easeOut"),
        K(1, R()),
      ];
      bones.foot_r = [
        K(0, R()),
        K(chamber, R(-6, 0, 0), "easeIn"),
        K(impact, R(rising ? 22 : 12, 0, 0), "snap"),
        K(overtravel, R(rising ? 24 : 14, 0, 0), "easeOut"),
        K(reChamber, R(-4, 0, 0), "snap"),
        K(1, R()),
      ];
      bones.upperarm_l = [K(0, R()), K(anticipate, R(-10, 16, -14)), K(chamber, R(-18, 24, -28)), K(impact, R(-30, 30, -40)), K(reChamber, R(-14, 16, -18)), K(1, R())];
      bones.upperarm_r = [K(0, R()), K(anticipate, R(-10, -16, 14)), K(chamber, R(-18, -24, 28)), K(impact, R(-30, -30, 40)), K(reChamber, R(-14, -16, 18)), K(1, R())];
      bones.lowerarm_l = [K(0, R()), K(chamber, R(0, 10, 16)), K(impact, R(0, 5, 10)), K(reChamber, R(0, 12, 18)), K(1, R())];
      bones.lowerarm_r = [K(0, R()), K(chamber, R(0, -10, -16)), K(impact, R(0, -5, -10)), K(reChamber, R(0, -12, -18)), K(1, R())];
      if (dash) {
        bones.thigh_l = [K(0, R()), K(launch, R(10, 0, 0)), K(impact, R(22, 0, 0)), K(reChamber, R(12, 0, 0)), K(1, R())];
        bones.calf_l = [K(0, R()), K(launch, R(-12, 0, 0)), K(impact, R(-30, 0, 0)), K(reChamber, R(-16, 0, 0)), K(1, R())];
      }
      break;
    }
    case "LOW_KICK": {
      const chamber = Math.max(launch + 0.05, preContact - 0.03);
      const reChamber = Math.min(settle - 0.08, overtravel + 0.09);
      // The right support leg is intentionally untouched. Hip rotation, strike-leg
      // chamber/extension and arm counterbalance create the power without foot drift.
      torso(24, -1, 9);
      rootDrive(0.030, 0.018, 0.030);
      bones.thigh_l = [
        K(0, R()),
        K(anticipate, R(18, -10, -2), "hold"),
        K(launch, R(4, -4, 0), "snap"),
        K(chamber, R(-22, 20, -8), "easeIn"),
        K(impact, R(-62, 44, -14), "snap"),
        K(overtravel, R(-66, 47, -16), "easeOut"),
        K(reChamber, R(-28, 22, -9), "snap"),
        K(settle, R(-12, 8, -3), "easeOut"),
        K(1, R()),
      ];
      bones.calf_l = [
        K(0, R()),
        K(launch, R(18, 0, 0), "easeIn"),
        K(chamber, R(66, 0, 0), "snap"),
        K(impact, R(4, 0, 0), "snap"),
        K(overtravel, R(2, 0, 0), "easeOut"),
        K(reChamber, R(64, 0, 0), "snap"),
        K(settle, R(28, 0, 0), "easeOut"),
        K(1, R()),
      ];
      bones.foot_l = [K(0, R()), K(chamber, R(-5, 8, -4)), K(impact, R(2, 18, -12), "snap"), K(overtravel, R(4, 20, -14)), K(reChamber, R(-4, 8, -4), "snap"), K(1, R())];
      bones.upperarm_l = [K(0, R()), K(chamber, R(-14, -18, 22)), K(impact, R(-26, -30, 38)), K(reChamber, R(-12, -14, 18)), K(1, R())];
      bones.upperarm_r = [K(0, R()), K(chamber, R(-14, 18, -22)), K(impact, R(-26, 30, -38)), K(reChamber, R(-12, 14, -18)), K(1, R())];
      bones.lowerarm_l = [K(0, R()), K(chamber, R(0, -8, -14)), K(impact, R(0, -4, -8)), K(reChamber, R(0, -10, -16)), K(1, R())];
      bones.lowerarm_r = [K(0, R()), K(chamber, R(0, 8, 14)), K(impact, R(0, 4, 8)), K(reChamber, R(0, 10, 16)), K(1, R())];
      break;
    }'''
s2, n = pattern.subn(replacement, s, count=1)
if n != 1:
    raise SystemExit(f'kick block replacement count={n}')
p.write_text(s2)
print('patched KICK_MOTION_V7')

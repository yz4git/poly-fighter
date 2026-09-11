# Dash Kick ground-contact presentation

Dash Kick keeps its gameplay move definition, timing, reach, hitboxes and simulation untouched. The TPS presentation layer now preserves one planted support foot from startup through contact and early recovery.

The imported Blender clip still provides the strike-leg and torso motion. A late presentation-only correction samples the last grounded neutral foot pose, solves the support leg back to that floor anchor, translates only the imported visible model by any remaining vertical gap, and then re-solves the strike leg back toward its pre-correction world target.

The kick sequence audit rejects startup/contact/recovery frames where the Dash Kick support foot rises above the grounded ankle band or where both feet are simultaneously airborne.

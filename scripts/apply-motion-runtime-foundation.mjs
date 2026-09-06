import { readFile, writeFile } from "node:fs/promises";

const path = "src/game/visual-quaternius-runtime.ts";
let source = await readFile(path, "utf8");

function replaceOnce(before, after, label) {
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`motion foundation patch: missing ${label}`);
  if (source.indexOf(before, index + before.length) >= 0) throw new Error(`motion foundation patch: duplicate ${label}`);
  source = source.slice(0, index) + after + source.slice(index + before.length);
}

replaceOnce(
  'import { AUTHORED_CONTACT_PHASE, COMBAT_MOTION_VERSION, combatAttackPhase, combatFootCycle, combatStride, LOCOMOTION_DIRECTIONS, locomotionDirection, smoothMotion } from "./combat-motion-clock";',
  'import { COMBAT_MOTION_VERSION, combatFootCycle, combatStride, LOCOMOTION_DIRECTIONS, locomotionDirection, smoothMotion } from "./combat-motion-clock";\nimport { sampleCombatMotionTimeline } from "./combat-motion-timeline";\nimport { retargetMotionClips } from "./motion-retarget";\nexport { retargetMotionClips } from "./motion-retarget";',
  "motion imports",
);

const retargetStart = source.indexOf("export function retargetMotionClips(");
const styleStart = source.indexOf("function styleMaterial", retargetStart);
if (retargetStart < 0 || styleStart < 0) throw new Error("motion foundation patch: retarget implementation block missing");
source = source.slice(0, retargetStart) + source.slice(styleStart);

replaceOnce(
`// The exported V6 mocap clips intentionally retain a readable anticipation arc,
// so their authored IMPACT pose lands around the middle of each clip. Gameplay,
// however, can connect on the first ACTIVE tick. Lock the three grounded V6 kicks
// to their measured impact phase at ACTIVE start, hold only a narrow contact arc
// through ACTIVE, then spend the remaining time on recovery. This keeps hit timing
// unchanged while making the rendered foot and gameplay hitbox agree.
const V6_KICK_CONTACT_PHASE: Readonly<Record<string, number>> = {
  BF_FrontKick_R: 0.5476190476190477,
  BF_LowKick_L: 0.5333333333333333,
  BF_RisingKick_R: 0.5625,
};
`,
  "",
  "duplicate V6 kick timing table",
);

replaceOnce(
`  if (fighter.state === "ATTACK" && move) {
    const impact = AUTHORED_CONTACT_PHASE[runtime.currentClip] ?? .5;
    phase = combatAttackPhase(move, fighter.moveTick, impact);
    runtime.host.userData.combatMotionContactPhase = impact;
    runtime.host.userData.combatMotionSampledPhase = phase;
    if (V6_KICK_CONTACT_PHASE[runtime.currentClip] !== undefined) {
      runtime.host.userData.quaterniusKickTimingPolicy = "V6_ACTIVE_CONTACT_SYNC";
      runtime.host.userData.quaterniusKickSampledPhase = phase;
    }
  } else if (fighter.state === "WALK") phase = runtime.gaitPhase;`,
`  if (fighter.state === "ATTACK" && move) {
    const sample = sampleCombatMotionTimeline(move, fighter.moveTick, runtime.currentClip);
    phase = sample.phase;
    runtime.host.userData.combatMotionTimelinePolicy = "GAMEPLAY_TICK_AUTHORED_EVENT_V1";
    runtime.host.userData.combatMotionTimelineStage = sample.stage;
    runtime.host.userData.combatMotionTimelineStageProgress = sample.stageProgress;
    runtime.host.userData.combatMotionContactPhase = sample.contactPhase;
    runtime.host.userData.combatMotionContactExitPhase = sample.contactExitPhase;
    runtime.host.userData.combatMotionContactWeight = sample.contactWeight;
    runtime.host.userData.combatMotionSampledPhase = phase;
    if (move.animation === "kick") {
      runtime.host.userData.quaterniusKickTimingPolicy = "UNIFIED_COMBAT_TIMELINE";
      runtime.host.userData.quaterniusKickSampledPhase = phase;
    }
  } else if (fighter.state === "WALK") phase = runtime.gaitPhase;`,
  "attack timeline sampling",
);

replaceOnce(
  'visual.root.userData.quaterniusRetargetMode = "rest-delta-separated-sources";',
  'visual.root.userData.quaterniusRetargetMode = "shared-rest-delta-retarget-v1";',
  "retarget policy marker",
);

replaceOnce(
  'fighter.visual.root.userData.combatMotionSingleMixer = true;',
  'fighter.visual.root.userData.combatMotionSingleMixer = true;\n  fighter.visual.root.userData.combatMotionTimelineVersion = "GAMEPLAY_TICK_AUTHORED_EVENT_V1";',
  "single mixer marker",
);

await writeFile(path, source);

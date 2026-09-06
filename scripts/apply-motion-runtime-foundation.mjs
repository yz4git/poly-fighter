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

// Migrate source-string regressions so they guard the new architecture rather
// than requiring the deleted second runtime and duplicate kick clock.
const kickTestPath = "tests/blender-motion-foundry-v2-kicks.test.mjs";
let kickTest = await readFile(kickTestPath, "utf8");
kickTest = kickTest.replace(
  '    "V6_ACTIVE_CONTACT_SYNC",\n  ]) assert.ok(runtime.includes(token), token);',
  '    "UNIFIED_COMBAT_TIMELINE",\n    "sampleCombatMotionTimeline",\n  ]) assert.ok(runtime.includes(token), token);\n  assert.ok(!runtime.includes("V6_KICK_CONTACT_PHASE"), "runtime must not keep a second kick timing table");',
);
await writeFile(kickTestPath, kickTest);

const expansionTestPath = "tests/motion-expansion.test.ts";
let expansionTest = await readFile(expansionTestPath, "utf8");
const expansionStart = expansionTest.indexOf('test("motion runtime uses bounded procedural center-of-mass motion and generated guard/evasion states"');
const expansionEnd = expansionTest.indexOf('test("reaction selection distinguishes head, body, low, heavy and launch impacts"', expansionStart);
if (expansionStart < 0 || expansionEnd < 0) throw new Error("motion foundation patch: old expansion runtime regression block missing");
const architectureTest = `test("production motion runtime has one timeline, one mixer and no legacy second engine", async () => {\n  const runtime = await readFile(new URL("../src/game/visual-quaternius-runtime.ts", import.meta.url), "utf8");\n  const timeline = await readFile(new URL("../src/game/combat-motion-timeline.ts", import.meta.url), "utf8");\n  const retarget = await readFile(new URL("../src/game/motion-retarget.ts", import.meta.url), "utf8");\n  const presentation = await readFile(new URL("../src/game/presentation-animation.ts", import.meta.url), "utf8");\n\n  await assert.rejects(\n    readFile(new URL("../src/game/motion-expansion-runtime.ts", import.meta.url), "utf8"),\n    (error: NodeJS.ErrnoException) => error.code === "ENOENT",\n  );\n  assert.match(runtime, /sampleCombatMotionTimeline\\(move, fighter\\.moveTick, runtime\\.currentClip\\)/);\n  assert.match(runtime, /combatMotionSingleMixer = true/);\n  assert.match(runtime, /GAMEPLAY_TICK_AUTHORED_EVENT_V1/);\n  assert.match(runtime, /from "\\.\\/motion-retarget"/);\n  assert.doesNotMatch(runtime, /V6_KICK_CONTACT_PHASE/);\n  assert.doesNotMatch(runtime, /V6_ACTIVE_CONTACT_SYNC/);\n  assert.doesNotMatch(presentation, /updateMotionExpansionSkin\\(fighter, opponent, timeSeconds\\)/);\n  assert.match(timeline, /AUTHORED_MOTION_EVENTS/);\n  assert.match(timeline, /first ACTIVE tick is exactly contact/i);\n  assert.match(retarget, /targetRest \\* inverse\\(sourceRest\\) \\* sourceAnimated/);\n  assert.match(retarget, /export function retargetMotionClips/);\n});\n\n`;
expansionTest = expansionTest.slice(0, expansionStart) + architectureTest + expansionTest.slice(expansionEnd);
await writeFile(expansionTestPath, expansionTest);

const skinTestPath = "tests/quaternius-model-skin.test.ts";
let skinTest = await readFile(skinTestPath, "utf8");
skinTest = skinTest.replace(
`  const runtime = await readFile(new URL("../src/game/visual-quaternius-runtime.ts", import.meta.url), "utf8");
  assert.doesNotMatch(runtime, /ual2-fight-core\\.glb/);
  assert.doesNotMatch(runtime, /ubc-superhero-male\\.glb[\x60\\"]/);
  assert.match(runtime, /targetRest \\* inverse\\(sourceRest\\) \\* sourceAnimated/);
  assert.match(runtime, /retargetMotionClips/);
  assert.match(runtime, /quaterniusRetargetMode = "rest-delta-separated-sources"/);`,
`  const runtime = await readFile(new URL("../src/game/visual-quaternius-runtime.ts", import.meta.url), "utf8");
  const retarget = await readFile(new URL("../src/game/motion-retarget.ts", import.meta.url), "utf8");
  assert.doesNotMatch(runtime, /ual2-fight-core\\.glb/);
  assert.doesNotMatch(runtime, /ubc-superhero-male\\.glb[\x60\\"]/);
  assert.match(retarget, /targetRest \\* inverse\\(sourceRest\\) \\* sourceAnimated/);
  assert.match(retarget, /export function retargetMotionClips/);
  assert.match(runtime, /from "\\.\\/motion-retarget"/);
  assert.match(runtime, /quaterniusRetargetMode = "shared-rest-delta-retarget-v1"/);`,
);
await writeFile(skinTestPath, skinTest);

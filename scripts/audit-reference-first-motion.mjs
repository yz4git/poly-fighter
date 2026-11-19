// AnyMachine-inspired *human-safe* joint/stance QA on the actual imported GLBs.
// No external model/image service; no browser/runtime or shipping-game changes.
// Run: node --import tsx scripts/audit-reference-first-motion.mjs
// Output: artifacts/reference-first-motion/rig-sweep-report.json
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { PLAYABLE_FIGHTERS } from "../src/game/playable-fighters.ts";
import { createCombatMotionLibrary } from "../src/game/combat-motion-authoring.ts";
import { retargetMotionClips } from "../src/game/visual-quaternius-runtime.ts";
import { authoredMotionEvents } from "../src/game/combat-motion-timeline.ts";
import { combatCharacterStance } from "../src/game/combat-character-stance.ts";

const OUT = process.env.REFERENCE_MOTION_QA_DIR ?? "artifacts/reference-first-motion";
const BASE = new URL("../public/models/quaternius/", import.meta.url);
const round = (n) => Math.round(n * 100000) / 100000;
const JOINTS = [
  "pelvis", "Head", "spine_02", "spine_03",
  "upperarm_l", "lowerarm_l", "hand_l", "upperarm_r", "lowerarm_r", "hand_r",
  "thigh_l", "calf_l", "foot_l", "ball_l", "thigh_r", "calf_r", "foot_r", "ball_r",
];
const LIMBS = [
  ["upperarm_l", "lowerarm_l"], ["lowerarm_l", "hand_l"],
  ["upperarm_r", "lowerarm_r"], ["lowerarm_r", "hand_r"],
  ["thigh_l", "calf_l"], ["calf_l", "foot_l"],
  ["thigh_r", "calf_r"], ["calf_r", "foot_r"],
];
const SHARED_CLIPS = [
  "CM_Ready", "CM_Guard", "CM_Move_F", "CM_Move_FR", "CM_Move_R", "CM_Move_BR",
  "CM_Move_B", "CM_Move_BL", "CM_Move_L", "CM_Move_FL",
  "CM_Crouch", "CM_Wakeup", "BF_Jab_L", "BF_Cross_R",
  "BF_FrontKick_R", "BF_LowKick_L", "BF_RisingKick_R", "BF_DashKick_R",
];
const STREET_CLIPS = ["CM_StreetFlow_Jab", "CM_StreetFlow_HighKick", "CM_StreetFlow_LowPalm"];
// These are the same corrected full-body strikes measured before/after the
// reference-first IK stabilisation. Regression gate is a normalized movement
// budget, not a blanket ban on future deliberately faster techniques.
const STABLE_KICK_CLIPS = new Map([
  ["BF_FrontKick_R", "r"], ["BF_LowKick_L", "l"],
  ["BF_RisingKick_R", "r"], ["BF_DashKick_R", "r"],
  ["CM_StreetFlow_HighKick", "r"],
]);
const KICK_MAX_ENDPOINT_STEP_BODY_HEIGHT = .13;

async function readGlb(file) {
  const bytes = await readFile(new URL(file, BASE));
  const raw = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new GLTFLoader().parseAsync(raw, "");
}

function capture(nodes, names = JOINTS) {
  const results = {};
  for (const name of names) {
    const point = nodes.get(name).getWorldPosition(new THREE.Vector3());
    assert.ok([point.x, point.y, point.z].every(Number.isFinite), `nonfinite bone ${name}`);
    results[name] = point;
  }
  return results;
}

function exactSegmentLengths(positions) {
  return LIMBS.map(([a,b]) => positions[a].distanceTo(positions[b]));
}

function angularJoint(positions, a, pivot, b) {
  const v = positions[a].clone().sub(positions[pivot]);
  const w = positions[b].clone().sub(positions[pivot]);
  const degrees = THREE.MathUtils.radToDeg(v.angleTo(w));
  assert.ok(Number.isFinite(degrees), `invalid joint axis ${pivot}`);
  return degrees;
}

function sampleClip(target, mixer, clip, steps, nodes) {
  const samples = [];
  mixer.stopAllAction();
  const action = mixer.clipAction(clip).reset();
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  for (let i = 0; i <= steps; i++) {
    action.time = clip.duration * i / steps;
    mixer.update(0);
    target.updateMatrixWorld(true);
    samples.push(capture(nodes));
  }
  mixer.stopAllAction();
  return samples;
}

function inspectClip(name, clip, target, mixer, nodes, height, ready, violations, reviewFlags, fighterName) {
  const frames = Math.max(40, Math.ceil(clip.duration * 120));
  const poses = sampleClip(target, mixer, clip, frames, nodes);
  const first = poses[0], last = poses.at(-1);
  const lengthBaseline = exactSegmentLengths(first);
  const footLeft = "foot_l", footRight = "foot_r";
  const isLoop = name === "CM_Ready" || name === "CM_Guard" || name.startsWith("CM_Move_");
  const isIdle = name === "CM_Ready" || name === "CM_Guard";
  const isGait = name.startsWith("CM_Move_");
  let maxEndpointJump = 0, maxFootSlip = 0, maxLimbLengthError = 0;
  let maxJumpBone = null, maxJumpPhase = 0;
  let mostExtendedElbow = 0, mostExtendedKnee = 0;
  let maxGaitKneeFrameStep = 0, maxGaitLateralKneeSplay = 0;
  const kickSide = STABLE_KICK_CLIPS.get(name) ?? null;
  let minimumKickingKneeDeg = 180;
  for (let i = 0; i < poses.length; i++) {
    const pose = poses[i];
    const segmentLengths = exactSegmentLengths(pose);
    for (let s = 0; s < segmentLengths.length; s++) {
      maxLimbLengthError = Math.max(maxLimbLengthError, Math.abs(segmentLengths[s] - lengthBaseline[s]));
    }
    if (kickSide) minimumKickingKneeDeg = Math.min(minimumKickingKneeDeg,
      angularJoint(pose, `thigh_${kickSide}`, `calf_${kickSide}`, `foot_${kickSide}`));
    for (const side of ["l","r"]) {
      mostExtendedElbow = Math.max(mostExtendedElbow,
        angularJoint(pose, `upperarm_${side}`, `lowerarm_${side}`, `hand_${side}`));
      mostExtendedKnee = Math.max(mostExtendedKnee,
        angularJoint(pose, `thigh_${side}`, `calf_${side}`, `foot_${side}`));
    }
    if (i > 0) for (const bone of [footLeft, footRight, "hand_l", "hand_r", "Head"]) {
      const jump = pose[bone].distanceTo(poses[i-1][bone]);
      if (jump > maxEndpointJump) {
        maxEndpointJump = jump;
        maxJumpBone = bone;
        maxJumpPhase = i / frames;
      }
    }
    if (isGait) for (const side of ["l", "r"]) {
      const hip = pose[`thigh_${side}`], knee = pose[`calf_${side}`];
      const foot = pose[`foot_${side}`];
      // Signed lateral distance outside the anatomical hip-to-ankle lane.
      // Large values make side steps look bowlegged even when foot IK plants.
      const low = Math.min(hip.x, foot.x), high = Math.max(hip.x, foot.x);
      const splay = Math.max(0, low - knee.x, knee.x - high);
      maxGaitLateralKneeSplay = Math.max(maxGaitLateralKneeSplay, splay);
      if (i > 0) {
        maxGaitKneeFrameStep = Math.max(maxGaitKneeFrameStep,
          knee.distanceTo(poses[i - 1][`calf_${side}`]));
      }
    }
    if (isIdle) for (const bone of [footLeft, footRight]) {
      maxFootSlip = Math.max(maxFootSlip, pose[bone].distanceTo(first[bone]));
    }
  }
  let seam = 0;
  if (isLoop) for (const bone of ["pelvis", "Head", footLeft, footRight, "hand_l", "hand_r"]) {
    seam = Math.max(seam, first[bone].distanceTo(last[bone]));
  }
  const fail = (issue) => violations.push(`${fighterName}/${name}: ${issue}`);
  if (maxLimbLengthError > height * .005) fail(`bone lengths change ${round(maxLimbLengthError)}m`);
  if (maxEndpointJump > height * .35) fail(`pose teleport ${round(maxEndpointJump)}m per sampled frame`);
  // Promotion from diagnostic to regression gate: the *actual corrected*
  // imported-GLB kick clips must not reintroduce the large ankle jumps
  // measured before the knee-pole and dense-keyframe repair.
  if (kickSide && maxEndpointJump > height * KICK_MAX_ENDPOINT_STEP_BODY_HEIGHT) {
    fail(`kick discontinuity ${round(maxEndpointJump)}m in 1/120s on ${maxJumpBone} at phase ${round(maxJumpPhase)}`);
  }
  // A fast kick can be intentional, but very large single-frame travel may
  // also betray an IK pole flip or a thigh/ankle quaternion discontinuity.
  // Preserve the surrounding *real evaluated* leg/foot world positions so
  // reviewers can distinguish a moving ankle from a suddenly inverted knee.
  const hotspotFrame = Math.round(maxJumpPhase * frames);
  const legSuffix = maxJumpBone?.endsWith("_l") ? "l" : "r";
  const diagnosticBones = [
    "pelvis", `thigh_${legSuffix}`, `calf_${legSuffix}`,
    `foot_${legSuffix}`, `ball_${legSuffix}`,
    `thigh_${legSuffix === "l" ? "r" : "l"}`,
    `calf_${legSuffix === "l" ? "r" : "l"}`,
    `foot_${legSuffix === "l" ? "r" : "l"}`,
    `ball_${legSuffix === "l" ? "r" : "l"}`,
  ];
  const hotspotFrameStrip = maxEndpointJump > height * .13
    ? poses.slice(Math.max(0, hotspotFrame - 3), Math.min(poses.length, hotspotFrame + 4))
      .map((pose, index) => ({
        phase: round((Math.max(0, hotspotFrame - 3) + index) / frames),
        bones: Object.fromEntries(diagnosticBones.map(b => [b,
          pose[b].toArray().map(round)])),
        kneeAngleDeg: round(angularJoint(pose,
          `thigh_${legSuffix}`, `calf_${legSuffix}`, `foot_${legSuffix}`)),
      }))
    : null;
  if (hotspotFrameStrip) reviewFlags.push({
    fighter: fighterName, clip: name, bone: maxJumpBone,
    phase: round(maxJumpPhase), displacementM: round(maxEndpointJump),
    bodyHeightFraction: round(maxEndpointJump / height),
    reason: "Rapid 120 Hz endpoint movement — check 7-frame trace for IK pole or knee discontinuity",
  });
  if (isLoop && seam > height * .02) fail(`visible loop seam ${round(seam)}m`);
  if (isIdle && maxFootSlip > height * .035) fail(`feet drift while stationary ${round(maxFootSlip)}m`);
  if (isGait && maxGaitKneeFrameStep > height * .15) {
    fail(`walk knee snaps ${round(maxGaitKneeFrameStep)}m per 120 Hz sample`);
  }

  let contact = null;
  if (name.startsWith("BF_") || name.startsWith("CM_StreetFlow_")) {
    const when = authoredMotionEvents(name).contact;
    const ix = Math.round(frames * when);
    const pose = poses[ix];
    let supportSide = null;
    if (["BF_FrontKick_R", "BF_RisingKick_R", "BF_DashKick_R",
      "CM_StreetFlow_HighKick"].includes(name)) supportSide = "l";
    if (name === "BF_LowKick_L") supportSide = "r";
    const toeDrift = supportSide
      ? pose[`ball_${supportSide}`].distanceTo(ready[`ball_${supportSide}`]) : null;
    if (toeDrift !== null && toeDrift > height * .105) {
      fail(`support toe moved ${round(toeDrift)}m at authored contact`);
    }
    contact = { phase: round(when), supportFoot: supportSide,
      supportToeDriftM: toeDrift === null ? null : round(toeDrift) };
  }
  return { frames: frames + 1, durationSeconds: round(clip.duration),
    maxFrameEndpointJumpM: round(maxEndpointJump),
    maxFrameEndpointJumpBone: maxJumpBone,
    maxFrameEndpointJumpPhase: round(maxJumpPhase),
    hotspotFrameStrip,
    maxLimbLengthErrorM: round(maxLimbLengthError),
    kickingKneeMinAngleDeg: kickSide ? round(minimumKickingKneeDeg) : null,
    loopSeamM: isLoop ? round(seam) : null,
    stationaryFootDriftM: isIdle ? round(maxFootSlip) : null,
    gaitKneeStepMaxM: isGait ? round(maxGaitKneeFrameStep) : null,
    gaitLateralKneeSplayMaxM: isGait ? round(maxGaitLateralKneeSplay) : null,
    maxElbowAngleDeg: round(mostExtendedElbow),
    maxKneeAngleDeg: round(mostExtendedKnee), contact };
}

await mkdir(OUT, { recursive: true });
const report = {
  schema: "POLYFIGHTER_REFERENCE_FIRST_RIG_SWEEP_V3_EIGHT_WAY_GAIT_KNEE",
  inspiration: "apekshik/anymachine PIPELINE.md — reference, axes, pose sweep, recheck",
  source: "real imported Quaternius target GLB + authored skinned motion clips",
  limitation: "No human soft-tissue, clothing collision or physical iPhone fps certification",
  fighters: {}, violations: [], reviewFlags: [],
};
try {
  // Match loadMotion() pack order in the real renderer, including the
  // procedural fallback and base Blender packs. Omitting them silently makes
  // BF_DashKick_R disappear even though the deployed game can play it.
  const inputPacks = [
    "ual-fight-core.glb", "procedural-fight-core.glb",
    "blender-fight-core.glb", "blender-cross-core.glb",
    "blender-strikes-core.glb", "blender-kicks-core.glb",
    "blender-airborne-core.glb", "blender-reactions-core.glb",
  ];
  const packs = await Promise.all(inputPacks.map(readGlb));
  for (const fighter of PLAYABLE_FIGHTERS) {
    // Retarget and sweep on a fresh, independent import. Reusing a model after
    // one AnimationMixer has sampled it would treat its last animated pose as
    // the next fighter's bind pose: AXION/VANTA could fail for false reasons.
    const targetGlb = await readGlb(
      fighter.archetype === "SPEED"
        ? "ubc-superhero-female-flat.glb"
        : "ubc-superhero-male-flat.glb");
    const target = targetGlb.scene;
    const nodes = new Map();
    target.traverse(obj => { if (obj.isBone && obj.name) nodes.set(obj.name, obj); });
    for (const joint of JOINTS) assert.ok(nodes.has(joint), `${fighter.name}: ${joint} is missing`);
    target.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(target);
    const height = bbox.getSize(new THREE.Vector3()).y;
    assert.ok(Number.isFinite(height) && height > 1 && height < 5,
      `${fighter.name}: invalid body scale ${height}`);
    const retargetedPacks = packs.map(pack =>
      retargetMotionClips(pack.scene, target, pack.animations));
    const sources = new Map(retargetedPacks.flatMap(pack => [...pack]));
    // Runtime aliases missing authored BF_* names to procedural PF_* clips.
    // The offline audit must validate the *same* playable skeleton set rather
    // than fail on a model clip that the actual game legitimately resolves.
    const procedural = retargetedPacks[1];
    const fallbacks = [
      ["BF_Power_R", "PF_Power_R"], ["BF_Cross_R", "PF_Cross_R"],
      ["BF_Jab_L", "PF_Jab_L"], ["BF_BodyBlow_L", "PF_BodyBlow_L"],
      ["BF_Backfist_R", "PF_Backfist_R"],
      ["BF_FrontKick_R", "PF_FrontKick_R"],
      ["BF_LowKick_L", "PF_LowKick_L"],
      ["BF_RisingKick_R", "PF_RisingKick_R"],
      ["BF_DashKick_R", "PF_DashKick_R"],
    ];
    for (const [authored, alternate] of fallbacks) {
      if (sources.has(authored)) continue;
      const source = procedural.get(alternate);
      if (!source) continue;
      const alias = source.clone();
      alias.name = authored;
      sources.set(authored, alias);
    }
    const clips = createCombatMotionLibrary(target, sources, fighter);
    assert.ok(clips.size >= 25, `${fighter.name}: motion library is unexpectedly sparse`);
    const mixer = new THREE.AnimationMixer(target);
    const readyClip = clips.get("CM_Ready");
    assert.ok(readyClip, `${fighter.name}: no playable ready stance`);
    const ready = sampleClip(target, mixer, readyClip, 1, nodes)[0];
    const lengths = exactSegmentLengths(ready);
    for (const length of lengths) assert.ok(length > height * .018 && length < height * .52,
      `${fighter.name}: implausible arm or leg segment length ${length}`);
    const inspections = {};
    const suite = fighter.name === "SERA" ? [...SHARED_CLIPS, ...STREET_CLIPS] : SHARED_CLIPS;
    for (const name of suite) {
      const clip = clips.get(name);
      assert.ok(clip, `${fighter.name}: missing ${name}`);
      inspections[name] = inspectClip(name, clip, target, mixer, nodes, height,
        ready, report.violations, report.reviewFlags, fighter.name);
    }
    report.fighters[fighter.name] = {
      skeletonSource: fighter.archetype === "SPEED" ? "female-flat" : "male-flat",
      stance: combatCharacterStance(fighter.name, fighter.archetype).id,
      measuredBodyHeightM: round(height), boneCount: nodes.size,
      libraryClipCount: clips.size, auditedClipCount: suite.length,
      limbLengthsM: lengths.map(round), clips: inspections,
    };
    mixer.stopAllAction();
    mixer.uncacheRoot(target);
  }
  assert.equal(Object.keys(report.fighters).length, 4);
  const stanceNames = Object.values(report.fighters).map(f => f.stance);
  assert.equal(new Set(stanceNames).size, 4, "four distinct authored character poses");
  assert.deepEqual(report.violations, [], report.violations.join("\n"));
  report.status = report.reviewFlags.length ? "passed_with_visual_review_flags" : "passed";
  console.log(`REFERENCE_FIRST_RIG_SWEEP_PASSED ${JSON.stringify({
    fighters: Object.keys(report.fighters),
    clips: Object.values(report.fighters).reduce((n,f)=>n+f.auditedClipCount,0),
    violations: report.violations.length,
    reviewFlags: report.reviewFlags.length,
  })}`);
} catch (error) {
  report.status = "failed";
  report.failure = String(error?.stack ?? error);
  console.error("REFERENCE_FIRST_RIG_SWEEP_FAILED", report.failure);
  process.exitCode = 1;
} finally {
  await writeFile(`${OUT}/rig-sweep-report.json`, JSON.stringify(report, null, 2) + "\n");
  // The reviewer can inspect a concise human-readable pass/fail table
  // alongside the machine-readable evidence without a Blender installation.
  const summary = [
    "# PolyFighter — reference-first anatomical rig sweep",
    "",
    `Status: **${(report.status ?? "unknown").toUpperCase()}**`,
    "",
    "| Fighter | Rig | Body height | Authored stance | Sampled clips |",
    "| --- | --- | ---: | --- | ---: |",
    ...Object.entries(report.fighters).map(([name, f]) =>
      `| ${name} | ${f.skeletonSource} | ${f.measuredBodyHeightM} m | ${f.stance} | ${f.auditedClipCount} |`),
    "",
    `Detected structural violations: **${report.violations.length}**`,
    ...report.violations.map(v => `- ${v}`),
    "",
    `Animation poses marked for visual review: **${report.reviewFlags.length}**`,
    ...report.reviewFlags.map(v =>
      `- ${v.fighter} / ${v.clip}: ${v.bone} moves ${v.displacementM} m at normalized phase ${v.phase} (1/120s sample)`),
    "",
    "**Not certified:** final anatomy or sculpt, cloth/skin self-intersections,",
    "reference-vs-render artistic likeness, mobile Safari 60fps.",
    "",
    "The JSON report contains measured joint, stance, gait and contact values.",
  ].join("\n");
  await writeFile(`${OUT}/rig-sweep-summary.md`, summary + "\n");
}

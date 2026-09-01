import { readFile, writeFile } from "node:fs/promises";

const file = new URL("../src/game/motion-expansion-runtime.ts", import.meta.url);
let source = await readFile(file, "utf8");

function replaceOnce(before, after, label) {
  if (!source.includes(before)) throw new Error(`Procedural v2 runtime patch missing anchor: ${label}`);
  source = source.replace(before, after);
}

replaceOnce(
`  PF_Wakeup: "LayToIdle",\n  Melee_Hook: "Punch_Cross",`,
`  PF_Wakeup: "LayToIdle",\n  PF_GuardBreak: "Idle_Shield_Break",\n  PF_Sidestep_L: "Slide_Start",\n  PF_Sidestep_R: "Slide_Start",\n  PF_KickRecover: "NinjaJump_Land",\n  PF_HeavyRecover: "Melee_Hook_Rec",\n  Melee_Hook: "Punch_Cross",`,
"v2 fallbacks",
);

replaceOnce(
`      if (propertyName === "position" && nodeName === "pelvis" && track.values.length % 3 === 0) {\n        const values = new Float32Array(track.values.length);\n        for (let offset = 0; offset < track.values.length; offset += 3) {\n          values[offset] = targetNode.position.x;\n          values[offset + 1] = targetNode.position.y + (track.values[offset + 1] - sourceNode.position.y);\n          values[offset + 2] = targetNode.position.z;\n        }\n        const next = new THREE.VectorKeyframeTrack(track.name, track.times, values);`,
`      if (propertyName === "position" && nodeName === "pelvis" && track.values.length % 3 === 0) {\n        const values = new Float32Array(track.values.length);\n        const preserveProceduralPlanarRoot = clip.name.startsWith("PF_");\n        for (let offset = 0; offset < track.values.length; offset += 3) {\n          const planarX = preserveProceduralPlanarRoot\n            ? THREE.MathUtils.clamp(track.values[offset] - sourceNode.position.x, -0.09, 0.09)\n            : 0;\n          const planarZ = preserveProceduralPlanarRoot\n            ? THREE.MathUtils.clamp(track.values[offset + 2] - sourceNode.position.z, -0.09, 0.09)\n            : 0;\n          values[offset] = targetNode.position.x + planarX;\n          values[offset + 1] = targetNode.position.y + (track.values[offset + 1] - sourceNode.position.y);\n          values[offset + 2] = targetNode.position.z + planarZ;\n        }\n        const next = new THREE.VectorKeyframeTrack(track.name, track.times, values);`,
"bounded procedural planar root",
);

replaceOnce(
`    fighter.visual.root.userData.motionExpansionHasProcedural = runtime.clips.has("PF_Jab_L") && runtime.clips.has("PF_RisingKick_R");\n    fighter.visual.root.userData.motionExpansionProceduralClipCount = Array.from(runtime.clips.keys()).filter((name) => name.startsWith("PF_")).length;\n    fighter.visual.root.userData.motionExpansionProceduralVersion = "PROCEDURAL_FIGHT_V1";`,
`    fighter.visual.root.userData.motionExpansionHasProcedural = runtime.clips.has("PF_Jab_L")\n      && runtime.clips.has("PF_RisingKick_R")\n      && runtime.clips.has("PF_GuardBreak")\n      && runtime.clips.has("PF_KickRecover");\n    fighter.visual.root.userData.motionExpansionProceduralClipCount = Array.from(runtime.clips.keys()).filter((name) => name.startsWith("PF_")).length;\n    fighter.visual.root.userData.motionExpansionProceduralVersion = "PROCEDURAL_FIGHT_V2";\n    fighter.visual.root.userData.motionExpansionRootMotionPolicy = "BOUNDED_PROCEDURAL_COM_XZ_PLUS_Y";`,
"runtime v2 diagnostics",
);

replaceOnce(
`  if (fighter.state === "BLOCK_STUN") return { name: "Idle_Shield_Break", loop: false, speed: 1.75, phase: "REACTION" };`,
`  if (fighter.state === "BLOCK_STUN") return { name: "PF_GuardBreak", loop: false, speed: 1.75, phase: "REACTION" };`,
"generated guard break",
);

replaceOnce(
`  if (fighter.state === "SIDESTEP") return { name: "Slide_Start", loop: false, speed: 1.65, phase: "EVASION" };`,
`  if (fighter.state === "SIDESTEP") {\n    const clip = fighter.position.z < 0 ? "PF_Sidestep_L" : "PF_Sidestep_R";\n    return { name: clip, loop: false, speed: 1.65, phase: "EVASION" };\n  }`,
"generated sidestep",
);

await writeFile(file, source);
console.log("Applied Procedural Fight Motion Generator v2 runtime integration");

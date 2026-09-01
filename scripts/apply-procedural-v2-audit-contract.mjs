import { readFile, writeFile } from "node:fs/promises";

const file = new URL("../scripts/capture-motion-readability-audit.mjs", import.meta.url);
let source = await readFile(file, "utf8");
const before = source;
source = source.replace(
  'root.userData.motionExpansionHasProcedural === true && root.userData.motionExpansionProceduralClipCount === 15',
  'root.userData.motionExpansionHasProcedural === true && root.userData.motionExpansionProceduralClipCount === 20',
);
source = source.replace(
  'preload.proceduralVersion !== "PROCEDURAL_FIGHT_V1"',
  'preload.proceduralVersion !== "PROCEDURAL_FIGHT_V2"',
);
if (source === before) throw new Error("Procedural v2 audit contract anchors were not found");
if (!source.includes('motionExpansionProceduralClipCount === 20')) throw new Error("v2 clip-count contract not applied");
if (!source.includes('preload.proceduralVersion !== "PROCEDURAL_FIGHT_V2"')) throw new Error("v2 version contract not applied");
await writeFile(file, source);
console.log("Updated motion readability audit contract to Procedural Fight v2");

import { readFile, writeFile } from "node:fs/promises";

const path = "src/game/visual-quaternius-runtime.ts";
let source = await readFile(path, "utf8");

if (!source.includes("function guardPoseCorrection(")) {
  const marker = "\nfunction desiredClip(fighter: FighterRuntime): { name: string; loop: boolean; speed: number } {";
  if (!source.includes(marker)) throw new Error("desiredClip insertion marker missing");
  const guard = `
function guardPoseCorrection(runtime: QuaterniusRuntime, fighter: FighterRuntime): void {
  if (fighter.state !== "GUARD") return;
  const chains = [
    { suffix: "l" as const, contact: "LEFT_FIST" as const, poleSide: 1 },
    { suffix: "r" as const, contact: "RIGHT_FIST" as const, poleSide: -1 },
  ];
  for (const chain of chains) {
    const root = runtime.bones.get(\`upperarm_\${chain.suffix}\`);
    const mid = runtime.bones.get(\`lowerarm_\${chain.suffix}\`);
    const end = runtime.bones.get(\`hand_\${chain.suffix}\`);
    if (!root || !mid || !end) continue;
    const target = getVisualContactPoint(fighter.visual, chain.contact);
    const pole = fighter.visual.root.localToWorld(new THREE.Vector3(chain.poleSide * 0.52, 0.78, 0.28));
    solveImportedLimb(root, mid, end, target, pole);
  }
}
`;
  source = source.replace(marker, `${guard}${marker}`);
}

const updateMarker = "  advance(runtime, timeSeconds);\n  attackContactCorrection(runtime, fighter);";
if (!source.includes("guardPoseCorrection(runtime, fighter);")) {
  if (!source.includes(updateMarker)) throw new Error("runtime update marker missing");
  source = source.replace(updateMarker, "  advance(runtime, timeSeconds);\n  guardPoseCorrection(runtime, fighter);\n  attackContactCorrection(runtime, fighter);");
}

await writeFile(path, source);
console.log("Applied Quaternius GUARD canonical-fist IK correction");

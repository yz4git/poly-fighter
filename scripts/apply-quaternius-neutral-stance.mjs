import { readFile, writeFile } from "node:fs/promises";

const path = "src/game/visual-quaternius-runtime.ts";
let source = await readFile(path, "utf8");

if (!source.includes("function neutralPoseCorrection(")) {
  const marker = "\nfunction guardPoseCorrection(runtime: QuaterniusRuntime, fighter: FighterRuntime): void {";
  if (!source.includes(marker)) throw new Error("guardPoseCorrection insertion marker missing");
  const neutral = `
function neutralPoseCorrection(runtime: QuaterniusRuntime, fighter: FighterRuntime): void {
  if (fighter.state !== "IDLE" && fighter.state !== "WALK" && fighter.state !== "CROUCH") return;
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
    const pole = fighter.visual.root.localToWorld(new THREE.Vector3(chain.poleSide * 0.48, 0.70, 0.24));
    solveImportedLimb(root, mid, end, target, pole);
  }
}
`;
  source = source.replace(marker, `${neutral}${marker}`);
}

const updateMarker = "  advance(runtime, timeSeconds);\n  guardPoseCorrection(runtime, fighter);";
if (!source.includes("neutralPoseCorrection(runtime, fighter);")) {
  if (!source.includes(updateMarker)) throw new Error("runtime update marker missing");
  source = source.replace(updateMarker, "  advance(runtime, timeSeconds);\n  neutralPoseCorrection(runtime, fighter);\n  guardPoseCorrection(runtime, fighter);");
}

await writeFile(path, source);
console.log("Applied Quaternius neutral canonical-fist stance correction");

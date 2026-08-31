import { readFile, writeFile } from "node:fs/promises";

const path = "src/game/tps-game.ts";
let source = await readFile(path, "utf8");
const before = "    this.resolveAttack(this.p1, this.p2, input.guard);\n    this.resolveAttack(this.p2, this.p1, this.p1.state === \"GUARD\");";
const after = "    this.resolveAttack(this.p1, this.p2, this.p2.state === \"GUARD\");\n    this.resolveAttack(this.p2, this.p1, this.p1.state === \"GUARD\");";
if (!source.includes(after)) {
  if (!source.includes(before)) throw new Error("TPS attack/guard wiring marker missing");
  source = source.replace(before, after);
}
await writeFile(path, source);
console.log("Connected TPS hit blocking to the defending fighter's GUARD state");

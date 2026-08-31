import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const sourcePath = "scripts/apply-tps-goal-review-pass.mjs";
const tempPath = "scripts/.apply-tps-goal-review-pass.runtime.mjs";
let source = readFileSync(sourcePath, "utf8");

source = source
  .replace(
    '{pressableAction(gameRef, "guard", "Guard", "G", `guard ${tpsIncoming ? "tps-threat-action" : ""}`)}',
    '{pressableAction(gameRef, "guard", "Guard", "G", "guard " + (tpsIncoming ? "tps-threat-action" : ""))}',
  )
  .replace(
    '{pressableAction(gameRef, "punch", "Punch", "P", `punch ${tpsStrikeRange ? "tps-ready-action" : ""}`)}',
    '{pressableAction(gameRef, "punch", "Punch", "P", "punch " + (tpsStrikeRange ? "tps-ready-action" : ""))}',
  )
  .replace(
    '{pressableAction(gameRef, "kick", "Kick", "K", `kick ${tpsStrikeRange ? "tps-ready-action" : ""}`)}',
    '{pressableAction(gameRef, "kick", "Kick", "K", "kick " + (tpsStrikeRange ? "tps-ready-action" : ""))}',
  );

writeFileSync(tempPath, source);
await import(pathToFileURL(`${process.cwd()}/${tempPath}`).href);

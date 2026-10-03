import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TPS presentation bootstrap keeps wrapper order explicit and finish runtime outermost", async () => {
  const source = await readFile(new URL("../app/TpsPresentationBootstrap.tsx", import.meta.url), "utf8");

  assert.match(source, /const RIVAL_RUNTIME_INSTALLERS = \[/);
  assert.match(source, /const FIGHTER_PRESENTATION_INSTALLERS = \[/);
  assert.match(source, /const TPS_PRESENTATION_INSTALLERS = \[/);
  assert.match(source, /installTpsKickPairSpacingPresentation,/);
  assert.match(source, /installAll\(TPS_PRESENTATION_INSTALLERS\);/);

  const stackInstall = source.indexOf("installAll(TPS_PRESENTATION_INSTALLERS);");
  const finishInstall = source.indexOf("installRivalCircuitFinishRuntime();");
  assert.ok(stackInstall >= 0 && finishInstall > stackInstall);
});

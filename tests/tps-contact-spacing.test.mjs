import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TPS contact spacing policy owns throw and hit-stop separation", async () => {
  const source = await readFile(new URL("../src/game/tps-contact-spacing.ts", import.meta.url), "utf8");

  assert.match(source, /TPS_IMPACT_CONTACT_MINIMUM = 1\.52/);
  assert.match(source, /TPS_IMPACT_CONTACT_MINIMUM_HEAVY = 1\.58/);
  assert.match(source, /TPS_IMPACT_CONTACT_MINIMUM_KICK = 1\.62/);
  assert.match(source, /mode: "THROW", minimum: 0\.98/);
  assert.match(source, /mode: "IMPACT_PAIR"/);
  assert.match(source, /mode: "NEUTRAL", minimum: 1\.12/);
  assert.match(source, /impactFrozen/);
});

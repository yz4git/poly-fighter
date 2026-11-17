import assert from "node:assert/strict";
import test from "node:test";
import { ARTIST_PRIVATE_COMBAT_VERSION, resolveArtistPrivateCombatModels } from "../src/game/artist-private-combat";

test("public fighter selection never imports an ephemeral artist GLB", () => {
  assert.equal(ARTIST_PRIVATE_COMBAT_VERSION, "SERA_LOCAL_COMBAT_QA_V1");
  for (const selected of ["ORIGINAL", "QUATERNIUS_UBC", "SERA_HERO_PBR"] as const) {
    const plan = resolveArtistPrivateCombatModels(false, "blob:https://local.example/test", selected);
    assert.deepEqual(plan, {
      p1Model: selected,
      p2Model: selected,
      eligible: true,
      issue: null,
    });
  }
});
test("private test sends the unapproved GLB ONLY to SERA player, with known-good UBC CPU", () => {
  const plan = resolveArtistPrivateCombatModels(true, "blob:https://localhost:3000/abc-123", "ORIGINAL");
  assert.deepEqual(plan, {
    p1Model: "SERA_ARTIST_PREVIEW",
    p2Model: "QUATERNIUS_UBC",
    eligible: true,
    issue: null,
  });
});
test("local/private fight cannot begin with a missing, remote, file or data GLB URL", () => {
  for (const url of [null, "", "https://example.org/unknown.glb", "data:model/gltf-binary;base64,YQ==", "file:///private/art.glb"]) {
    const plan = resolveArtistPrivateCombatModels(true, url, "ORIGINAL");
    assert.equal(plan.eligible, false);
    assert.equal(plan.p1Model, "QUATERNIUS_UBC");
    assert.equal(plan.p2Model, "QUATERNIUS_UBC");
    assert.match(plan.issue ?? "", /Select a compatible SERA GLB/);
  }
});

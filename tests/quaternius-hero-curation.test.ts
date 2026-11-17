import assert from "node:assert/strict";
import test from "node:test";
import {
  QUATERNIUS_HERO_CURATION_VERSION,
  decideQuaterniusHeroDetail,
} from "../src/game/quaternius-hero-curation";

const d = (name: string, archetype: "POWER" | "SPEED", source: "HERO_KIT" | "V2" = "HERO_KIT") =>
  decideQuaterniusHeroDetail(name, archetype, source);

test("curated hero keeps skinned-fist contact and recognizable hair silhouette", () => {
  assert.equal(QUATERNIUS_HERO_CURATION_VERSION,"SCULPT_READY_MINIMAL_SILHOUETTE_V1");
  for (const [fighter, archetype] of [["kairo","POWER"],["sera","SPEED"]] as const) {
    assert.equal(d(`ubc-${fighter}-left-fist`,archetype),"KEEP");
    assert.equal(d(`ubc-${fighter}-right-fist`,archetype),"KEEP");
    assert.equal(d(`ubc-${fighter}-hair-cap`,archetype),"KEEP");
    assert.equal(d(`ubc-${fighter}-v2-ponytail-tip`,archetype,"V2"),"KEEP");
    assert.equal(d(`ubc-${fighter}-outfit-left-leg-stripe`,archetype),"KEEP");
  }
});

test("curated hero rejects floating box chest, fake jaw facets, shoulder fins, plated shins and v2 toe caps", () => {
  const remove = [
    ["ubc-sera-outfit-jacket-left","SPEED","HERO_KIT"],
    ["ubc-sera-outfit-bodysuit","SPEED","HERO_KIT"],
    ["ubc-sera-outfit-left-boot","SPEED","HERO_KIT"],
    ["ubc-sera-left-shin-guard","SPEED","HERO_KIT"],
    ["ubc-sera-v2-left-cheek-plane","SPEED","V2"],
    ["ubc-sera-v2-chest-prism","SPEED","V2"],
    ["ubc-sera-v2-right-toe-cap","SPEED","V2"],
    ["ubc-kairo-outfit-jacket-right","POWER","HERO_KIT"],
    ["ubc-kairo-outfit-abdomen","POWER","HERO_KIT"],
    ["ubc-kairo-v2-chest-chevron","POWER","V2"],
    ["ubc-kairo-v2-left-shoulder-fin","POWER","V2"],
  ] as const;
  for (const [name, archetype, source] of remove) {
    assert.equal(d(name, archetype, source),"REJECT_BLOCKY_PLACEHOLDER",name);
  }
  assert.equal(d("ubc-sera-left-fist","POWER"),"REJECT_BLOCKY_PLACEHOLDER",
    "never attach another fighter's detail");
});

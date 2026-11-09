import test from "node:test";
import assert from "node:assert/strict";
import { evaluateArtistLicense } from "../scripts/artist-license-policy.mjs";

function originalCC0() {
  return {
    schemaVersion: 1, character: "SERA",
    artistOrStudio: "Independent sculptor",
    sourceOrCommissionReference: "https://theunseenvulga.itch.io/3d-character-riggedema",
    license: "CC0-1.0",attribution: "",
    commercialGameUse: true, derivativesAllowed: true,
    binaryRedistributionAllowed: true, publicRawAssetPostingAllowed: true,
    browserGlbExtractabilityAllowed: true,
  };
}

test("explicit CC0 original artist model is technically eligible under license policy", () => {
  assert.deepEqual(evaluateArtistLicense(originalCC0()), []);
});
test("licensed commercial game-only models cannot be exposed as a raw browser GLB", () => {
  const candidate = originalCC0();
  candidate.browserGlbExtractabilityAllowed = false;
  assert.ok(evaluateArtistLicense(candidate).some(s=>s.includes("browser-extractable")));
});
test("official Renderpeople origin is rejected without a separately documented browser distribution grant", () => {
  const candidate = {...originalCC0(), sourceOrCommissionReference: "https://renderpeople.com/free-3d-people/", license:"Renderpeople-Free"};
  assert.ok(evaluateArtistLicense(candidate).some(s=>s.includes("separate documented")));
});
test("a marketplace name in artist provenance cannot evade restrictions by claiming CC0", () => {
  const candidate={...originalCC0(), artistOrStudio:"Renderpeople GmbH"};
  assert.ok(evaluateArtistLicense(candidate).some(s=>s.includes("separate documented")));
});
test("Renderpeople can only pass license intake with independently recorded separate grant", () => {
  const candidate={...originalCC0(), sourceOrCommissionReference: "https://renderpeople.com/free-3d-people/",
    separateSignedBrowserDistributionGrant: true,
    separateSignedGrantReference: "Signed grant RPR-2026-144 permitting public extractable GLB delivery",
  };
  assert.equal(evaluateArtistLicense(candidate).length,0);
});
test("paid CGTrader and RenderHub marketplace models require specific web-delivery rights", () => {
  for(const source of ["https://www.cgtrader.com/free-3d-models/character/woman/example",
                       "https://www.renderhub.com/studio/female-model"]) {
    const candidate={...originalCC0(),sourceOrCommissionReference:source};
    assert.ok(evaluateArtistLicense(candidate).some(s=>s.includes("separate documented")));
  }
});
test("CC BY requires attribution even if all technical game rights are allowed", () => {
  const candidate={...originalCC0(),license:"CC-BY-4.0"};
  assert.ok(evaluateArtistLicense(candidate).some(s=>s.includes("attribution")));
});

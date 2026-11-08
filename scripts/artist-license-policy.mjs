/**
 * License intake is intentionally stricter than game-use-only licenses:
 * PolyFighter is deployed through public URLs and downloadable GLB bytes.
 * Only a grant permitting those exact distribution mechanics can pass.
 */
export function evaluateArtistLicense(record) {
  const errors = [];
  const actual = (value) => typeof value === "string" &&
    value.trim().length > 2 && !/replace|placeholder|tbd|example/i.test(value);
  if (record.character !== "SERA" || record.schemaVersion !== 1) {
    errors.push("Invalid character or provenance schema");
  }
  if (!actual(record.artistOrStudio)) {
    errors.push("Identify the true artist or copyright holder");
  }
  if (!actual(record.sourceOrCommissionReference)) {
    errors.push("Specify the original artwork or commission source");
  }
  if (!actual(record.license)) {
    errors.push("Exact license or signed commission grant required");
  }
  if (record.commercialGameUse !== true || record.derivativesAllowed !== true) {
    errors.push("Commercial use and derivative character editing rights required");
  }
  if (record.binaryRedistributionAllowed !== true ||
      record.publicRawAssetPostingAllowed !== true ||
      record.browserGlbExtractabilityAllowed !== true) {
    errors.push("Public GitHub GLB storage and browser-extractable game models must be expressly allowed");
  }
  if (/cc[- ]?by/i.test(record.license ?? "") && !actual(record.attribution)) {
    errors.push("CC-BY attribution missing");
  }
  const origin = String(record.sourceOrCommissionReference ?? "") + " " +
    String(record.artistOrStudio ?? "") + " " + String(record.license ?? "");
  const restrictedProvider = /renderpeople(\.com)?|cgtrader(\.com)?|renderhub(\.com)?/i.test(origin);
  if (restrictedProvider) {
    if (record.separateSignedBrowserDistributionGrant !== true ||
        !actual(record.separateSignedGrantReference)) {
      errors.push("Marketplace/scan provider requires a separate documented license that explicitly authorizes publicly extractable browser GLB delivery");
    }
  }
  return errors;
}

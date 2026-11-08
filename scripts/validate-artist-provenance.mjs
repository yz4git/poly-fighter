#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const [, , modelPath, manifestPath] = process.argv;
if (!modelPath || !manifestPath) {
  console.error("Usage: node scripts/validate-artist-provenance.mjs candidate.glb provenance.json");
  process.exit(2);
}
const source = JSON.parse(await readFile(manifestPath, "utf8"));
const failures = [];
const supplied = (value) => typeof value === "string" && value.trim().length > 2 &&
  !/replace|placeholder|tbd/i.test(value);
if (source.character !== "SERA" || source.schemaVersion !== 1) failures.push("Invalid character or schema");
if (!supplied(source.artistOrStudio)) failures.push("Identify the actual asset artist/studio");
if (!supplied(source.sourceOrCommissionReference)) failures.push("Provide original authoring or commissioned asset source");
if (!supplied(source.license)) failures.push("Describe exact permitted license/rights");
if (source.commercialGameUse !== true || source.derivativesAllowed !== true ||
    source.binaryRedistributionAllowed !== true || source.publicRawAssetPostingAllowed !== true)
  failures.push("Need commercial game, derivative, redistribution and explicit public raw-GLB posting rights");
if (source.license?.toLowerCase().includes("by") && !supplied(source.attribution))
  failures.push("CC-BY requires attribution");
const raw = await readFile(modelPath);
const digest = createHash("sha256").update(raw).digest("hex");
console.log(JSON.stringify({sha256:digest,provenanceErrors:failures},null,2));
if (failures.length) process.exitCode = 1;

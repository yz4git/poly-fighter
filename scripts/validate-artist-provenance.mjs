#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { evaluateArtistLicense } from "./artist-license-policy.mjs";
const [, , modelPath, manifestPath] = process.argv;
if (!modelPath || !manifestPath) {
  console.error("Usage: node scripts/validate-artist-provenance.mjs candidate.glb provenance.json");
  process.exit(2);
}
const source = JSON.parse(await readFile(manifestPath, "utf8"));
const failures = evaluateArtistLicense(source);
const raw = await readFile(modelPath);
const digest = createHash("sha256").update(raw).digest("hex");
console.log(JSON.stringify({sha256:digest,provenanceErrors:failures},null,2));
if (failures.length) process.exitCode = 1;

#!/usr/bin/env node
// Source-quality gate, distinct from HUMAN ART APPROVAL.
// Run via: node --import tsx scripts/artist-asset-quality-gate.mjs INPUT.glb [REPORT.json]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { inspectArtistGlb } from "../src/game/artist-glb-contract.ts";
const [source, reportPath] = process.argv.slice(2);
if (!source) {
  console.error("Usage: node --import tsx scripts/artist-asset-quality-gate.mjs candidate.glb [quality.json]");
  process.exit(2);
}
const bytes = await readFile(source);
const report = inspectArtistGlb(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  path.basename(source));
console.log(JSON.stringify(report, null, 2));
if (reportPath) {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
}
if (!report.technicallyEligible) {
  console.error("REJECTED: technical intake failed. No automatic SERA fallback promotion.");
  process.exitCode = 1;
}

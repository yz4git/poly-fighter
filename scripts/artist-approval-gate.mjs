#!/usr/bin/env node
// Manual human art approval SHA-pinned to the exact commercial game asset.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const [, , model, approvals] = process.argv;
if (!model || !approvals) {
  console.error("Usage: node scripts/artist-approval-gate.mjs candidate.glb approval.json");
  process.exit(2);
}
const review = JSON.parse(await readFile(approvals, "utf8"));
const sha256 = createHash("sha256").update(await readFile(model)).digest("hex");
const required = [
  "facialIdentityMatchesSera","professionalHairSilhouette",
  "tailoredGarmentsNoFloatingParts","credibleSkinHairClothMaterials",
  "combatPoseDeformationPassed","iphoneSafariPerformancePassed",
];
const problems = [];
if (review.schemaVersion !== 1 || review.character !== "SERA") problems.push("Review schema mismatch");
if (review.approvedGlbSha256 !== sha256)
  problems.push("Approval must pin actual GLB SHA-256: "+sha256);
if (typeof review.reviewer !== "string" || review.reviewer.trim().length < 3)
  problems.push("Reviewer missing");
if (!review.reviewDate) problems.push("Review date missing");
for (const key of required) if (review[key] !== true) problems.push("Still not approved: "+key);
console.log(JSON.stringify({
  result:problems.length?"REJECTED_UNREVIEWED":"MANUALLY_SIGNED",
  sha256, reviewer:review.reviewer,problems
},null,2));
if (problems.length) process.exitCode = 1;

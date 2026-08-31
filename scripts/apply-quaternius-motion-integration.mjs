import { readFile, writeFile } from "node:fs/promises";

async function read(path) { return readFile(path, "utf8"); }
async function write(path, content) { return writeFile(path, content, "utf8"); }

function replaceOnce(content, needle, replacement, label) {
  if (content.includes(replacement)) return content;
  const first = content.indexOf(needle);
  if (first < 0) throw new Error(`Patch target not found: ${label}`);
  if (content.indexOf(needle, first + needle.length) >= 0) throw new Error(`Patch target is ambiguous: ${label}`);
  return content.slice(0, first) + replacement + content.slice(first + needle.length);
}

let fighter = await read("src/game/fighter.ts");
fighter = replaceOnce(
  fighter,
  'import { attackHitboxCenter, fighterBasis, fighterRootQuaternion, orientBoneForward, solveTwoBoneIK } from "./rig";\n',
  'import { attackHitboxCenter, fighterBasis, fighterRootQuaternion, orientBoneForward, solveTwoBoneIK } from "./rig";\nimport { motionClipDuration, quaterniusMotionDelta, retargetQuaterniusPoint, sampleQuaterniusMotion } from "./quaternius-motion";\n',
  "Quaternius animation import",
);

const oldWalk = `    if (state === "WALK") {
      const stride = Math.sin(timeSeconds * 12) * 0.24;
      visual.hips.rotation.y = -stride * 0.10;
      visual.hips.position.x = Math.sin(timeSeconds * 6) * 0.008;
      visual.leftArm.root.rotation.z = -stride * 0.7;
      visual.rightArm.root.rotation.z = stride * 0.7;
      visual.rig.bones.spineLower.rotation.y = -stride * 0.12;
      visual.rig.bones.spineUpper.rotation.y = stride * 0.16;
      solveLegToSole(-1, getWalkFootTarget(visual, "left", timeSeconds), legPole(-1));
      solveLegToSole(1, getWalkFootTarget(visual, "right", timeSeconds), legPole(1));
`;
const newWalk = `    if (state === "WALK") {
      const stride = Math.sin(timeSeconds * 12) * 0.24;
      const walkDuration = motionClipDuration("Walk_Loop");
      const walkPhase = (timeSeconds % walkDuration) / walkDuration;
      const walkSample = sampleQuaterniusMotion("Walk_Loop", walkPhase, true);
      const walkChest = quaterniusMotionDelta("Walk_Loop", walkPhase, "chest", true);
      visual.hips.rotation.y = -stride * 0.10;
      visual.hips.position.x = Math.sin(timeSeconds * 6) * 0.008 + walkSample.hipsDelta[0] * 0.08;
      visual.hips.position.y += walkSample.hipsDelta[1] * 0.16;
      visual.leftArm.root.rotation.z = -stride * 0.7;
      visual.rightArm.root.rotation.z = stride * 0.7;
      visual.rig.bones.spineLower.rotation.y = -stride * 0.12 + walkChest[0] * 0.65;
      visual.rig.bones.spineUpper.rotation.y = stride * 0.16 - walkChest[0] * 0.50;
      visual.rig.bones.spineUpper.rotation.x += -walkChest[2] * 0.28;
      solveLegToSole(-1, getWalkFootTarget(visual, "left", timeSeconds), legPole(-1));
      solveLegToSole(1, getWalkFootTarget(visual, "right", timeSeconds), legPole(1));
`;
fighter = replaceOnce(fighter, oldWalk, newWalk, "WALK mocap layer");

const oldPunch = `        const punchSide: -1 | 1 = move.visualContact === "LEFT_FIST" ? -1 : 1;
        const punchPrefix = punchSide < 0 ? "left" : "right";
        const bindFist = getVisualContactPoint(visual, punchSide < 0 ? "LEFT_FIST" : "RIGHT_FIST");
        const target = bindFist.lerp(combatTarget, targetBlend);
        visual.hips.rotation.y = -snap * 0.12;
        visual.rig.bones.spineLower.rotation.y = -snap * 0.15;
        visual.rig.bones.spineUpper.rotation.y = snap * 0.22;
        visual.rig.bones.chest.rotation.z = -snap * 0.06;
        visual.leftLeg.root.rotation.z = 0.12;
        visual.rightLeg.root.rotation.z = -0.20;
        visual.root.updateMatrixWorld(true);
        const shoulder = visual.rig.bones[\`\${punchPrefix}Shoulder\`].getWorldPosition(new THREE.Vector3());
        const pole = shoulder.clone().addScaledVector(basis.side, punchSide * scale * 0.22).addScaledVector(basis.up, -scale * 0.08).addScaledVector(basis.forward, scale * 0.08);
        solveArm(punchSide, target, pole);
        const recoverySide = (punchSide * -1) as -1 | 1;
        const recoveryX = recoverySide * 0.16;
        const recoveryPrefix = recoverySide < 0 ? "left" : "right";
        solveArm(recoverySide, visual.root.localToWorld(new THREE.Vector3(recoveryX, layout.shoulderY - 0.07, 0.18)), visual.rig.bones[\`\${recoveryPrefix}Shoulder\`].getWorldPosition(new THREE.Vector3()).addScaledVector(basis.side, recoverySide * scale * 0.20));
`;
const newPunch = `        const punchSide: -1 | 1 = move.visualContact === "LEFT_FIST" ? -1 : 1;
        const punchPrefix = punchSide < 0 ? "left" : "right";
        const sourceClip = move.id === "jab" ? "Punch_Jab" : "Punch_Cross";
        const sourceSide: -1 | 1 = sourceClip === "Punch_Jab" ? -1 : 1;
        const mirrorMotion = sourceSide !== punchSide;
        const totalMoveTicks = Math.max(1, move.startup + move.active + move.recovery - 1);
        const motionPhase = THREE.MathUtils.clamp(fighter.moveTick / totalMoveTicks, 0, 1);
        const motionSample = sampleQuaterniusMotion(sourceClip, motionPhase);
        const sourceActiveHand = sourceSide < 0 ? motionSample.leftHand : motionSample.rightHand;
        const sourceOffHand = sourceSide < 0 ? motionSample.rightHand : motionSample.leftHand;
        visual.root.updateMatrixWorld(true);
        const hipsWorld = visual.rig.bones.hips.getWorldPosition(new THREE.Vector3());
        const motionTarget = retargetQuaterniusPoint(sourceActiveHand, hipsWorld, basis, scale, mirrorMotion);
        const bindFist = getVisualContactPoint(visual, punchSide < 0 ? "LEFT_FIST" : "RIGHT_FIST");
        const authoredTarget = bindFist.clone().lerp(motionTarget, 0.74);
        const activeStart = move.startup;
        const activeEnd = move.startup + move.active;
        const contactBlend = fighter.moveTick < activeStart
          ? THREE.MathUtils.smoothstep(fighter.moveTick, Math.max(0, activeStart - 3), activeStart)
          : fighter.moveTick < activeEnd
            ? 1
            : 1 - THREE.MathUtils.smoothstep(fighter.moveTick, activeEnd, activeEnd + 4);
        const target = authoredTarget.lerp(combatTarget, THREE.MathUtils.clamp(contactBlend, 0, 1));
        const sourceChest = quaterniusMotionDelta(sourceClip, motionPhase, "chest");
        const sourceLateral = (mirrorMotion ? -sourceChest[0] : sourceChest[0]);
        visual.hips.rotation.y = -snap * 0.12 + sourceLateral * 0.72;
        visual.hips.position.y += motionSample.hipsDelta[1] * 0.10;
        visual.rig.bones.spineLower.rotation.y = -snap * 0.15 + sourceLateral * 0.72;
        visual.rig.bones.spineUpper.rotation.y = snap * 0.22 - sourceLateral * 0.44;
        visual.rig.bones.spineUpper.rotation.x += -sourceChest[2] * 0.32;
        visual.rig.bones.chest.rotation.z = -snap * 0.06;
        visual.leftLeg.root.rotation.z = 0.12;
        visual.rightLeg.root.rotation.z = -0.20;
        visual.root.updateMatrixWorld(true);
        const shoulder = visual.rig.bones[\`\${punchPrefix}Shoulder\`].getWorldPosition(new THREE.Vector3());
        const pole = shoulder.clone().addScaledVector(basis.side, punchSide * scale * 0.22).addScaledVector(basis.up, -scale * 0.08).addScaledVector(basis.forward, scale * 0.08);
        solveArm(punchSide, target, pole);
        const recoverySide = (punchSide * -1) as -1 | 1;
        const recoveryX = recoverySide * 0.16;
        const recoveryPrefix = recoverySide < 0 ? "left" : "right";
        const fallbackOffTarget = visual.root.localToWorld(new THREE.Vector3(recoveryX, layout.shoulderY - 0.07, 0.18));
        const motionOffTarget = retargetQuaterniusPoint(sourceOffHand, hipsWorld, basis, scale, mirrorMotion);
        const offTarget = fallbackOffTarget.lerp(motionOffTarget, 0.58);
        solveArm(recoverySide, offTarget, visual.rig.bones[\`\${recoveryPrefix}Shoulder\`].getWorldPosition(new THREE.Vector3()).addScaledVector(basis.side, recoverySide * scale * 0.20));
`;
fighter = replaceOnce(fighter, oldPunch, newPunch, "punch mocap retarget");

const oldHit = `    } else if (state === "HIT") {
      visual.rig.bones.spineUpper.rotation.z = -0.18;
      visual.head.rotation.z = 0.18;
      visual.leftArm.root.rotation.z = -0.42;
      visual.rightArm.root.rotation.z = 0.42;
`;
const newHit = `    } else if (state === "HIT") {
      const hitPhase = THREE.MathUtils.clamp(fighter.stateMachine.stateTicks / 22, 0, 1);
      const hitSample = sampleQuaterniusMotion("Hit_Chest", hitPhase);
      const hitHead = quaterniusMotionDelta("Hit_Chest", hitPhase, "head");
      visual.rig.bones.spineUpper.rotation.z = -0.18 + hitHead[0] * 1.35;
      visual.rig.bones.spineUpper.rotation.x += -hitHead[2] * 1.20;
      visual.head.rotation.z = 0.18 + hitHead[0] * 1.45;
      visual.leftArm.root.rotation.z = -0.42;
      visual.rightArm.root.rotation.z = 0.42;
      visual.root.updateMatrixWorld(true);
      const hitHipsWorld = visual.rig.bones.hips.getWorldPosition(new THREE.Vector3());
      const leftCurrent = getVisualContactPoint(visual, "LEFT_FIST");
      const rightCurrent = getVisualContactPoint(visual, "RIGHT_FIST");
      const leftSource = retargetQuaterniusPoint(hitSample.leftHand, hitHipsWorld, basis, scale);
      const rightSource = retargetQuaterniusPoint(hitSample.rightHand, hitHipsWorld, basis, scale);
      solveArm(-1, leftCurrent.lerp(leftSource, 0.42), visual.rig.bones.leftShoulder.getWorldPosition(new THREE.Vector3()).addScaledVector(basis.side, -scale * 0.22));
      solveArm(1, rightCurrent.lerp(rightSource, 0.42), visual.rig.bones.rightShoulder.getWorldPosition(new THREE.Vector3()).addScaledVector(basis.side, scale * 0.22));
      solvePlantedFeet();
`;
fighter = replaceOnce(fighter, oldHit, newHit, "hit reaction mocap layer");

const oldKnockdown = `    } else if (state === "KNOCKDOWN" || state === "THROW" || state === "KO" || state === "RING_OUT") {
      visual.root.quaternion.copy(fighterRootQuaternion(fighter.facing));
      visual.root.rotateZ(fighter.facing * THREE.MathUtils.lerp(0, 1.35, Math.min(1, fighter.stateMachine.stateTicks / 22)));
      visual.rig.bones.spineUpper.rotation.z = 0.20;
      visual.head.rotation.z = 0.16;
`;
const newKnockdown = `    } else if (state === "KNOCKDOWN" || state === "THROW" || state === "KO" || state === "RING_OUT") {
      const deathPhase = THREE.MathUtils.clamp(fighter.stateMachine.stateTicks / 72, 0, 1);
      const deathSample = sampleQuaterniusMotion("Death01", deathPhase);
      const deathHead = quaterniusMotionDelta("Death01", deathPhase, "head");
      visual.root.quaternion.copy(fighterRootQuaternion(fighter.facing));
      visual.root.rotateZ(fighter.facing * THREE.MathUtils.lerp(0, 1.35, Math.min(1, fighter.stateMachine.stateTicks / 22)));
      visual.hips.position.y += Math.min(0, deathSample.hipsDelta[1]) * 0.10;
      visual.rig.bones.spineUpper.rotation.z = 0.20 + deathHead[0] * 0.50;
      visual.rig.bones.spineUpper.rotation.x += -deathHead[2] * 0.35;
      visual.head.rotation.z = 0.16 + deathHead[0] * 0.65;
`;
fighter = replaceOnce(fighter, oldKnockdown, newKnockdown, "death mocap layer");

const oldIdle = `    } else {
      visual.torso.rotation.y = Math.sin(timeSeconds * 2.4) * 0.018;
      solvePlantedFeet();
    }
`;
const newIdle = `    } else {
      const idleDuration = motionClipDuration("Idle_Loop");
      const idlePhase = (timeSeconds % idleDuration) / idleDuration;
      const idleSample = sampleQuaterniusMotion("Idle_Loop", idlePhase, true);
      const idleChest = quaterniusMotionDelta("Idle_Loop", idlePhase, "chest", true);
      visual.hips.position.y += idleSample.hipsDelta[1] * 0.20;
      visual.torso.rotation.y = Math.sin(timeSeconds * 2.4) * 0.018 + idleChest[0] * 0.75;
      visual.rig.bones.spineUpper.rotation.x += -idleChest[2] * 0.55;
      solvePlantedFeet();
    }
`;
fighter = replaceOnce(fighter, oldIdle, newIdle, "idle mocap layer");
await write("src/game/fighter.ts", fighter);

const packagePath = "package.json";
const packageJson = JSON.parse(await read(packagePath));
const motionTest = "tests/quaternius-motion.test.ts";
if (!packageJson.scripts["test:rules"].includes(motionTest)) {
  packageJson.scripts["test:rules"] += ` ${motionTest}`;
}
await write(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

const noticePath = "THIRD_PARTY_NOTICES.md";
let notices = await read(noticePath).catch(() => "# Third-Party Notices\n");
if (!notices.includes("## Quaternius Universal Animation Library")) {
  notices += `\n## Quaternius Universal Animation Library\n\n- Author: Quaternius\n- Original library: Universal Animation Library\n- License: Creative Commons Zero v1.0 Universal (CC0-1.0)\n- Deterministic glTF mirror used for import: J-Ponzo/gltf-universal-animation-library\n- Pinned mirror commit: e24c23cf2a1323488a3faa226ea7ea21f644b73e\n- Incorporated form: normalized 30 fps motion trajectories only; no source character mesh, material, or texture is shipped.\n- Imported clips: Idle_Loop, Walk_Loop, Jog_Fwd_Loop, Punch_Jab, Punch_Cross, Hit_Chest, Hit_Head, Death01.\n\nThe imported trajectories are retargeted at runtime to POLY FIGHTER's canonical IK rig. Hit detection remains driven by the game's own deterministic combat data.\n`;
  await write(noticePath, notices);
}

const swPath = "public/sw.js";
let sw = await read(swPath);
if (sw.includes('poly-fighter-v19')) {
  sw = sw.replace('poly-fighter-v19', 'poly-fighter-v20');
  await write(swPath, sw);
}

console.log("Quaternius motion integration applied.");

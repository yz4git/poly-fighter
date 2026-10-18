import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { combatFootCycle, combatStride, LOCOMOTION_DIRECTIONS, smoothMotion } from "./combat-motion-clock";
import { isKineticPunch, punchStrikeSide, samplePunchKineticChain } from "./combat-punch-kinetics";
import type { FighterDefinition } from "./types";
import { isReferenceKick, REFERENCE_KICK_VERSION, sampleReferenceKickChoreography } from "./reference-kick-choreography";
import { authoredMotionEvents } from "./combat-motion-timeline";

type Transform = { position: THREE.Vector3; rotation: THREE.Quaternion };
type Pose = Map<string, Transform>;
type Point = [number, number, number];
type BodyPose = { side?: number; drop?: number; forward?: number; yaw?: number; pitch?: number; roll?: number; chest?: number; leftFoot?: Point; rightFoot?: Point; leftHand?: Point; rightHand?: Point; highGuard?: number };
const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);
const clipCache = new Map<string, Map<string, THREE.AnimationClip>>();

function capture(nodes: Map<string, THREE.Object3D>): Pose {
  return new Map([...nodes].map(([name, bone]) => [name, { position: bone.position.clone(), rotation: bone.quaternion.clone() }]));
}

function restore(nodes: Map<string, THREE.Object3D>, pose: Pose): void {
  for (const [name, value] of pose) {
    const bone = nodes.get(name)!;
    bone.position.copy(value.position);
    bone.quaternion.copy(value.rotation);
  }
}

function worldRotation(bone: THREE.Object3D, rotation: THREE.Quaternion): void {
  const parent = bone.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
  bone.quaternion.copy(parent.invert().multiply(rotation)).normalize();
  bone.updateWorldMatrix(false, true);
}

/** Anatomical bend planes, finite reach and no dependence on imported bone axes. */
export function solveCombatLimb(root: THREE.Object3D, mid: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3): void {
  root.updateWorldMatrix(true, true);
  const a = root.getWorldPosition(new THREE.Vector3());
  const b = mid.getWorldPosition(new THREE.Vector3());
  const c = end.getWorldPosition(new THREE.Vector3());
  const upper = a.distanceTo(b), lower = b.distanceTo(c);
  if (Math.min(upper, lower) < 1e-7) return;
  const direction = target.clone().sub(a);
  const raw = direction.length();
  if (raw < 1e-7) return;
  direction.divideScalar(raw);
  const distance = THREE.MathUtils.clamp(raw, Math.abs(upper - lower) + 1e-5, (upper + lower) * .985);
  const bend = pole.clone().sub(a);
  bend.addScaledVector(direction, -bend.dot(direction));
  if (bend.lengthSq() < 1e-9) bend.crossVectors(direction, Math.abs(direction.y) < .9 ? Y : Z);
  bend.normalize();
  const along = (upper * upper + distance * distance - lower * lower) / (2 * distance);
  const joint = a.clone().addScaledVector(direction, along).addScaledVector(bend, Math.sqrt(Math.max(0, upper * upper - along * along)));
  const q = new THREE.Quaternion().setFromUnitVectors(b.clone().sub(a).normalize(), joint.clone().sub(a).normalize());
  worldRotation(root, q.multiply(root.getWorldQuaternion(new THREE.Quaternion())));
  const nextB = mid.getWorldPosition(new THREE.Vector3());
  const nextC = end.getWorldPosition(new THREE.Vector3());
  const reachable = a.addScaledVector(direction, distance);
  q.setFromUnitVectors(nextC.sub(nextB).normalize(), reachable.sub(nextB).normalize());
  worldRotation(mid, q.multiply(mid.getWorldQuaternion(new THREE.Quaternion())));
}

/**
 * Author directly on each character's bind skeleton, once per body type. This
 * creates ordinary cached clips; gameplay never runs a second correction mixer.
 * The control points use fractions of actual body height, not bone Euler axes.
 */
export function createCombatMotionLibrary(target: THREE.Group, sourceClips: Map<string, THREE.AnimationClip>, definition: FighterDefinition): Map<string, THREE.AnimationClip> {
  // Optional Blender asset packs can arrive in different combinations.
  // A body-only key otherwise reuses an incomplete library with missing
  // imported punches/kicks after a later asset pack becomes available.
  const sourceSignature = [...sourceClips].map(([name, clip]) =>
    `${name}@${clip.duration.toFixed(4)}:${clip.tracks.length}`).sort().join("|");
  const key = `${REFERENCE_KICK_VERSION}:${definition.archetype}:${sourceSignature}`;
  const cached = clipCache.get(key);
  if (cached) return new Map(cached);
  const rig = cloneSkeleton(target) as THREE.Group;
  rig.removeFromParent();
  rig.position.set(0, 0, 0);
  rig.quaternion.identity();
  const nodes = new Map<string, THREE.Object3D>();
  rig.traverse(bone => { if ((bone as THREE.Bone).isBone) nodes.set(bone.name, bone); });
  const required = ["pelvis", "spine_02", "spine_03", "Head", "thigh_l", "thigh_r", "calf_l", "calf_r", "foot_l", "foot_r", "upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r", "hand_l", "hand_r"];
  if (required.some(name => !nodes.has(name))) return new Map();
  const bind = capture(nodes);
  rig.updateMatrixWorld(true);
  const bindWorld = new Map([...nodes].map(([name, bone]) => [name, bone.getWorldQuaternion(new THREE.Quaternion())]));
  // Calibrate on this character's rest skeleton. UBC bone rolls differ between
  // sides; an Euler angle or a world-space foot lock is not an ankle angle.
  const ankleFrames = new Map(["l", "r"].map(suffix => {
    const foot = nodes.get(`foot_${suffix}`)!;
    const calf = nodes.get(`calf_${suffix}`)!;
    const ball = nodes.get(`ball_${suffix}`)!;
    const toe = nodes.get(`ball_leaf_${suffix}`)!;
    const forward = toe.getWorldPosition(new THREE.Vector3()).sub(ball.getWorldPosition(new THREE.Vector3())).normalize();
    const restShin = foot.getWorldPosition(new THREE.Vector3()).sub(calf.getWorldPosition(new THREE.Vector3())).normalize();
    const toeLocal = forward.clone().applyQuaternion(bindWorld.get(`foot_${suffix}`)!.clone().invert()).normalize();
    const restPlane = forward.clone().addScaledVector(restShin, -forward.dot(restShin));
    if (restPlane.lengthSq() < 1e-8) restPlane.crossVectors(restShin, Math.abs(restShin.y) < .9 ? Y : Z);
    restPlane.normalize();
    const flatForward = forward.clone().setY(0).normalize();
    return [suffix, { toeLocal, restPlane, flatForward }] as const;
  }));
  const mixer = new THREE.AnimationMixer(rig);
  const idle = sourceClips.get("Idle_Loop");
  if (!idle) return new Map();
  mixer.clipAction(idle).play();
  mixer.update(0);
  const neutral = capture(nodes);
  rig.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(rig);
  const height = Math.max(.1, bounds.max.y - bounds.min.y);
  const pelvisStart = nodes.get("pelvis")!.getWorldPosition(new THREE.Vector3());
  const footStart = { l: nodes.get("foot_l")!.getWorldPosition(new THREE.Vector3()), r: nodes.get("foot_r")!.getWorldPosition(new THREE.Vector3()) };
  const footQ = { l: nodes.get("foot_l")!.getWorldQuaternion(new THREE.Quaternion()), r: nodes.get("foot_r")!.getWorldQuaternion(new THREE.Quaternion()) };
  const floor = Math.min(footStart.l.y, footStart.r.y);
  const handedness = -Math.sign(footStart.l.x - footStart.r.x) || 1;
  const centerZ = (footStart.l.z + footStart.r.z) / 2;
  const speed = definition.archetype === "SPEED";
  const width = speed ? .084 : .103;
  mixer.stopAllAction();

  const point = ([x, y, z]: Point) => new THREE.Vector3(pelvisStart.x + x * height * handedness, floor + y * height, centerZ + z * height);
  const rotate = (name: string, axis: THREE.Vector3, angle: number) => {
    const bone = nodes.get(name);
    if (bone && angle) worldRotation(bone, new THREE.Quaternion().setFromAxisAngle(axis, angle).multiply(bone.getWorldQuaternion(new THREE.Quaternion())));
  };
  const limb = (suffix: "l" | "r", arm: boolean, goal: Point, pole: Point) => solveCombatLimb(
    nodes.get(`${arm ? "upperarm" : "thigh"}_${suffix}`)!, nodes.get(`${arm ? "lowerarm" : "calf"}_${suffix}`)!, nodes.get(`${arm ? "hand" : "foot"}_${suffix}`)!, point(goal), point(pole),
  );
  const stanceFeet: { l: Point; r: Point } = { l: [-width, 0, .065], r: [width, 0, -.070] };
  const guardHands: { l: Point; r: Point } = { l: [-.088, .735, .172], r: [.083, .756, .125] };

  function body(pose: BodyPose = {}, breath = 0): void {
    restore(nodes, neutral);
    rig.updateMatrixWorld(true);
    const pelvis = nodes.get("pelvis")!;
    const desired = pelvisStart.clone().add(new THREE.Vector3(height * (pose.side ?? 0) * handedness, height * (-.027 + (pose.drop ?? 0) + breath), height * (pose.forward ?? 0)));
    pelvis.position.copy(pelvis.parent!.worldToLocal(desired));
    rig.updateMatrixWorld(true);
    rotate("pelvis", Y, (.10 + (pose.yaw ?? 0)) * handedness);
    rotate("pelvis", X, pose.pitch ?? .025);
    rotate("pelvis", Z, (pose.roll ?? 0) * handedness);
    rotate("spine_02", Y, (-.065 - (pose.yaw ?? 0) * .25) * handedness);
    rotate("spine_03", Y, (-.025 - (pose.yaw ?? 0) * .15) * handedness);
    rotate("spine_02", X, pose.chest ?? .035);
    rotate("spine_03", X, .025 + breath * 2);
    rotate("Head", X, .065);
    rotate("Head", Y, -(pose.yaw ?? 0) * .2 * handedness);
    const high = pose.highGuard ?? 0;
    for (const suffix of ["l", "r"] as const) {
      const sign = suffix === "l" ? -1 : 1;
      const foot = (suffix === "l" ? pose.leftFoot : pose.rightFoot) ?? stanceFeet[suffix];
      limb(suffix, false, foot, [sign * (width + .02), .27, .22]);
      worldRotation(nodes.get(`foot_${suffix}`)!, new THREE.Quaternion().setFromAxisAngle(Y, sign * handedness * .08).multiply(footQ[suffix]));
      const hand = (suffix === "l" ? pose.leftHand : pose.rightHand) ?? guardHands[suffix];
      const handTarget: Point = [hand[0] * (1 - high * .18), hand[1] + high * .037, hand[2] + high * .025];
      rotate(`clavicle_${suffix}`, Y, -sign * .06);
      limb(suffix, true, handTarget, [sign * .18, .59 + high * .025, .075]);
    }
    rig.updateMatrixWorld(true);
  }

  body();
  const ready = capture(nodes);
  const readyPelvis = nodes.get("pelvis")!.getWorldPosition(new THREE.Vector3());
  const readyFeet = new Map(["l", "r"].map(suffix => [suffix, {
    position: nodes.get(`foot_${suffix}`)!.getWorldPosition(new THREE.Vector3()),
    ball: nodes.get(`ball_${suffix}`)!.getWorldPosition(new THREE.Vector3()),
    rotation: nodes.get(`foot_${suffix}`)!.getWorldQuaternion(new THREE.Quaternion()),
    knee: nodes.get(`calf_${suffix}`)!.getWorldPosition(new THREE.Vector3()),
  }]));
  const result = new Map<string, THREE.AnimationClip>();
  function author(name: string, duration: number, sample: (u: number) => void, samples = 25): void {
    const times = Float32Array.from({ length: samples }, (_, i) => i * duration / (samples - 1));
    const values = new Map([...nodes.keys()].map(name => [name, { q: new Float32Array(samples * 4), p: new Float32Array(samples * 3) }]));
    for (let i = 0; i < samples; i++) {
      sample(i / (samples - 1));
      for (const [name, bone] of nodes) {
        const track = values.get(name)!;
        bone.quaternion.normalize().toArray(track.q, i * 4);
        bone.position.toArray(track.p, i * 3);
      }
    }
    const tracks: THREE.KeyframeTrack[] = [];
    for (const [name, value] of values) {
      tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, value.q));
      if (name === "pelvis") tracks.push(new THREE.VectorKeyframeTrack(`${name}.position`, times, value.p));
    }
    result.set(name, new THREE.AnimationClip(name, duration, tracks).optimize());
  }

  author("CM_Ready", speed ? 2.2 : 2.8, u => body({ yaw: Math.sin(u * Math.PI * 2) * .012 }, Math.sin(u * Math.PI * 2) * .0017));
  author("CM_Guard", 2.1, u => body({ highGuard: 1, drop: -.008, chest: .05 }, Math.sin(u * Math.PI * 2) * .001));
  author("CM_Crouch", 2.4, u => body({ highGuard: .7, drop: -.09, chest: .09, leftHand: [-.09, .66, .18], rightHand: [.08, .68, .14] }, Math.sin(u * Math.PI * 2) * .001));
  LOCOMOTION_DIRECTIONS.forEach((direction, i) => {
    const angle = i * Math.PI / 4, dx = Math.sin(angle) * handedness, dz = Math.cos(angle);
    author(`CM_Move_${direction}`, 1, u => {
      const l = combatFootCycle(u), r = combatFootCycle(u + .5);
      const stride = combatStride(speed, dx);
      body({
        drop: -.04 - .008 * Math.cos(u * Math.PI * 4),
        forward: dz * .005,
        yaw: Math.sin(u * Math.PI * 2) * .045,
        roll: -dx * .035,
        leftFoot: [-width + dx * l.travel * stride, l.lift * .045, .065 + dz * l.travel * stride],
        rightFoot: [width + dx * r.travel * stride, r.lift * .045, -.070 + dz * r.travel * stride],
      });
      rotate("foot_l", X, l.roll);
      rotate("foot_r", X, r.roll);
    }, 41);
  });
  for (const [direction, worldX, dz] of [["F", 0, 1], ["B", 0, -1], ["L", -1, 0], ["R", 1, 0]] as const) {
    const dx = worldX * handedness;
    author(`CM_Step_${direction}`, .26, u => {
      const load = Math.sin(Math.PI * u), lead = Math.sin(Math.PI * smoothMotion(u));
      body({ drop: -.045 * load, roll: -dx * .12 * load, pitch: dz * .09 * load, highGuard: .25,
        leftFoot: [-width + dx * .11 * lead, .045 * Math.sin(Math.PI * Math.min(1, u * 1.65)) ** 2, .065 + dz * .12 * lead],
        rightFoot: [width - dx * .065 * lead, .035 * Math.sin(Math.PI * Math.max(0, (u - .3) / .7)) ** 2, -.070 - dz * .08 * lead],
      });
    });
  }
  for (const sign of [-1, 1]) author(`CM_Turn_${sign < 0 ? "L" : "R"}`, .42, u => body({
    yaw: sign * .10 * Math.sin(Math.PI * 2 * u),
    leftFoot: [-width, .02 * Math.sin(Math.PI * Math.min(1, u * 2)) ** 2, .065 + sign * .022 * Math.sin(u * Math.PI * 2)],
    rightFoot: [width, .02 * Math.sin(Math.PI * Math.max(0, u * 2 - 1)) ** 2, -.070 - sign * .022 * Math.sin(u * Math.PI * 2)],
  }));
  author("CM_Block", .28, u => {
    const hit = u < .20 ? smoothMotion(u / .20) : 1 - smoothMotion((u - .20) / .80);
    body({ highGuard: 1, drop: -.014 * hit, pitch: -.055 * hit, chest: .055, forward: -.008 * hit });
  });
  author("CM_Jump", .64, u => {
    const fold = Math.sin(Math.PI * Math.min(.85, u + .12));
    body({ pitch: -.07, drop: 0, leftFoot: [-width, .08 * fold, .13], rightFoot: [width, .12 * fold, -.09], leftHand: [-.12, .72, .13], rightHand: [.12, .76, .12] });
  });
  author("CM_Land", .22, u => body({ drop: -.057 * Math.sin(Math.PI * u), chest: .09 * Math.sin(Math.PI * u), highGuard: .2 }));

  const downPose: BodyPose = { drop: -.39, forward: -.10, pitch: -1.46, chest: .08, yaw: -.10,
    leftFoot: [-.11, .005, .30], rightFoot: [.14, .005, .23], leftHand: [-.24, .025, -.25], rightHand: [.25, .025, -.23] };
  function interpolate(a: BodyPose, b: BodyPose, u: number): BodyPose {
    const out: BodyPose = {};
    for (const name of ["drop", "forward", "yaw", "pitch", "roll", "chest", "highGuard"] as const) {
      const neutralValue = name === "pitch" ? .025 : name === "chest" ? .035 : 0;
      out[name] = THREE.MathUtils.lerp(a[name] ?? neutralValue, b[name] ?? neutralValue, u);
    }
    for (const name of ["leftFoot", "rightFoot", "leftHand", "rightHand"] as const) {
      const fallback = name === "leftFoot" ? stanceFeet.l : name === "rightFoot" ? stanceFeet.r : name === "leftHand" ? guardHands.l : guardHands.r;
      const p = a[name] ?? fallback, q = b[name] ?? fallback;
      out[name] = p.map((value, i) => THREE.MathUtils.lerp(value, q[i], u)) as Point;
    }
    return out;
  }
  author("CM_Down", .48, u => body(interpolate({}, downPose, smoothMotion(u))), 33);
  author("CM_Thrown", .52, u => body(interpolate({ roll: -.12 }, downPose, smoothMotion(u))), 33);
  author("CM_Launch", .48, u => body({ pitch: -.24 - .36 * smoothMotion(u), drop: 0, chest: .10,
    leftFoot: [-.11, .10, .12], rightFoot: [.14, .15, .04], leftHand: [-.21, .65, .09], rightHand: [.22, .70, .08] }));
  author("CM_Wakeup", .55, u => {
    const roll: BodyPose = { ...downPose, drop: -.31, roll: -.40, pitch: -.85, rightHand: [.22, .01, -.12], leftHand: [-.04, .28, -.06] };
    const kneel: BodyPose = { drop: -.15, forward: .025, pitch: .34, chest: .02, rightHand: [.20, .16, .13], leftHand: [-.07, .56, .16], leftFoot: [-width, 0, .10], rightFoot: [width, 0, -.13] };
    body(u < .3 ? interpolate(downPose, roll, smoothMotion(u / .3)) : u < .64 ? interpolate(roll, kneel, smoothMotion((u - .3) / .34)) : interpolate(kneel, {}, smoothMotion((u - .64) / .36)));
  }, 37);
  for (const side of ["L", "R"] as const) author(`CM_Counter_${side}`, .55, u => {
    const sign = side === "L" ? -1 : 1;
    const drive = u < .5 ? smoothMotion(u / .5) : 1 - smoothMotion((u - .5) / .5);
    const reach: Point = [sign * .065, .75, .16 + .27 * drive];
    body({ drop: -.014 * Math.sin(Math.PI * u), forward: .017 * drive, yaw: -sign * .22 * drive, chest: .045, [side === "L" ? "leftHand" : "rightHand"]: reach });
  }, 33);
  author("CM_Throw", .7, u => {
    const grip = u < .5 ? smoothMotion(u / .5) : 1 - smoothMotion((u - .5) / .5);
    const release = Math.sin(Math.PI * Math.max(0, (u - .42) / .58));
    body({ drop: -.045 * grip, yaw: -.32 * release, pitch: .12 * grip,
      leftHand: [-.13 + release * .06, .735 - grip * .08, .172 + grip * .15],
      rightHand: [.12 + release * .06, .756 - grip * .07, .125 + grip * .20] });
  }, 37);

  const referenceAnkles = new Map<string, THREE.Quaternion>();
  function placeReferenceKick(name: string, u: number) {
    const pose = sampleReferenceKickChoreography(name, u, width)!;
    const strike = pose.strike;
    const support = strike === "l" ? "r" : "l";
    const footTarget = [...pose.foot] as Point;
    const rearHand = [...pose.rearHand] as Point;
    const guardHand = [...pose.guardHand] as Point;
    body({
      side: pose.side, forward: pose.forward, drop: pose.drop, yaw: pose.yaw,
      pitch: pose.pitch, roll: pose.roll, chest: pose.chest,
      leftFoot: strike === "l" ? footTarget : undefined,
      rightFoot: strike === "r" ? footTarget : undefined,
      leftHand: strike === "l" ? rearHand : guardHand,
      rightHand: strike === "r" ? rearHand : guardHand,
    });
    // Counterbalance comes from the pelvis and thorax together, while the face
    // stays directed toward the opponent instead of spinning with the hips.
    rotate("Head", Y, -pose.yaw * .40 * handedness);
    rig.updateMatrixWorld(true);
    const thigh = nodes.get(`thigh_${strike}`)!;
    const calf = nodes.get(`calf_${strike}`)!;
    const foot = nodes.get(`foot_${strike}`)!;
    const hip = thigh.getWorldPosition(new THREE.Vector3());
    const knee = calf.getWorldPosition(new THREE.Vector3());
    const ankle = foot.getWorldPosition(new THREE.Vector3());
    const neutralAnkle = foot.getWorldQuaternion(new THREE.Quaternion());
    const length = hip.distanceTo(knee) + knee.distanceTo(ankle);
    const target = point(footTarget);
    const direction = target.clone().sub(hip);
    // A visible, slightly bent contact knee. Limb lengths never change, and a
    // high kick cannot use a nearly straight knee to conceal an unreachable goal.
    if (direction.lengthSq() > 1e-10) {
      const distance = THREE.MathUtils.lerp(direction.length(), length * .94, pose.extension);
      target.copy(hip).add(direction.setLength(Math.min(length * .975, distance)));
    }
    solveCombatLimb(thigh, calf, foot, target, point([...pose.knee] as Point));
    rig.updateMatrixWorld(true);
    return { pose, strike, support, foot, calf, neutralAnkle };
  }

  function authorReferenceKick(name: string, u: number): void {
    let desiredAnkle = referenceAnkles.get(name);
    if (!desiredAnkle) {
      const { strike, foot, calf } = placeReferenceKick(name, authoredMotionEvents(name).contact);
      // Build a complete ankle frame, not just a shin/toe angle. A one-vector
      // correction can satisfy that angle while rolling the boot onto its edge.
      const shin = foot.getWorldPosition(new THREE.Vector3())
        .sub(calf.getWorldPosition(new THREE.Vector3())).normalize();
      const preferredToe = name === "BF_FrontKick_R" || name === "BF_DashKick_R" ? Y : Z;
      const plane = preferredToe.clone().addScaledVector(shin, -preferredToe.dot(shin));
      if (plane.lengthSq() < 1e-8) plane.copy(Z).addScaledVector(shin, -Z.dot(shin));
      plane.normalize();
      const degrees = name === "BF_LowKick_L" ? 60 : name === "BF_RisingKick_R" ? 80 : 100;
      const angle = THREE.MathUtils.degToRad(degrees);
      const toe = shin.clone().multiplyScalar(Math.cos(angle)).addScaledVector(plane, Math.sin(angle)).normalize();
      const right = X.clone().addScaledVector(toe, -X.dot(toe)).normalize();
      const up = new THREE.Vector3().crossVectors(toe, right).normalize();
      const restToe = ankleFrames.get(strike)!.flatForward;
      const restRight = new THREE.Vector3().crossVectors(Y, restToe).normalize();
      const restFrame = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(restRight, Y, restToe));
      const contactFrame = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, toe));
      desiredAnkle = contactFrame.multiply(restFrame.invert()).multiply(bindWorld.get(`foot_${strike}`)!).normalize();
      referenceAnkles.set(name, desiredAnkle);
    }
    // Calibrate on the contact pose once. Reconstructing a frame from the
    // swinging shin every sample flips its bend plane as the folded leg passes
    // vertical. Quaternion blending from the common guard avoids that singularity.
    const { pose, support, foot, neutralAnkle } = placeReferenceKick(name, u);
    worldRotation(foot, neutralAnkle.slerp(desiredAnkle, pose.extension));

    // Rotate about the ball of the planted foot, not the ankle: a turning heel
    // is intentional, a skating toe is not. The unplanted leg remains free.
    const reference = readyFeet.get(support)!;
    const supportFoot = nodes.get(`foot_${support}`)!;
    const pivot = new THREE.Quaternion().setFromAxisAngle(Y, pose.pivot * handedness);
    const ballAnchor = reference.ball.clone();
    const ankleOffset = reference.position.clone().sub(ballAnchor).applyQuaternion(pivot);
    const supportThigh = nodes.get(`thigh_${support}`)!;
    const supportKnee = nodes.get(`calf_${support}`)!;
    solveCombatLimb(supportThigh, supportKnee, supportFoot, ballAnchor.add(ankleOffset), reference.knee);
    worldRotation(supportFoot, pivot.multiply(reference.rotation));
    rig.updateMatrixWorld(true);
  }

  /**
   * Turn the flat imported arm strike into a ground-up movement chain, without
   * inventing a new end-effector trajectory or rewriting hitbox timing.
   *
   * First constrain the baked pelvis root (world movement belongs to gameplay),
   * then wind the hips / trunk / shoulders, replant both feet with anatomical IK,
   * and finally re-solve the hands toward their sampled Blender positions.
   * Guard-arm IK is weaker than strike-hand IK so opponent-facing coverage does
   * not cause a rigid, perfectly static non-striking elbow.
   */
  function bakePunchKinetics(name: string, u: number): void {
    if (!isKineticPunch(name) || u <= 0 || u >= 1) return;
    const motion = samplePunchKineticChain(name, u);
    const striking = punchStrikeSide(name)!;
    const guarding = striking === "l" ? "r" : "l";
    rig.updateMatrixWorld(true);
    const pelvis = nodes.get("pelvis")!;
    const sourcePelvis = pelvis.getWorldPosition(new THREE.Vector3());
    const sourceHands = new Map(["l", "r"].map(suffix => [suffix, nodes.get(`hand_${suffix}`)!.getWorldPosition(new THREE.Vector3())]));
    const sourceElbows = new Map(["l", "r"].map(suffix => [suffix, nodes.get(`lowerarm_${suffix}`)!.getWorldPosition(new THREE.Vector3())]));

    // Prevent punch clip root-motion from duplicating the deterministic arena
    // movement; preserve vertical level changes for body blows and counters.
    const planar = sourcePelvis.clone().sub(readyPelvis).setY(0);
    const limit = height * (name === "BF_Power_R" ? .14 : .105);
    const attenuation = smoothMotion(u / .16) * (1 - smoothMotion((u - .82) / .18));
    const clamp = planar.length() > limit
      ? planar.clone().setLength(limit).sub(planar).multiplyScalar(attenuation)
      : new THREE.Vector3();
    const transfer = new THREE.Vector3(
      motion.comSide * height * handedness,
      motion.comVertical * height,
      motion.comForward * height,
    );
    const translation = clamp.add(transfer);
    if (translation.lengthSq() > 1e-12) {
      pelvis.position.copy(pelvis.parent!.worldToLocal(sourcePelvis.clone().add(translation)));
      rig.updateMatrixWorld(true);
    }

    rotate("pelvis", Y, motion.pelvisYaw * handedness);
    rotate("spine_02", Y, motion.torsoYaw * handedness * .42);
    rotate("spine_03", Y, motion.torsoYaw * handedness * .58);
    rotate("spine_02", X, motion.torsoPitch * .38);
    rotate("spine_03", X, motion.torsoPitch * .62);
    rotate("spine_03", Z, motion.chestRoll * handedness);
    rotate("Head", Y, motion.headCounterYaw * handedness);
    rotate(`clavicle_${striking}`, Y, motion.strikeClavicleYaw * handedness);
    rotate(`clavicle_${guarding}`, Y, motion.guardClavicleYaw * handedness);
    rig.updateMatrixWorld(true);

    // A planted leg may turn on the sole, not slide or collapse into a reverse
    // knee. Both feet remain on the same ground plane through the strike.
    for (const suffix of ["l", "r"] as const) {
      const reference = readyFeet.get(suffix)!;
      const thigh = nodes.get(`thigh_${suffix}`)!;
      const calf = nodes.get(`calf_${suffix}`)!;
      const foot = nodes.get(`foot_${suffix}`)!;
      const target = foot.getWorldPosition(new THREE.Vector3());
      const slide = target.clone().sub(reference.position).setY(0).clampLength(0, height * .035);
      target.copy(reference.position).add(slide);
      const kneePole = calf.getWorldPosition(new THREE.Vector3()).lerp(reference.knee, .30);
      solveCombatLimb(thigh, calf, foot, target, kneePole);
      const pivot = suffix === striking ? motion.stancePivot : -motion.stancePivot * .14;
      worldRotation(foot, new THREE.Quaternion()
        .setFromAxisAngle(Y, pivot * handedness)
        .multiply(reference.rotation));
    }
    rig.updateMatrixWorld(true);

    // Preserve the animators' glove silhouette and original elbow bend plane.
    // A soft end-effector constraint absorbs the extra chest/shoulder torque
    // instead of allowing the imported fist to arc sideways at hit contact.
    for (const suffix of [striking, guarding]) {
      const upper = nodes.get(`upperarm_${suffix}`)!;
      const elbow = nodes.get(`lowerarm_${suffix}`)!;
      const hand = nodes.get(`hand_${suffix}`)!;
      const preserved = sourceHands.get(suffix)!.clone().add(translation);
      const bias = suffix === striking ? motion.contactLock : motion.guardRetention;
      const current = hand.getWorldPosition(new THREE.Vector3());
      const corrected = current.lerp(preserved, bias);
      const pole = sourceElbows.get(suffix)!.clone().add(translation);
      solveCombatLimb(upper, elbow, hand, corrected, pole);
    }
    rig.updateMatrixWorld(true);
  }

  // Kicks use the whole-body target-skeleton choreography above. Existing
  // Blender punches retain their contact paths and share the same guard endpoints.
  for (const [name, source] of sourceClips) {
    if (!name.startsWith("BF_")) continue;
    const sampler = mixer.clipAction(source);
    author(name, source.duration, u => {
      if (isReferenceKick(name)) {
        authorReferenceKick(name, u);
        return;
      }
      restore(nodes, bind);
      sampler.reset().play(); sampler.time = source.duration * u;
      mixer.update(0);
      const sampled = capture(nodes);
      mixer.stopAllAction();
      restore(nodes, sampled);
      const entry = 1 - smoothMotion(u / .24);
      const exit = smoothMotion((u - .75) / .25);
      const weight = Math.max(entry, exit);
      for (const [boneName, reference] of ready) {
        const bone = nodes.get(boneName)!;
        bone.quaternion.slerp(reference.rotation, weight);
        if (boneName === "pelvis") bone.position.lerp(reference.position, weight);
      }
      bakePunchKinetics(name, u);
    }, ["BF_FrontKick_R", "BF_LowKick_L", "BF_RisingKick_R", "BF_DashKick_R"].includes(name) ? 61 : Math.max(3, Math.round(source.duration * 60) + 1));
  }
  // Mirror world-space bind deltas, not raw local Euler angles: UBC's left and
  // right bone frames differ. SERA's left backfist/right body blow now really
  // use the declared striking limb and mirrored support foot.
  for (const [from, to] of [["BF_Backfist_R", "BF_Backfist_L"], ["BF_BodyBlow_L", "BF_BodyBlow_R"]]) {
    const source = sourceClips.get(from);
    if (!source) continue;
    const sampler = mixer.clipAction(source);
    author(to, source.duration, u => {
      restore(nodes, bind);
      sampler.reset().play(); sampler.time = source.duration * u; mixer.update(0);
      rig.updateMatrixWorld(true);
      const world = new Map([...nodes].map(([name, bone]) => [name, bone.getWorldQuaternion(new THREE.Quaternion())]));
      const pelvisPosition = nodes.get("pelvis")!.getWorldPosition(new THREE.Vector3());
      pelvisPosition.x = 2 * pelvisStart.x - pelvisPosition.x;
      mixer.stopAllAction(); restore(nodes, bind); rig.updateMatrixWorld(true);
      for (const [name, bone] of nodes) {
        const opposite = name.endsWith("_l") ? name.slice(0, -2) + "_r" : name.endsWith("_r") ? name.slice(0, -2) + "_l" : name;
        const delta = world.get(opposite)!.clone().multiply(bindWorld.get(opposite)!.clone().invert());
        delta.set(delta.x, -delta.y, -delta.z, delta.w);
        worldRotation(bone, delta.multiply(bindWorld.get(name)!));
        if (name === "pelvis") bone.position.copy(bone.parent!.worldToLocal(pelvisPosition.clone()));
      }
      const weight = Math.max(1 - smoothMotion(u / .24), smoothMotion((u - .75) / .25));
      for (const [name, reference] of ready) {
        nodes.get(name)!.quaternion.slerp(reference.rotation, weight);
        if (name === "pelvis") nodes.get(name)!.position.lerp(reference.position, weight);
      }
      bakePunchKinetics(to, u);
    }, Math.max(3, Math.round(source.duration * 60) + 1));
  }
  mixer.stopAllAction(); mixer.uncacheRoot(rig);
  clipCache.set(key, result);
  return new Map(result);
}


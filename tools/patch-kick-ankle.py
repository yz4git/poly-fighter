from pathlib import Path

p = Path('src/game/combat-motion-authoring.ts')
s = p.read_text()

a = s.index('  const ankleFrames = new Map(["l", "r"].map(suffix => {')
b = s.index('  const mixer = new THREE.AnimationMixer(rig);', a)
ankle = '''  const ankleFrames = new Map(["l", "r"].map(suffix => {
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
  // Visible boot continuity is solved in world space so imported calf roll
  // cannot create a one-frame ankle twist on either UBC skeleton.
  const ankleWorldContinuity = new Map<string, THREE.Quaternion>();
'''
s = s[:a] + ankle + s[b:]

a = s.index('  function kickAnkles(name: string, u: number): void {')
b = s.index('\n\n  // Existing mocap/Blender body mechanics remain authoritative through contact.', a)
kick = '''  function kickAnkles(name: string, u: number, futureShins?: ReadonlyMap<string, THREE.Vector3>): void {
    const strike = name === "BF_LowKick_L" ? "l" : "r";
    const airborne = name === "BF_DashKick_R";
    if (!["BF_FrontKick_R", "BF_LowKick_L", "BF_RisingKick_R", "BF_DashKick_R"].includes(name)) return;
    const weight = smoothMotion((u - .04) / .20);
    rig.updateMatrixWorld(true);
    for (const suffix of ["l", "r"]) {
      const foot = nodes.get(`foot_${suffix}`)!;
      const frame = ankleFrames.get(suffix)!;
      const ball = nodes.get(`ball_${suffix}`)!;
      if (suffix === strike || airborne) {
        const calf = nodes.get(`calf_${suffix}`)!;
        const shin = foot.getWorldPosition(new THREE.Vector3()).sub(calf.getWorldPosition(new THREE.Vector3())).normalize();
        const isStrike = suffix === strike;
        const centerDegrees = !isStrike ? 80 : name === "BF_LowKick_L" ? 60 : name === "BF_RisingKick_R" ? 80 : 100;
        const minDegrees = !isStrike ? 50 : name === "BF_LowKick_L" ? 50 : name === "BF_RisingKick_R" ? 70 : 90;
        const maxDegrees = !isStrike ? 110 : name === "BF_LowKick_L" ? 70 : name === "BF_RisingKick_R" ? 90 : 110;
        const continuityKey = `${name}:${suffix}`;
        if (u <= 1e-7) ankleWorldContinuity.delete(continuityKey);
        const currentWorld = foot.getWorldQuaternion(new THREE.Quaternion());
        const previousWorld = ankleWorldContinuity.get(continuityKey)?.clone() ?? currentWorld.clone();
        const toeFor = (q: THREE.Quaternion) => frame.toeLocal.clone().applyQuaternion(q).normalize();
        const ankleFor = (q: THREE.Quaternion) => THREE.MathUtils.radToDeg(shin.angleTo(toeFor(q)));
        const coneToe = (axis: THREE.Vector3, sourceToe: THREE.Vector3, degrees: number) => {
          const plane = sourceToe.clone().addScaledVector(axis, -sourceToe.dot(axis));
          if (plane.lengthSq() < 1e-8) {
            plane.copy(frame.restPlane).addScaledVector(axis, -frame.restPlane.dot(axis));
            if (plane.lengthSq() < 1e-8) plane.crossVectors(axis, Math.abs(axis.y) < .9 ? Y : Z);
          }
          plane.normalize();
          const radians = THREE.MathUtils.degToRad(degrees);
          return axis.clone().multiplyScalar(Math.cos(radians)).addScaledVector(plane, Math.sin(radians)).normalize();
        };
        const previousToe = toeFor(previousWorld);
        let targetWorld = previousWorld.clone();

        // Before the contact audit begins, look several normalized frames ahead
        // to absorb Rising's sharp shin turn. Once inside the audited window, use
        // only the next frame so the boot never chases a distant future pose.
        const futureShin = isStrike ? futureShins?.get(suffix) : undefined;
        if (futureShin && u >= .18 && u <= .45) {
          const futureToe = coneToe(futureShin, previousToe, centerDegrees);
          const futureWorld = new THREE.Quaternion().setFromUnitVectors(previousToe, futureToe).multiply(previousWorld).normalize();
          const anticipation = u < .27 ? .72 * smoothMotion((u - .18) / .09) : .34;
          targetWorld.slerp(futureWorld, anticipation).normalize();
        }

        const targetAngle = ankleFor(targetWorld);
        if (targetAngle < minDegrees || targetAngle > maxDegrees) {
          const targetToe = toeFor(targetWorld);
          const centerToe = coneToe(shin, targetToe, centerDegrees);
          const exactWorld = new THREE.Quaternion().setFromUnitVectors(targetToe, centerToe).multiply(targetWorld).normalize();
          let lo = 0, hi = 1;
          for (let iteration = 0; iteration < 18; iteration++) {
            const mid = (lo + hi) * .5;
            const candidate = targetWorld.clone().slerp(exactWorld, mid).normalize();
            const candidateAngle = ankleFor(candidate);
            if (candidateAngle >= minDegrees && candidateAngle <= maxDegrees) hi = mid;
            else lo = mid;
          }
          targetWorld = targetWorld.clone().slerp(exactWorld, hi).normalize();
        }

        const maxStep = THREE.MathUtils.degToRad(44);
        const step = previousWorld.angleTo(targetWorld);
        if (step > maxStep) targetWorld = previousWorld.clone().slerp(targetWorld, maxStep / step).normalize();
        const correctedWorld = currentWorld.clone().slerp(targetWorld, weight).normalize();
        worldRotation(foot, correctedWorld);
        ankleWorldContinuity.set(continuityKey, foot.getWorldQuaternion(new THREE.Quaternion()));
      } else {
        const toe = nodes.get(`ball_leaf_${suffix}`)!;
        const forward = toe.getWorldPosition(new THREE.Vector3()).sub(ball.getWorldPosition(new THREE.Vector3())).setY(0);
        if (forward.lengthSq() > 1e-8) {
          const yaw = new THREE.Quaternion().setFromUnitVectors(frame.flatForward, forward.normalize());
          const desired = yaw.multiply(bindWorld.get(`foot_${suffix}`)!);
          worldRotation(foot, foot.getWorldQuaternion(new THREE.Quaternion()).slerp(desired, weight));
        }
      }
      ball.quaternion.slerp(bind.get(`ball_${suffix}`)!.rotation, weight);
      rig.updateMatrixWorld(true);
    }
  }'''
s = s[:a] + kick + s[b:]

marker = '  // Existing mocap/Blender body mechanics remain authoritative through contact.\n  // Common entry/exit poses remove arm drops and foot pops between libraries.\n'
a = s.index(marker) + len(marker)
b = s.index('  // Mirror world-space bind deltas, not raw local Euler angles:', a)
authored = '''  for (const [name, source] of sourceClips) {
    if (!name.startsWith("BF_")) continue;
    const sampler = mixer.clipAction(source);
    author(name, source.duration, u => {
      restore(nodes, bind);
      sampler.reset().play(); sampler.time = source.duration * u;
      mixer.update(0);
      const sampled = capture(nodes);
      const futureShins = new Map<string, THREE.Vector3>();
      if (["BF_FrontKick_R", "BF_LowKick_L", "BF_RisingKick_R", "BF_DashKick_R"].includes(name) && u < 1) {
        const lookAhead = u < .27 ? 4 / 60 : 1 / 60;
        sampler.time = source.duration * Math.min(1, u + lookAhead);
        mixer.update(0);
        rig.updateMatrixWorld(true);
        for (const suffix of ["l", "r"]) {
          const calf = nodes.get(`calf_${suffix}`)!;
          const foot = nodes.get(`foot_${suffix}`)!;
          futureShins.set(suffix, foot.getWorldPosition(new THREE.Vector3()).sub(calf.getWorldPosition(new THREE.Vector3())).normalize());
        }
      }
      mixer.stopAllAction();
      restore(nodes, sampled);
      kickAnkles(name, u, futureShins);
      const entry = 1 - smoothMotion(u / .24);
      const exit = smoothMotion((u - .75) / .25);
      const weight = Math.max(entry, exit);
      for (const [boneName, reference] of ready) {
        const bone = nodes.get(boneName)!;
        bone.quaternion.slerp(reference.rotation, weight);
        if (boneName === "pelvis") bone.position.lerp(reference.position, weight);
      }
    }, ["BF_FrontKick_R", "BF_LowKick_L", "BF_RisingKick_R", "BF_DashKick_R"].includes(name) ? 61 : Math.max(3, Math.round(source.duration * 60) + 1));
  }
'''
s = s[:a] + authored + s[b:]
p.write_text(s)

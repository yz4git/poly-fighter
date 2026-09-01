from pathlib import Path


def rep(path, old, new, label):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"missing patch target: {label}")
    p.write_text(text.replace(old, new, 1))


# Profile coherence + side-sensitive support foot.
p = "src/game/motion-profile.ts"
rep(p, " * Procedural Fight v2 keeps opponent-weighted contact correction intentionally\n * small and moves more of the visible mechanics into generated clips. Generated\n * attacks now include anticipation/impact/settle cadence and center-of-mass\n * motion; heavy attacks and kicks also use generated recovery clips.", " * Procedural Fight v3 is pose-first: authored timing profiles drive a nine-pose\n * graph while runtime support-foot locking, bounded COM solve and target-aware\n * full-body IK preserve believable force transfer. Motion DNA differentiates\n * KAIRO's weight from SERA's lateral speed without changing frame data.", "profile comment")
rep(p, '  version: "MOTION_READABILITY_V2",', '  version: "MOTION_QUALITY_V3",', "profile version")
rep(p, '''export function motionPlantFootForMove(move: MoveDefinition): MoveMotionSpec["plantFoot"] {
  return motionSpecForMove(move).plantFoot;
}''', '''export function motionPlantFootForMove(move: MoveDefinition): MoveMotionSpec["plantFoot"] {
  // Handed variants must mirror their support foot as well as their clip. The
  // support leg stays opposite the striking arm for these rotational punches.
  if (move.id === "backfist" || move.id === "bodyBlow" || move.id === "counter") {
    return move.visualContact?.startsWith("LEFT") ? "RIGHT" : "LEFT";
  }
  return motionSpecForMove(move).plantFoot;
}''', "dynamic plant foot")

# Tests for coherent V3 version and mirrored support feet/DNA.
t = "tests/motion-expansion.test.ts"
rep(t, '  motionClipForMove,\n  motionSpecForMove,', '  motionClipForMove,\n  motionSpecForMove,\n  motionPlantFootForMove,\n  motionDnaForFighter,', "test imports")
rep(t, '  assert.equal(MOTION_EXPANSION_PROFILE.version, "MOTION_READABILITY_V2");', '  assert.equal(MOTION_EXPANSION_PROFILE.version, "MOTION_QUALITY_V3");', "test profile version")
rep(t, '''  assert.equal(motionSpecForMove(kairo.moves.counter).clip, "PF_Counter_L");
  assert.equal(motionSpecForMove(sera.moves.counter).clip, "PF_Counter_L");
});''', '''  assert.equal(motionSpecForMove(kairo.moves.counter).clip, "PF_Counter_L");
  assert.equal(motionSpecForMove(sera.moves.counter).clip, "PF_Counter_L");
  assert.equal(motionPlantFootForMove(kairo.moves.backfist), "LEFT");
  assert.equal(motionPlantFootForMove(sera.moves.backfist), "RIGHT");
  assert.equal(motionPlantFootForMove(kairo.moves.bodyBlow), "RIGHT");
  assert.equal(motionPlantFootForMove(sera.moves.bodyBlow), "LEFT");
  assert.equal(motionPlantFootForMove(kairo.moves.counter), "RIGHT");
  assert.equal(motionPlantFootForMove(sera.moves.counter), "RIGHT");
  assert.equal(motionDnaForFighter(kairo).id, "KAIRO_POWER");
  assert.equal(motionDnaForFighter(sera).id, "SERA_SPEED");
});''', "support foot DNA tests")
rep(t, '`only ${planarClips} v2 clips contain planar root motion`', '`only ${planarClips} v3 clips contain planar root motion`', "v3 test message")

# Real WebGL V3 telemetry and impact-pair probe.
a = "scripts/capture-motion-readability-audit.mjs"
rep(a, '''        balanceVersion: root.userData.motionExpansionBalanceVersion ?? null,
      };''', '''        balanceVersion: root.userData.motionExpansionBalanceVersion ?? null,
        poseGraph: root.userData.motionExpansionPoseGraph ?? null,
        footLockPolicy: root.userData.motionExpansionFootLockPolicy ?? null,
        footLockError: root.userData.motionExpansionFootLockError ?? null,
        comPolicy: root.userData.motionExpansionComPolicy ?? null,
        motionDna: root.userData.motionExpansionMotionDna ?? null,
      };''', "audit telemetry")
rep(a, '''    if (result.contactMode !== "OPPONENT_WEIGHTED_IK") {
      throw new Error(`Motion ${moveId} did not use opponent-weighted strike targeting: ${JSON.stringify(result)}`);
    }
    if (result.balanceVersion !== "FULL_BODY_BALANCE_V3") {
      throw new Error(`Motion ${moveId} did not publish the full-body balance contract: ${JSON.stringify(result)}`);
    }
  }

  const torsoPostures''', '''    if (result.contactMode !== "V3_FULL_BODY_TARGET_IK") {
      throw new Error(`Motion ${moveId} did not use V3 full-body target IK: ${JSON.stringify(result)}`);
    }
    if (result.balanceVersion !== "FULL_BODY_SOLVER_V3") {
      throw new Error(`Motion ${moveId} did not publish the V3 full-body solver contract: ${JSON.stringify(result)}`);
    }
    if (result.poseGraph !== "9_POSE_GRAPH" || result.comPolicy !== "PLANT_WEIGHTED_BOUNDED_COM") {
      throw new Error(`Motion ${moveId} did not publish Pose Graph / COM V3 contracts: ${JSON.stringify(result)}`);
    }
    if (result.motionDna !== "KAIRO_POWER") {
      throw new Error(`KAIRO motion DNA was not active for ${moveId}: ${JSON.stringify(result)}`);
    }
    if (moveId !== "dashKick") {
      if (result.footLockPolicy !== "WORLD_SPACE_SUPPORT_FOOT_IK" || !Number.isFinite(result.footLockError) || result.footLockError > 0.025) {
        throw new Error(`Motion ${moveId} support foot lock drifted: ${JSON.stringify(result)}`);
      }
    }
  }

  const impactPair = await execute(sessionId, `${gameLookup}${resetAndPose}
    const game = findGame();
    resetFighter(game.p1);
    resetFighter(game.p2);
    resetTpsTransient(game);
    game.finished = false;
    game.input.clear();
    game.p1.position.set(0, 0, 0.54);
    game.p2.position.set(0, 0, -0.42);
    game.p1.facing = 1;
    game.p2.facing = -1;
    if (!game.p1.beginMove('power')) return { error: 'power-not-found' };
    let auditTime = performance.now() / 1000;
    let hit = false;
    for (let step = 0; step < 70; step += 1) {
      game.step();
      auditTime += 1 / 60;
      if (game.p2.state === 'HIT' && (game.p1.hitStop > 0 || game.p2.hitStop > 0)) {
        game.updateVisual(game.p1, game.p2, auditTime);
        game.updateVisual(game.p2, game.p1, auditTime + 0.007);
        hit = true;
        break;
      }
      if (game.p1.state !== 'ATTACK') break;
    }
    game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    return {
      hit,
      attackerRole: game.p1.visual.root.userData.motionExpansionImpactPairRole ?? null,
      victimRole: game.p2.visual.root.userData.motionExpansionImpactPairRole ?? null,
      attackerDna: game.p1.visual.root.userData.motionExpansionMotionDna ?? null,
      victimHealth: game.p2.health,
    };
  `);
  await screenshot(sessionId, `${outputDir}/tps-motion-impact-pair.png`);
  if (!impactPair?.hit || impactPair.attackerRole !== "ATTACKER" || impactPair.victimRole !== "VICTIM") {
    throw new Error(`V3 impact-pair pose contract failed: ${JSON.stringify(impactPair)}`);
  }

  const torsoPostures''', "audit contracts and impact pair")
rep(a, '''    kickHeights: { lowY, kickY, risingY },
    moves: results,''', '''    kickHeights: { lowY, kickY, risingY },
    impactPair,
    moves: results,''', "impact diagnostics")

print("Procedural Fight v3 contracts refined")

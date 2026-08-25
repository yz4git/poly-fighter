export async function waitForBlenderRuntime(execute, sessionId, delay, options = {}) {
  const attempts = options.attempts ?? 120;
  const intervalMs = options.intervalMs ?? 100;
  let last = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await execute(sessionId, `
      function findGame() {
        const host = document.querySelector('main.poly-app');
        if (!host) return null;
        const key = Object.keys(host).find((entry) => entry.startsWith('__reactFiber$'));
        let fiber = key ? host[key] : null;
        const visited = new Set();
        while (fiber && !visited.has(fiber)) {
          visited.add(fiber);
          let hook = fiber.memoizedState;
          while (hook) {
            const value = hook.memoizedState;
            const current = value && typeof value === 'object' && 'current' in value ? value.current : null;
            if (current && current.p1 && current.p2 && current.renderer) return current;
            hook = hook.next;
          }
          fiber = fiber.return;
        }
        return null;
      }
      const game = findGame();
      if (!game) return { ready: false, reason: 'game-not-found' };
      const visual = game.p1?.visual;
      return {
        ready: visual?.root?.userData?.blenderRuntimeAssetState === 'ready',
        assetState: visual?.root?.userData?.blenderRuntimeAssetState ?? null,
        pipeline: visual?.root?.userData?.visualPipeline ?? null,
        skinningVersion: visual?.root?.userData?.skinningVersion ?? null,
        metadata: visual?.root?.userData?.blenderRuntimeMetadata ?? null,
        reconstruction: visual?.bodyMesh?.userData?.reconstruction ?? null,
        authoredPieces: visual?.root?.userData?.blenderRuntimeAuthoredPieces ?? null,
      };
    `);
    if (last?.ready) return last;
    if (last?.assetState === "failed") throw new Error(`Blender SERA runtime failed to load: ${JSON.stringify(last)}`);
    await delay(intervalMs);
  }
  throw new Error(`Blender SERA runtime did not become ready: ${JSON.stringify(last)}`);
}

export function assertBlenderRuntimeAuditState(state) {
  if (!state?.ready) throw new Error(`Blender SERA runtime not ready: ${JSON.stringify(state)}`);
  if (state.pipeline !== "BLENDER_CONFORMAL_GLB_CANONICAL_RIG") {
    throw new Error(`Unexpected SERA visual pipeline: ${JSON.stringify(state)}`);
  }
  if (state.skinningVersion !== "SERA_BLENDER_SKIN_V3_PART_AWARE") {
    throw new Error(`Unexpected SERA skinning version: ${JSON.stringify(state)}`);
  }
  if (state.reconstruction !== "blender-conformal-runtime-glb-part-aware") {
    throw new Error(`Blender runtime mesh was not installed: ${JSON.stringify(state)}`);
  }
  if (!state.metadata || state.metadata.maxInfluenceCount > 4 || state.metadata.headLockedVertices <= 0) {
    throw new Error(`Blender runtime metadata is incomplete: ${JSON.stringify(state)}`);
  }
  if (!(state.metadata.rigidAuthoredVertices > 0) || !state.metadata.authoredPartCounts) {
    throw new Error(`SERA authored-part attachments were not preserved: ${JSON.stringify(state)}`);
  }
  if (!(state.authoredPieces > 0)) {
    throw new Error(`SERA runtime GLB did not expose authored pieces: ${JSON.stringify(state)}`);
  }
}

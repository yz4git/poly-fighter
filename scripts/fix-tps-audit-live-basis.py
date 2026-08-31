from pathlib import Path

path = Path("scripts/capture-tps-visual-audit.mjs")
source = path.read_text()

old = '''  // Real-time input probes stay on requestAnimationFrame so they audit the same
  // continuous movement/camera path a player uses in the browser.
  await execute(sessionId, `${gameLookup} const game = findGame(); game.press('right', 'tps-audit-move'); return true;`);
  await delay(420);
  await execute(sessionId, `${gameLookup} const game = findGame(); game.release('right', 'tps-audit-move'); return true;`);
  const afterStrafe = await state(sessionId);
  if (!afterStrafe?.p1 || !initial?.p1 || !initial?.p2) throw new Error(`TPS strafe state missing: ${JSON.stringify({ initial, afterStrafe })}`);
  const initialForwardX = initial.p2.x - initial.p1.x;
  const initialForwardZ = initial.p2.z - initial.p1.z;
  const initialForwardLength = Math.max(1e-5, Math.hypot(initialForwardX, initialForwardZ));
  const initialRightX = -initialForwardZ / initialForwardLength;
  const initialRightZ = initialForwardX / initialForwardLength;
  const strafeDX = afterStrafe.p1.x - initial.p1.x;
  const strafeDZ = afterStrafe.p1.z - initial.p1.z;
  const lateralTravel = Math.abs(strafeDX * initialRightX + strafeDZ * initialRightZ);
  if (lateralTravel < 0.25) {
    throw new Error(`TPS strafe did not move along the lock-relative tangent: ${JSON.stringify({ lateralTravel, initial, afterStrafe })}`);
  }
'''

new = '''  // Real-time input probes stay on requestAnimationFrame so they audit the same
  // continuous movement/camera path a player uses in the browser. Re-sample the
  // live lock basis immediately before input: the tactical CPU continues moving
  // while the iPhone viewport audit runs, so the earlier idle basis is stale.
  const beforeStrafe = await state(sessionId);
  await execute(sessionId, `${gameLookup} const game = findGame(); game.press('right', 'tps-audit-move'); return true;`);
  await delay(420);
  await execute(sessionId, `${gameLookup} const game = findGame(); game.release('right', 'tps-audit-move'); return true;`);
  const afterStrafe = await state(sessionId);
  if (!afterStrafe?.p1 || !beforeStrafe?.p1 || !beforeStrafe?.p2) throw new Error(`TPS strafe state missing: ${JSON.stringify({ beforeStrafe, afterStrafe })}`);
  const initialForwardX = beforeStrafe.p2.x - beforeStrafe.p1.x;
  const initialForwardZ = beforeStrafe.p2.z - beforeStrafe.p1.z;
  const initialForwardLength = Math.max(1e-5, Math.hypot(initialForwardX, initialForwardZ));
  const initialRightX = -initialForwardZ / initialForwardLength;
  const initialRightZ = initialForwardX / initialForwardLength;
  const strafeDX = afterStrafe.p1.x - beforeStrafe.p1.x;
  const strafeDZ = afterStrafe.p1.z - beforeStrafe.p1.z;
  const lateralTravel = Math.abs(strafeDX * initialRightX + strafeDZ * initialRightZ);
  if (lateralTravel < 0.25) {
    throw new Error(`TPS strafe did not move along the live lock-relative tangent: ${JSON.stringify({ lateralTravel, beforeStrafe, afterStrafe })}`);
  }
'''

if source.count(old) != 1:
    raise RuntimeError(f"Expected one TPS realtime strafe probe block, found {source.count(old)}")
path.write_text(source.replace(old, new, 1))
print("Updated TPS realtime strafe audit to use the live lock basis")

import test from "node:test";
import assert from "node:assert/strict";
import {
  combatGaitKneePole, COMBAT_GAIT_KNEE_POLE_VERSION,
} from "../src/game/combat-gait-knee-pole";
import {
  combatFootCycle, combatStride, LOCOMOTION_DIRECTIONS,
} from "../src/game/combat-motion-clock";

test("baked gait knee poles match the original guard geometry at rest", () => {
  assert.equal(COMBAT_GAIT_KNEE_POLE_VERSION, "COMBAT_GAIT_KNEE_POLE_V2_LATERAL_CORRIDOR");
  for (const width of [.084 * .94, .084 * 1.11, .103, .103 * 1.13]) {
    assert.deepEqual(combatGaitKneePole("l", [-width, 0, .065], [-width, 0, .065], width),
      [-width + .004, .27, .22]);
    assert.deepEqual(combatGaitKneePole("r", [width, 0, -.070], [width, 0, -.070], width),
      [width - .004, .27, .22]);
  }
});

test("knee poles follow swing-foot heading without inverting their anatomical side", () => {
  for (const [speed, width] of [[true, .084 * .94], [false, .103 * 1.13]] as const) {
    for (let direction = 0; direction < LOCOMOTION_DIRECTIONS.length; direction++) {
      const angle = direction * Math.PI / 4;
      const dx = Math.sin(angle);
      const dz = Math.cos(angle);
      const stride = combatStride(speed, dx);
      for (let i = 0; i <= 240; i++) {
        const u = i / 240;
        const left = combatFootCycle(u);
        const right = combatFootCycle(u + .5);
        const feet = [
          ["l", -width, .065, left],
          ["r", width, -.070, right],
        ] as const;
        for (const [side, x, z, cycle] of feet) {
          const pole = combatGaitKneePole(side,
            [x + dx * cycle.travel * stride, cycle.lift * .045, z + dz * cycle.travel * stride],
            [x, 0, z], width);
          assert.ok(pole.every(Number.isFinite));
          assert.equal(side === "l" ? pole[0] < 0 : pole[0] > 0, true,
            `${LOCOMOTION_DIRECTIONS[direction]} ${side} pole should not invert`);
          assert.ok(Math.abs(pole[2] - .22) <= .12,
            "knee pole cannot overshoot into a backward-facing bend");
        }
      }
    }
  }
});

test("phase-locked knee steering has no hard seam, sudden knee-pole jump or new foot path", () => {
  const width = .084 * .94;
  for (const dx of [-1, -Math.SQRT1_2, 0, Math.SQRT1_2, 1]) {
    const dz = Math.sqrt(Math.max(0, 1 - dx * dx));
    const stride = combatStride(true, dx);
    let previous: [number, number, number] | null = null;
    for (let step = 0; step <= 600; step++) {
      const u = step / 600;
      const foot = combatFootCycle(u);
      const target: [number, number, number] = [
        -width + dx * foot.travel * stride, foot.lift * .045, .065 + dz * foot.travel * stride,
      ];
      const pole = combatGaitKneePole("l", target, [-width, 0, .065], width);
      if (previous) {
        assert.ok(Math.hypot(pole[0] - previous[0], pole[2] - previous[2]) < .01,
          "knee pole must remain continuous through stance-to-swing");
      }
      previous = pole;
    }
    // The first and last stance-foot samples form one closed loop. Motion
    // blending is handled by the existing 8-way shared gait phase clock.
    const start = combatFootCycle(0);
    const end = combatFootCycle(1);
    assert.equal(start.travel, end.travel);
  }
});

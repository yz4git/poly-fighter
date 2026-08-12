import assert from "node:assert/strict";
import test from "node:test";
import { CommandParser, InputBuffer } from "../src/game/input";
import { FixedStepClock } from "../src/game/fixed";
import { EMPTY_INPUT, type InputFrame } from "../src/game/types";

const input = (patch: Partial<InputFrame>): InputFrame => ({ ...EMPTY_INPUT, ...patch });

test("fixed clock produces the same 60 simulation steps at 30, 60, and 120 render fps", () => {
  const results = [30, 60, 120].map((renderFps) => {
    const clock = new FixedStepClock();
    let steps = 0;
    for (let frame = 0; frame < renderFps; frame += 1) {
      clock.advance(1 / renderFps, () => { steps += 1; });
    }
    return steps;
  });
  assert.deepEqual(results, [60, 60, 60]);
});

test("input buffer parses forward punch and simultaneous buttons", () => {
  const buffer = new InputBuffer();
  buffer.push(input({}));
  buffer.push(input({ right: true }));
  const straight = input({ right: true, punch: true });
  buffer.push(straight);
  assert.equal(CommandParser.parse(straight, buffer, 1), "STRAIGHT");
  assert.equal(CommandParser.parse(input({ punch: true, kick: true }), buffer, 1), "POWER");
});

test("input buffer recognizes low and dash commands without an auto-combo", () => {
  const buffer = new InputBuffer();
  buffer.push(input({}));
  buffer.push(input({ down: true }));
  const lowKick = input({ down: true, kick: true });
  buffer.push(lowKick);
  assert.equal(CommandParser.parse(lowKick, buffer, 1), "LOW_KICK");
  buffer.push(input({ right: true }));
  buffer.push(input({ right: true }));
  const dashKick = input({ right: true, kick: true });
  buffer.push(dashKick);
  assert.equal(CommandParser.parse(dashKick, buffer, 1), "DASH_KICK");
});

test("multitouch action owners keep direction plus simultaneous P, K, and G inputs independent", async () => {
  const { InputSystem } = await import("../src/game/input");
  const inputSystem = new InputSystem();
  inputSystem.press("right", "right-1");
  inputSystem.press("punch", "punch-2");
  inputSystem.press("kick", "kick-3");
  inputSystem.press("guard", "guard-4");
  assert.deepEqual(inputSystem.frame(), input({ right: true, punch: true, kick: true, guard: true }));
  inputSystem.release("punch", "punch-2");
  assert.deepEqual(inputSystem.frame(), input({ right: true, kick: true, guard: true }));
  inputSystem.releaseOwner("right-1");
  assert.equal(inputSystem.frame().right, false);
  inputSystem.clear();
  assert.deepEqual(inputSystem.frame(), EMPTY_INPUT);
  inputSystem.destroy();
});

import assert from "node:assert/strict";
import test from "node:test";
import { CommandParser, InputBuffer } from "../src/game/input";
import { FixedStepClock } from "../src/game/fixed";
import { EMPTY_INPUT, type InputFrame } from "../src/game/types";
import {
  directionToInput,
  quantizeDirection,
  VirtualPadTracker,
  VIRTUAL_PAD_DEADZONE,
} from "../src/game/virtual-pad";

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

test("virtual pad quantizes cardinal, diagonal, and deadzone vectors", () => {
  assert.equal(quantizeDirection(1, 0, 1), "RIGHT");
  assert.equal(quantizeDirection(-1, 0, 1), "LEFT");
  assert.equal(quantizeDirection(0, 1, 1), "UP");
  assert.equal(quantizeDirection(1, 1, 1), "UP_RIGHT");
  assert.equal(quantizeDirection(-1, -1, 1), "DOWN_LEFT");
  assert.equal(quantizeDirection(VIRTUAL_PAD_DEADZONE * 0.5, 0, 1), "NEUTRAL");
  assert.deepEqual(directionToInput("DOWN_LEFT"), input({ down: true, left: true }));
  assert.deepEqual(directionToInput("UP_RIGHT"), input({ up: true, right: true }));
});

test("virtual pad hysteresis prevents boundary chatter and preserves continuous direction changes", () => {
  assert.equal(quantizeDirection(0.92, -0.39, 1, "RIGHT"), "RIGHT");
  assert.equal(quantizeDirection(0.92, -0.39, 1, "RIGHT"), "RIGHT");
  assert.equal(quantizeDirection(0.7, -0.72, 1, "RIGHT"), "DOWN_RIGHT");

  const buffer = new InputBuffer();
  for (const sample of [
    input({ right: true }),
    input({ right: true }),
    input({}),
    input({ down: true, right: true }),
    input({ down: true }),
    input({ down: true, left: true }),
    input({ left: true }),
  ]) buffer.push(sample);
  assert.deepEqual(buffer.directionTransitions(), ["RIGHT", "NEUTRAL", "DOWN_RIGHT", "DOWN", "DOWN_LEFT", "LEFT"]);
});

test("dash accepts two digital taps without requiring a held direction", () => {
  const buffer = new InputBuffer();
  const samples = [input({ right: true }), input({}), input({ right: true })];
  samples.forEach((sample) => buffer.push(sample));
  const dash = input({ right: true, kick: true });
  buffer.push(dash);
  assert.equal(CommandParser.parse(dash, buffer, 1), "DASH_KICK");
});

test("virtual pad pointer ownership supports direction changes and release-to-neutral", () => {
  const pad = new VirtualPadTracker();
  assert.equal(pad.begin(7, 1, 0, 1), "RIGHT");
  assert.equal(pad.move(7, 1, -1, 1), "DOWN_RIGHT");
  assert.equal(pad.move(7, 0, -1, 1), "DOWN");
  assert.equal(pad.move(7, -1, -1, 1), "DOWN_LEFT");
  assert.equal(pad.move(7, -1, 0, 1), "LEFT");
  assert.equal(pad.move(8, 1, 0, 1), "LEFT");
  assert.equal(pad.release(7), "NEUTRAL");
  assert.equal(pad.pointerId, null);
});

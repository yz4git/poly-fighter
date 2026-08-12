import { EMPTY_INPUT, type InputFrame } from "./types";

export type DigitalDirection =
  | "NEUTRAL"
  | "LEFT"
  | "UP_LEFT"
  | "UP"
  | "UP_RIGHT"
  | "RIGHT"
  | "DOWN_RIGHT"
  | "DOWN"
  | "DOWN_LEFT";

export const VIRTUAL_PAD_DEADZONE = 0.2;
export const VIRTUAL_PAD_HYSTERESIS_DEGREES = 6;

const DIRECTION_ORDER: Exclude<DigitalDirection, "NEUTRAL">[] = [
  "UP",
  "UP_RIGHT",
  "RIGHT",
  "DOWN_RIGHT",
  "DOWN",
  "DOWN_LEFT",
  "LEFT",
  "UP_LEFT",
];

function wrapDegrees(value: number): number {
  let result = value % 360;
  if (result > 180) result -= 360;
  if (result < -180) result += 360;
  return result;
}

function directionAngle(direction: Exclude<DigitalDirection, "NEUTRAL">): number {
  return DIRECTION_ORDER.indexOf(direction) * 45;
}

/** Converts a stick vector into one stable digital eight-way direction. */
export function quantizeDirection(
  x: number,
  y: number,
  outerRadius: number,
  previous: DigitalDirection = "NEUTRAL",
  deadzone = VIRTUAL_PAD_DEADZONE,
  hysteresisDegrees = VIRTUAL_PAD_HYSTERESIS_DEGREES,
): DigitalDirection {
  const radius = Math.max(0, outerRadius);
  const magnitude = Math.hypot(x, y);
  if (!Number.isFinite(magnitude) || radius <= 0 || magnitude <= radius * deadzone) return "NEUTRAL";

  // y is intentionally positive toward the top of the pad.  This makes the
  // sector order read like a fighting-game command list: UP, RIGHT, DOWN, LEFT.
  const angle = (Math.atan2(x, y) * 180) / Math.PI;
  const sector = Math.round(angle / 45);
  const candidate = DIRECTION_ORDER[((sector % 8) + 8) % 8] ?? "UP";
  if (previous === "NEUTRAL") return candidate;

  const previousAngle = directionAngle(previous);
  const distanceFromPrevious = Math.abs(wrapDegrees(angle - previousAngle));
  if (distanceFromPrevious <= 22.5 + Math.max(0, hysteresisDegrees)) return previous;
  return candidate;
}

export function directionToInput(direction: DigitalDirection): InputFrame {
  const input = { ...EMPTY_INPUT };
  switch (direction) {
    case "LEFT":
      input.left = true;
      break;
    case "UP_LEFT":
      input.up = true;
      input.left = true;
      break;
    case "UP":
      input.up = true;
      break;
    case "UP_RIGHT":
      input.up = true;
      input.right = true;
      break;
    case "RIGHT":
      input.right = true;
      break;
    case "DOWN_RIGHT":
      input.down = true;
      input.right = true;
      break;
    case "DOWN":
      input.down = true;
      break;
    case "DOWN_LEFT":
      input.down = true;
      input.left = true;
      break;
    case "NEUTRAL":
      break;
  }
  return input;
}

export function directionOfInput(input: Pick<InputFrame, "left" | "right" | "up" | "down">): DigitalDirection {
  const horizontal = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const vertical = (input.up ? 1 : 0) - (input.down ? 1 : 0);
  if (horizontal === 0 && vertical === 0) return "NEUTRAL";
  if (horizontal < 0 && vertical < 0) return "DOWN_LEFT";
  if (horizontal < 0 && vertical > 0) return "UP_LEFT";
  if (horizontal > 0 && vertical < 0) return "DOWN_RIGHT";
  if (horizontal > 0 && vertical > 0) return "UP_RIGHT";
  if (horizontal < 0) return "LEFT";
  if (horizontal > 0) return "RIGHT";
  return vertical > 0 ? "UP" : "DOWN";
}

/** Removes repeated samples while preserving neutral gaps and diagonals. */
export function collapseDirectionTransitions(directions: DigitalDirection[]): DigitalDirection[] {
  return directions.filter((direction, index) => index === 0 || direction !== directions[index - 1]);
}

export function directionVector(direction: DigitalDirection): { x: number; y: number } {
  switch (direction) {
    case "LEFT": return { x: -1, y: 0 };
    case "UP_LEFT": return { x: -0.707, y: 0.707 };
    case "UP": return { x: 0, y: 1 };
    case "UP_RIGHT": return { x: 0.707, y: 0.707 };
    case "RIGHT": return { x: 1, y: 0 };
    case "DOWN_RIGHT": return { x: 0.707, y: -0.707 };
    case "DOWN": return { x: 0, y: -1 };
    case "DOWN_LEFT": return { x: -0.707, y: -0.707 };
    case "NEUTRAL": return { x: 0, y: 0 };
  }
}

/** Pointer ownership and release semantics used by the touch surface. */
export class VirtualPadTracker {
  pointerId: number | null = null;
  direction: DigitalDirection = "NEUTRAL";

  begin(pointerId: number, x: number, y: number, radius: number): DigitalDirection {
    if (this.pointerId !== null) return this.direction;
    this.pointerId = pointerId;
    return this.update(pointerId, x, y, radius);
  }

  move(pointerId: number, x: number, y: number, radius: number): DigitalDirection {
    return this.update(pointerId, x, y, radius);
  }

  release(pointerId: number): DigitalDirection {
    if (this.pointerId !== pointerId) return this.direction;
    this.pointerId = null;
    this.direction = "NEUTRAL";
    return this.direction;
  }

  reset(): void {
    this.pointerId = null;
    this.direction = "NEUTRAL";
  }

  private update(pointerId: number, x: number, y: number, radius: number): DigitalDirection {
    if (this.pointerId !== pointerId) return this.direction;
    this.direction = quantizeDirection(x, y, radius, this.direction);
    return this.direction;
  }
}

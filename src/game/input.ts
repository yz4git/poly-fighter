import {
  cloneInput,
  EMPTY_INPUT,
  type ActionButton,
  type DirectionButton,
  type InputAction,
  type InputFrame,
} from "./types";

type InputOwner = number | string;

export class InputBuffer {
  private readonly maxLength: number;
  private readonly samples: InputFrame[] = [];

  constructor(maxLength = 36) {
    this.maxLength = maxLength;
  }

  push(input: InputFrame): void {
    this.samples.push(cloneInput(input));
    if (this.samples.length > this.maxLength) this.samples.shift();
  }

  latest(): InputFrame {
    return cloneInput(this.samples.at(-1) ?? EMPTY_INPUT);
  }

  previous(): InputFrame {
    return cloneInput(this.samples.at(-2) ?? EMPTY_INPUT);
  }

  wasPressed(button: ActionButton, window = 10): boolean {
    const start = Math.max(0, this.samples.length - window);
    for (let i = start; i < this.samples.length; i += 1) {
      const current = this.samples[i]?.[button] ?? false;
      const previous = this.samples[i - 1]?.[button] ?? false;
      if (current && !previous) return true;
    }
    return false;
  }

  hadDirection(direction: DirectionButton, window = 10): boolean {
    const start = Math.max(0, this.samples.length - window);
    return this.samples.slice(start).some((sample) => sample[direction]);
  }

  consecutiveDirection(direction: DirectionButton, minimum = 2): boolean {
    let count = 0;
    for (let index = this.samples.length - 1; index >= 0; index -= 1) {
      if (!this.samples[index]?.[direction]) break;
      count += 1;
      if (count >= minimum) return true;
    }
    return false;
  }

  clear(): void {
    this.samples.length = 0;
  }
}

export class CommandParser {
  static parse(
    frame: InputFrame,
    buffer: InputBuffer,
    facing: number,
  ): string | null {
    if (frame.punch && frame.kick) return "POWER";
    if (frame.punch && frame.guard) return "COUNTER";
    if (frame.kick && frame.guard) return "THROW";

    const toward: DirectionButton = facing >= 0 ? "right" : "left";
    const back: DirectionButton = facing >= 0 ? "left" : "right";
    if (frame.kick && buffer.consecutiveDirection(toward, 2)) return "DASH_KICK";
    if (frame.punch && buffer.hadDirection(back, 8)) return "BACKFIST";
    if (frame.punch && buffer.hadDirection(toward, 8)) return "STRAIGHT";
    if (frame.punch && frame.down) return "BODY_BLOW";
    if (frame.kick && frame.down) return "LOW_KICK";
    if (frame.kick && frame.up) return "RISING_KICK";
    if (frame.punch) return "PUNCH";
    if (frame.kick) return "KICK";
    return null;
  }
}

export class InputSystem {
  private readonly owners = new Map<InputAction, Set<InputOwner>>();
  private keyboardCleanup: (() => void) | null = null;

  constructor() {
    for (const action of [
      "left",
      "right",
      "up",
      "down",
      "punch",
      "kick",
      "guard",
    ] as InputAction[]) {
      this.owners.set(action, new Set());
    }
  }

  press(action: InputAction, owner: InputOwner): void {
    this.owners.get(action)?.add(owner);
  }

  release(action: InputAction, owner: InputOwner): void {
    this.owners.get(action)?.delete(owner);
  }

  releaseOwner(owner: InputOwner): void {
    for (const entries of this.owners.values()) entries.delete(owner);
  }

  frame(): InputFrame {
    return {
      left: this.isPressed("left"),
      right: this.isPressed("right"),
      up: this.isPressed("up"),
      down: this.isPressed("down"),
      punch: this.isPressed("punch"),
      kick: this.isPressed("kick"),
      guard: this.isPressed("guard"),
    };
  }

  isPressed(action: InputAction): boolean {
    return (this.owners.get(action)?.size ?? 0) > 0;
  }

  attachKeyboard(target: Document = document): () => void {
    const keyMap: Record<string, InputAction> = {
      arrowleft: "left",
      a: "left",
      arrowright: "right",
      d: "right",
      arrowup: "up",
      w: "up",
      arrowdown: "down",
      s: "down",
      j: "punch",
      z: "punch",
      k: "kick",
      x: "kick",
      l: "guard",
      c: "guard",
      " ": "guard",
    };
    const onKey = (event: KeyboardEvent, pressed: boolean) => {
      const action = keyMap[event.key.toLowerCase()];
      if (!action) return;
      event.preventDefault();
      if (pressed) this.press(action, "keyboard");
      else this.release(action, "keyboard");
    };
    const down = (event: KeyboardEvent) => onKey(event, true);
    const up = (event: KeyboardEvent) => onKey(event, false);
    target.addEventListener("keydown", down, { passive: false });
    target.addEventListener("keyup", up, { passive: false });
    this.keyboardCleanup = () => {
      target.removeEventListener("keydown", down);
      target.removeEventListener("keyup", up);
    };
    return this.keyboardCleanup;
  }

  destroy(): void {
    this.keyboardCleanup?.();
    this.keyboardCleanup = null;
    for (const entries of this.owners.values()) entries.clear();
  }
}

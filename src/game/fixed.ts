export class FixedStepClock {
  readonly stepSeconds: number;
  private accumulator = 0;
  totalSteps = 0;

  constructor(stepSeconds = 1 / 60) {
    this.stepSeconds = stepSeconds;
  }

  advance(elapsedSeconds: number, callback: () => void, maxSteps = 8): number {
    this.accumulator += Math.min(0.2, Math.max(0, elapsedSeconds));
    let steps = 0;
    while (this.accumulator >= this.stepSeconds && steps < maxSteps) {
      callback();
      this.accumulator -= this.stepSeconds;
      steps += 1;
      this.totalSteps += 1;
    }
    return steps;
  }

  reset(): void {
    this.accumulator = 0;
  }

  get interpolation(): number {
    return this.accumulator / this.stepSeconds;
  }
}

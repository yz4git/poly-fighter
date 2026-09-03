let enabled = false;

export function motionCorrectionsEnabled(): boolean {
  return enabled;
}

export function setMotionCorrectionsEnabled(next: boolean): void {
  enabled = next;
}

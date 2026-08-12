import type { HitEvent } from "./types";

export class AudioManager {
  private context: AudioContext | null = null;
  private enabled = true;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  async resume(): Promise<void> {
    if (!this.enabled) return;
    this.context ??= new AudioContext();
    if (this.context.state === "suspended") await this.context.resume();
  }

  tone(frequency: number, duration = 0.08, type: OscillatorType = "triangle", gain = 0.05, slide = 0): void {
    if (!this.enabled || !this.context) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, frequency + slide), now + duration);
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(gain, now + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(envelope).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.015);
  }

  impact(event: HitEvent): void {
    if (event.throwEscape) {
      this.tone(280, 0.05, "square", 0.04, 120);
      return;
    }
    if (event.blocked) {
      this.tone(170, 0.06, "square", 0.045, -40);
      this.tone(520, 0.04, "triangle", 0.025, -220);
      return;
    }
    const base = event.move.power > 1.5 ? 86 : event.counter ? 138 : 116;
    this.tone(base, event.move.power > 1.5 ? 0.16 : 0.09, "sawtooth", event.move.power > 1.5 ? 0.08 : 0.055, -base * 0.48);
  }

  roundStart(): void {
    this.tone(392, 0.09, "triangle", 0.05, 55);
    window.setTimeout(() => this.tone(587, 0.12, "triangle", 0.055, 80), 90);
  }

  ko(): void {
    this.tone(94, 0.32, "sawtooth", 0.095, -54);
    window.setTimeout(() => this.tone(48, 0.48, "triangle", 0.08, -20), 110);
  }

  ui(): void {
    this.tone(640, 0.045, "square", 0.035, 90);
  }

  destroy(): void {
    void this.context?.close();
    this.context = null;
  }
}

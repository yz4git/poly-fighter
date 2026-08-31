import type { HitEvent } from "./types";

function impactTier(event: HitEvent): 1 | 2 | 3 {
  const id = event.move.id;
  if (["power", "risingKick", "dashKick", "counter", "backfist"].includes(id) || event.move.power >= 1.6) return 3;
  if (["straight", "lowKick", "bodyBlow", "kick"].includes(id) || event.move.power >= 1.25) return 2;
  return 1;
}

export class AudioManager {
  private context: AudioContext | null = null;
  private enabled = true;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  async resume(): Promise<void> {
    if (!this.enabled) return;
    try {
      const audioWindow = window as Window & { webkitAudioContext?: typeof AudioContext };
      const AudioContextConstructor = window.AudioContext ?? audioWindow.webkitAudioContext;
      if (!AudioContextConstructor) return;
      this.context ??= new AudioContextConstructor();
      if (this.context.state === "suspended") await this.context.resume();
    } catch (error) {
      console.warn("[POLY FIGHTER] audio unavailable", error);
      this.context = null;
    }
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

    const tier = impactTier(event);
    const heavy = tier >= 3;
    const base = heavy ? 78 : event.counter ? 138 : tier === 2 ? 104 : 118;
    const bodyGain = heavy ? 0.09 : tier === 2 ? 0.068 : 0.052;
    const bodyDuration = heavy ? 0.18 : tier === 2 ? 0.12 : 0.085;

    // Body + transient + sub layers make contact readable even on a phone speaker.
    // Higher combo tiers add weight without making every jab sound equally huge.
    this.tone(base, bodyDuration, "sawtooth", bodyGain, -base * (heavy ? 0.58 : 0.46));
    this.tone(heavy ? 56 : tier === 2 ? 68 : 82, heavy ? 0.13 : 0.085, "triangle", heavy ? 0.052 : 0.032, -18);
    this.tone(event.counter ? 920 : heavy ? 760 : 1080, heavy ? 0.038 : 0.026, "square", heavy ? 0.026 : 0.016, heavy ? -260 : -360);

    if (heavy) {
      window.setTimeout(() => this.tone(46, 0.12, "triangle", 0.034, -6), 18);
    }
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

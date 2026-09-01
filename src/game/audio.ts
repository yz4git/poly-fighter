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
  private noiseBuffer: AudioBuffer | null = null;

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
      this.noiseBuffer = null;
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

  private noise(duration: number, gain: number, filterFrequency: number, highpass = false): void {
    if (!this.enabled || !this.context) return;
    const context = this.context;
    if (!this.noiseBuffer || this.noiseBuffer.sampleRate !== context.sampleRate) {
      const length = Math.ceil(context.sampleRate * 0.35);
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const channel = buffer.getChannelData(0);
      let previous = 0;
      for (let index = 0; index < channel.length; index += 1) {
        const white = Math.random() * 2 - 1;
        previous = previous * 0.72 + white * 0.28;
        channel[index] = previous;
      }
      this.noiseBuffer = buffer;
    }

    const now = context.currentTime;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = highpass ? "highpass" : "bandpass";
    filter.frequency.setValueAtTime(filterFrequency, now);
    filter.Q.setValueAtTime(highpass ? 0.7 : 1.5, now);
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(gain, now + 0.004);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(envelope).connect(context.destination);
    source.start(now);
    source.stop(now + duration + 0.01);
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

    this.tone(base, bodyDuration, "sawtooth", bodyGain, -base * (heavy ? 0.58 : 0.46));
    this.tone(heavy ? 56 : tier === 2 ? 68 : 82, heavy ? 0.13 : 0.085, "triangle", heavy ? 0.052 : 0.032, -18);
    this.tone(event.counter ? 920 : heavy ? 760 : 1080, heavy ? 0.038 : 0.026, "square", heavy ? 0.026 : 0.016, heavy ? -260 : -360);

    if (heavy) {
      window.setTimeout(() => this.tone(46, 0.12, "triangle", 0.034, -6), 18);
    }
  }

  /** Extra TPS-only layer: crack + air displacement + sub tail. */
  hypeImpact(event: HitEvent): void {
    if (!this.enabled || !this.context || event.throwEscape) return;
    if (event.blocked) {
      this.noise(0.035, 0.020, 1500, true);
      this.tone(310, 0.032, "square", 0.018, -120);
      return;
    }

    const tier = impactTier(event);
    if (tier === 1) {
      this.noise(0.042, 0.024, 1050, true);
      this.tone(145, 0.055, "triangle", 0.022, -50);
      return;
    }

    if (tier === 2) {
      this.noise(0.060, 0.036, 760, false);
      this.tone(72, 0.105, "triangle", 0.035, -28);
      this.tone(1260, 0.022, "square", 0.014, -620);
      return;
    }

    this.noise(0.090, 0.055, 520, false);
    this.noise(0.040, 0.022, 1800, true);
    this.tone(42, 0.20, "triangle", 0.050, -6);
    this.tone(event.counter ? 1580 : 1320, 0.028, "square", 0.020, -760);
    window.setTimeout(() => this.tone(58, 0.16, "sawtooth", 0.028, -18), 24);
  }

  rush(perfect = false, dash = false): void {
    if (!this.enabled || !this.context) return;
    this.noise(perfect ? 0.11 : dash ? 0.095 : 0.075, perfect ? 0.032 : 0.022, perfect ? 1250 : 980, true);
    this.tone(perfect ? 760 : dash ? 520 : 430, perfect ? 0.085 : 0.065, "triangle", perfect ? 0.026 : 0.018, perfect ? 360 : 210);
  }

  comboShift(stage: number): void {
    if (!this.enabled || !this.context) return;
    const clamped = Math.max(1, Math.min(3, stage));
    this.tone(430 + clamped * 145, 0.045, "square", 0.018 + clamped * 0.004, 130 + clamped * 35);
    if (clamped >= 3) this.noise(0.045, 0.020, 1400, true);
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
    this.noiseBuffer = null;
  }
}

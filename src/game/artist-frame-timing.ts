/** Real callback wall-time sampling for private iPhone Safari artist QA.
 * This is a browser-render cadence indicator, NOT a GPU timestamp query.
 * Never read private user/file data and never persist samples to storage.
 */
export type FrameTimingReport = Readonly<{
  samples: number;
  medianMs: number;
  p95Ms: number;
  over20msPercent: number;
  maxMs: number;
  suspendedFrames: number;
}>;

export class ArtistFrameTimingSampler {
  private readonly samples: number[] = [];
  private lastTimestamp: number | null = null;
  private suspendedFrames = 0;

  record(timestampMs: number, isVisible = true): void {
    if (!Number.isFinite(timestampMs)) return;
    if (!isVisible) {
      this.lastTimestamp = null;
      return;
    }
    const delta = this.lastTimestamp === null ? 0 : timestampMs - this.lastTimestamp;
    this.lastTimestamp = timestampMs;
    if (delta <= 0) return;
    if (delta > 2000) {
      // A tab/background suspension is not a representative render frame;
      // count it explicitly instead of showing a misleading 2+ second P95.
      this.suspendedFrames++;
      return;
    }
    if (this.samples.length >= 240) this.samples.shift();
    this.samples.push(delta);
  }

  snapshot(): FrameTimingReport {
    if (!this.samples.length) {
      return {
        samples: 0, medianMs: 0, p95Ms: 0, maxMs: 0,
        over20msPercent: 0, suspendedFrames: this.suspendedFrames,
      };
    }
    const sorted = [...this.samples].sort((a, b) => a - b);
    const percentile = (fraction: number) =>
      sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))];
    return {
      samples: this.samples.length,
      medianMs: percentile(.5),
      p95Ms: percentile(.95),
      maxMs: sorted[sorted.length - 1],
      over20msPercent: this.samples.filter(ms => ms > 20).length / this.samples.length * 100,
      suspendedFrames: this.suspendedFrames,
    };
  }
}

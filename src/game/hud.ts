import type { HudSnapshot } from "./types";

export class FightHUD {
  private snapshot: HudSnapshot | null = null;
  private listeners = new Set<(snapshot: HudSnapshot) => void>();

  update(snapshot: HudSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }

  current(): HudSnapshot | null {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: HudSnapshot) => void): () => void {
    this.listeners.add(listener);
    if (this.snapshot) listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }
}

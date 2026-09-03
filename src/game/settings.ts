import { setMotionCorrectionsEnabled } from "./motion-correction-state";

export type Quality = "LOW" | "NORMAL" | "HIGH";

export interface Settings {
  quality: Quality;
  cameraShake: boolean;
  audio: boolean;
  vibration: boolean;
  motionCorrections: boolean;
}

const KEY = "poly-fighter-settings-v1";
const DEFAULTS: Settings = {
  quality: "NORMAL",
  cameraShake: true,
  audio: true,
  vibration: true,
  motionCorrections: false,
};

export class SettingsManager {
  private value: Settings = { ...DEFAULTS };

  load(): Settings {
    if (typeof window === "undefined") return { ...this.value };
    try {
      const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Partial<Settings> | null;
      if (parsed) this.value = { ...DEFAULTS, ...parsed };
    } catch {
      this.value = { ...DEFAULTS };
    }
    setMotionCorrectionsEnabled(this.value.motionCorrections);
    return { ...this.value };
  }

  get(): Settings {
    return { ...this.value };
  }

  update(patch: Partial<Settings>): Settings {
    this.value = { ...this.value, ...patch };
    setMotionCorrectionsEnabled(this.value.motionCorrections);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(KEY, JSON.stringify(this.value));
      } catch {
        // Storage is optional in private browsing.
      }
    }
    return { ...this.value };
  }
}

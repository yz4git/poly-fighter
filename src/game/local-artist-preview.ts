/**
 * A transient local GLB for reviewing actual PolyFighter combat motion.
 * Deliberately not stored in IndexedDB, localStorage, cloud or GitHub.
 * This is an UNAPPROVED ARTIST MODEL: no shipping selection or unlock.
 */
let previewUrl: string | null = null;
let previewName = "";

export function registerLocalArtistPreview(file: File): string {
  if (typeof window === "undefined") throw new Error("Local preview needs a browser");
  if (!file.name.toLowerCase().endsWith(".glb") ||
      file.size < 20 || file.size > 32 * 1024 * 1024) {
    throw new Error("A valid game-ready GLB up to 32 MiB is required");
  }
  // Revoke previous object URL. Nothing is uploaded or persisted.
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  previewName = file.name;
  return previewUrl;
}

export function localArtistPreviewUrl(): string | null {
  return previewUrl;
}

export function localArtistPreviewName(): string {
  return previewName;
}

export function releaseLocalArtistPreview(): void {
  if (previewUrl && typeof URL !== "undefined") URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  previewName = "";
}

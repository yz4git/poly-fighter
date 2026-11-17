import * as THREE from "three";

/** Only browser-local artist GLBs are leased. The published SERA fixture and
 * licensed shared game rigs MUST remain cached; releasing those would break
 * other fighters and the model viewer.
 */
export interface ArtistSourceLifetime {
  readonly active: number;
  readonly loaded: number;
  readonly released: number;
  readonly geometriesDisposed: number;
  readonly materialsDisposed: number;
  readonly texturesDisposed: number;
  readonly imageBitmapsClosed: number;
}

const totals = {
  active: 0,
  loaded: 0,
  released: 0,
  geometriesDisposed: 0,
  materialsDisposed: 0,
  texturesDisposed: 0,
  imageBitmapsClosed: 0,
};

export function artistSourceLifetime(): ArtistSourceLifetime {
  return { ...totals };
}

function closeImageBitmap(image: unknown): boolean {
  if (!image || typeof image !== "object" || !("close" in image)) return false;
  const closer = image.close;
  if (typeof closer !== "function") return false;
  try {
    closer.call(image);
    return true;
  } catch {
    // Browser/platform image decoders can retain ownership of an image.
    return false;
  }
}

/**
 * Returns an idempotent release function for exactly ONE GLTFLoader parse.
 *
 * SkeletonUtils.clone() shares geometries and textures with the GLTF scene;
 * therefore release only AFTER the cloned fighter has been removed and its
 * instance-owned materials were disposed. This source is NOT held in a cache.
 *
 * GPU resources, decoder ImageBitmaps and original material objects are all
 * released. Never touch textures on the static published model cache.
 */
export function leaseLocalArtistGlbSource(source: THREE.Object3D): () => void {
  totals.loaded += 1;
  totals.active += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    source.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.geometry) geometries.add(mesh.geometry);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (!material) continue;
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) textures.add(value);
        }
      }
    });
    const closedImages = new Set<object>();
    // Original and cloned GLB materials share the same textures; these can
    // be disposed only when the visual runtime is fully detached.
    for (const texture of textures) {
      texture.dispose();
      totals.texturesDisposed += 1;
      const image = texture.image as unknown;
      if (image && typeof image === "object" && !closedImages.has(image)) {
        closedImages.add(image);
        if (closeImageBitmap(image)) totals.imageBitmapsClosed += 1;
      }
    }
    for (const material of materials) {
      material.dispose();
      totals.materialsDisposed += 1;
    }
    for (const geometry of geometries) {
      geometry.dispose();
      totals.geometriesDisposed += 1;
    }
    source.clear();
    totals.active -= 1;
    totals.released += 1;
  };
}

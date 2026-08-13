import * as THREE from "three";
import type { FighterVisual } from "./visual";

function installReferenceColorMaterial(visual: FighterVisual): void {
  if (visual.root.userData.reconstructionAssetState !== "ready") return;
  if (visual.bodyMesh.userData.v10ColorMaterial === "REFERENCE_VERTEX_COLOR") return;

  const hasVertexColor = Boolean(visual.bodyMesh.geometry.getAttribute("color"));
  if (!hasVertexColor) return;

  const oldMaterial = visual.bodyMesh.material;
  visual.bodyMesh.material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    toneMapped: false,
  });
  if (Array.isArray(oldMaterial)) oldMaterial.forEach((material) => material.dispose());
  else oldMaterial.dispose();
  visual.bodyMesh.userData.v10ColorMaterial = "REFERENCE_VERTEX_COLOR";
  visual.root.userData.colorPipeline = "V10.2_UNLIT_REFERENCE_VERTEX_COLOR";
}

/**
 * V10.2 presentation polish kept deliberately separate from deterministic
 * combat rules and the imported bind pose.
 *
 * The first V10.2 experiment also rotated the reconstructed arm chain at render
 * time. The visual audit proved that even a legal joint rotation can reveal
 * residual cross-limb weights in the single visual-hull surface, so this layer
 * now stays strictly bind-safe: color presentation plus foot-home spacing only.
 */
export function applyV10RuntimePolish(visual: FighterVisual): FighterVisual {
  visual.footContacts.left.homeLocal.z = -0.090;
  visual.footContacts.right.homeLocal.z = 0.100;
  visual.root.userData.authoredNeutralStance = "V10.2_BIND_SAFE";

  const previousBeforeRender = visual.bodyMesh.onBeforeRender;
  visual.bodyMesh.onBeforeRender = function onBeforeRender(...args): void {
    installReferenceColorMaterial(visual);
    previousBeforeRender?.apply(this, args);
  };

  return visual;
}

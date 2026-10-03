import * as THREE from "three";
import type { FighterRuntime } from "./fighter";

export type LegSuffix = "l" | "r";

export type ImportedLeg = {
  thigh: THREE.Object3D;
  calf: THREE.Object3D;
  foot: THREE.Object3D;
};

export function importedRuntimeHost(fighter: FighterRuntime): THREE.Object3D | null {
  return fighter.visual.root.children.find(
    (child) => child.name.startsWith("quaternius-ubc-") && child.name.endsWith("-runtime"),
  ) ?? null;
}

export function importedRuntimeModel(host: THREE.Object3D): THREE.Object3D | null {
  return host.children.find((child) => child.type === "Group" || child.children.length > 0)
    ?? host.children[0]
    ?? null;
}

export function importedLeg(model: THREE.Object3D, suffix: LegSuffix): ImportedLeg | null {
  const thigh = model.getObjectByName(`thigh_${suffix}`);
  const calf = model.getObjectByName(`calf_${suffix}`);
  const foot = model.getObjectByName(`foot_${suffix}`);
  return thigh && calf && foot ? { thigh, calf, foot } : null;
}

export function setWorldQuaternion(object: THREE.Object3D, desiredWorld: THREE.Quaternion): void {
  if (!object.parent) {
    object.quaternion.copy(desiredWorld).normalize();
    return;
  }
  const parentWorld = object.parent.getWorldQuaternion(new THREE.Quaternion());
  object.quaternion.copy(parentWorld.invert().multiply(desiredWorld)).normalize();
}

export function contactSide(contact: string | undefined): -1 | 1 {
  return contact === "LEFT_FOOT" ? -1 : 1;
}

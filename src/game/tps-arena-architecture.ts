import * as THREE from "three";
import { TPS_ARENA_RADIUS } from "./tps-arena-factory";

/**
 * A deliberately open, distant sci-fi arena vault rather than more glowing
 * columns placed around the fighters. One instanced draw for every repeated
 * structural material; all geometry starts well outside the combat ring.
 */
export const TPS_ARCHITECTURE_PROFILE = Object.freeze({
  version: "VAULTED_ARENA_STRUCTURE_V1",
  bays: 24,
  bayRadius: 11.70,
  crownHeight: 5.15,
  deckPlateCount: 40,
  drawGroups: 7,
});

export function tpsArchitectureBay(
  index: number,
  count = TPS_ARCHITECTURE_PROFILE.bays,
  radius = TPS_ARCHITECTURE_PROFILE.bayRadius,
): Readonly<{ x: number; z: number; angle: number }> {
  const angle = (index + 0.5) * (Math.PI * 2 / Math.max(1, count));
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, angle };
}

export function tpsArchitectureIsOutsideFight(x: number, z: number): boolean {
  return Math.hypot(x, z) > TPS_ARENA_RADIUS + 3;
}

type MeshResources = {
  group: THREE.Group;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
};

export function createTpsArenaArchitecture(): MeshResources {
  const group = new THREE.Group();
  group.name = "tps-architectural-vault";
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const profile = TPS_ARCHITECTURE_PROFILE;
  const dummy = new THREE.Object3D();
  const n = profile.bays;
  const r = profile.bayRadius;

  function instanced(
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    count: number,
    place: (index: number, dummy: THREE.Object3D) => void,
  ): THREE.InstancedMesh {
    geometries.push(geometry);
    materials.push(material);
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = name;
    for (let i = 0; i < count; i++) {
      dummy.position.set(0, 0, 0);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      place(i, dummy);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    return mesh;
  }

  const darkSteel = new THREE.MeshStandardMaterial({
    color: 0x142838, roughness: .56, metalness: .46,
    emissive: 0x06121f, emissiveIntensity: .55,
    side: THREE.DoubleSide,
  });
  instanced(
    "tps-vault-uprights",
    new THREE.BoxGeometry(.26, 4.20, .28),
    darkSteel,
    n,
    (i, d) => {
      const p = tpsArchitectureBay(i);
      d.position.set(p.x, 2.36, p.z);
      d.rotation.y = -p.angle;
    },
  );

  const buttress = new THREE.MeshStandardMaterial({
    color: 0x1c3649, roughness: .45, metalness: .42,
    emissive: 0x081f2d, emissiveIntensity: .45,
  });
  instanced(
    "tps-vault-angled-braces",
    new THREE.BoxGeometry(.11, 2.95, .15),
    buttress,
    n * 2,
    (i, d) => {
      const p = tpsArchitectureBay(Math.floor(i / 2));
      const sign = i % 2 === 0 ? -1 : 1;
      const tangentX = -Math.sin(p.angle);
      const tangentZ = Math.cos(p.angle);
      d.position.set(p.x + tangentX * sign * .40, 3.30, p.z + tangentZ * sign * .40);
      d.rotation.order = "YXZ";
      d.rotation.y = -p.angle;
      d.rotation.z = sign * .25;
    },
  );

  const windowMaterial = new THREE.MeshStandardMaterial({
    color: 0x102b42, roughness: .36, metalness: .57,
    emissive: 0x0a3148, emissiveIntensity: .58,
    transparent: true, opacity: .58, depthWrite: false,
    side: THREE.DoubleSide,
  });
  instanced(
    "tps-vault-inset-windows",
    new THREE.BoxGeometry(1.35, .72, .075),
    windowMaterial,
    n,
    (i, d) => {
      const p = tpsArchitectureBay(i, n, r + .09);
      d.position.set(p.x, 3.64, p.z);
      d.rotation.y = -p.angle;
    },
  );

  const lumen = new THREE.MeshBasicMaterial({
    color: 0x5bd7e3, transparent: true, opacity: .46,
    depthWrite: false, side: THREE.DoubleSide,
  });
  instanced(
    "tps-vault-bay-lumens",
    new THREE.BoxGeometry(.055, 2.25, .055),
    lumen,
    n,
    (i, d) => {
      const p = tpsArchitectureBay(i, n, r - .20);
      d.position.set(p.x, 2.94, p.z);
      d.rotation.y = -p.angle;
    },
  );

  // The continuous upper cornice makes the arena read as an enclosed place
  // with a roof volume. It is far above the gameplay actors and lock-on camera.
  const crownGeometry = new THREE.CylinderGeometry(r + .30, r + .30, .38, 96, 1, true);
  const crownMaterial = new THREE.MeshStandardMaterial({
    color: 0x142c3f, roughness: .41, metalness: .52,
    emissive: 0x0b293b, emissiveIntensity: .5,
    side: THREE.DoubleSide,
  });
  const crown = new THREE.Mesh(crownGeometry, crownMaterial);
  crown.name = "tps-vault-cornice";
  crown.position.y = 5.03;
  group.add(crown);
  geometries.push(crownGeometry);
  materials.push(crownMaterial);

  const rimGeometry = new THREE.TorusGeometry(r + .30, .045, 5, 96);
  const rimMaterial = new THREE.MeshBasicMaterial({
    color: 0x76d7e9, transparent: true, opacity: .48,
    depthWrite: false,
  });
  const rim = new THREE.Mesh(rimGeometry, rimMaterial);
  rim.name = "tps-vault-crown-light";
  rim.position.y = profile.crownHeight;
  rim.rotation.x = Math.PI / 2;
  group.add(rim);
  geometries.push(rimGeometry);
  materials.push(rimMaterial);

  // Floor facets make foreground depth legible in a moving shoulder camera,
  // but avoid the central combat circle and are only 2 cm above the floor.
  const deckMaterial = new THREE.MeshStandardMaterial({
    color: 0x142a3a, metalness: .38, roughness: .47,
    emissive: 0x081c2c, emissiveIntensity: .40,
  });
  instanced(
    "tps-vault-floor-facets",
    new THREE.BoxGeometry(.82, .012, 1.35),
    deckMaterial,
    profile.deckPlateCount,
    (i, d) => {
      const p = tpsArchitectureBay(i, profile.deckPlateCount, 5.35);
      d.position.set(p.x, .008, p.z);
      d.rotation.y = -p.angle;
      d.scale.set(i % 3 === 0 ? .76 : 1, 1, 1);
    },
  );

  group.userData.tpsArchitectureVersion = profile.version;
  group.userData.tpsArchitectureBays = n;
  group.userData.tpsArchitectureDrawGroups = profile.drawGroups;
  group.userData.tpsArchitectureMinimumSceneryRadius = r - .20;
  group.userData.tpsArchitectureDeckCount = profile.deckPlateCount;
  return { group, geometries, materials };
}

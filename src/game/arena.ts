import * as THREE from "three";

export interface ArenaBounds {
  x: number;
  z: number;
}

function material(color: number, options: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: 0.5,
    metalness: 0.22,
    ...options,
  });
}

function addMesh(group: THREE.Group, geometry: THREE.BufferGeometry, mat: THREE.Material, name: string, position?: THREE.Vector3): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (position) mesh.position.copy(position);
  group.add(mesh);
  return mesh;
}

export class Arena {
  readonly group = new THREE.Group();
  readonly bounds: ArenaBounds = { x: 6.25, z: 3.55 };
  private readonly disposables: Array<THREE.BufferGeometry | THREE.Material> = [];

  constructor() {
    this.group.name = "high-poly-future-arena";
    this.buildFloor();
    this.buildArchitecture();
    this.buildRingRails();
  }

  private buildFloor(): void {
    const floor = new THREE.Group();
    floor.name = "triangulated-floor";
    const tileSize = 0.78;
    const columns = 18;
    const rows = 10;
    const palette = [0x263244, 0x314157, 0x3d4f65, 0x202a3a, 0x516275];
    for (let x = -columns / 2; x < columns / 2; x += 1) {
      for (let z = -rows / 2; z < rows / 2; z += 1) {
        const geometry = new THREE.PlaneGeometry(tileSize, tileSize, 1, 1);
        geometry.rotateX(-Math.PI / 2);
        this.disposables.push(geometry);
        const tile = addMesh(
          floor,
          geometry,
          material(palette[(x * 3 + z * 5 + 200) % palette.length], { roughness: 0.62 }),
          "floor-tile",
          new THREE.Vector3(x * tileSize, -0.05, z * tileSize),
        );
        tile.rotation.y = (x + z) % 2 === 0 ? 0 : Math.PI / 2;
      }
    }
    const center = addMesh(
      floor,
      new THREE.RingGeometry(1.25, 1.38, 8),
      material(0x6a7f99, { emissive: 0x182a40, emissiveIntensity: 0.45 }),
      "center-octagon",
      new THREE.Vector3(0, 0.012, 0),
    );
    center.rotation.x = -Math.PI / 2;
    this.group.add(floor);
  }

  private buildRingRails(): void {
    const rails = new THREE.Group();
    rails.name = "ring-out-rails";
    const glow = new THREE.MeshStandardMaterial({
      color: 0x59e7ff,
      emissive: 0x1c8ca8,
      emissiveIntensity: 2.1,
      flatShading: true,
      roughness: 0.28,
      metalness: 0.45,
    });
    const railGeo = new THREE.BoxGeometry(0.08, 0.16, this.bounds.z * 2);
    this.disposables.push(railGeo, glow);
    for (const x of [-this.bounds.x, this.bounds.x]) {
      addMesh(rails, railGeo, glow, "ring-rail-x", new THREE.Vector3(x, 0.08, 0));
    }
    const railDepthGeo = new THREE.BoxGeometry(this.bounds.x * 2, 0.16, 0.08);
    this.disposables.push(railDepthGeo);
    for (const z of [-this.bounds.z, this.bounds.z]) {
      addMesh(rails, railDepthGeo, glow, "ring-rail-z", new THREE.Vector3(0, 0.08, z));
    }
    this.group.add(rails);
  }

  private buildArchitecture(): void {
    const architecture = new THREE.Group();
    architecture.name = "distant-future-architecture";
    const pale = material(0x788fa8, { roughness: 0.68 });
    const pale2 = material(0x526c89, { roughness: 0.6 });
    const blue = material(0x263f67, { emissive: 0x10254a, emissiveIntensity: 0.8 });
    const red = material(0x8b2642, { emissive: 0x3b0d22, emissiveIntensity: 1.1 });
    this.disposables.push(pale, pale2, blue, red);
    const towers = [
      { x: -8.8, z: -2.6, h: 5.6, r: 0.75, mat: pale },
      { x: -7.2, z: -4.4, h: 4.2, r: 0.55, mat: pale2 },
      { x: 8.6, z: -3.1, h: 5.2, r: 0.8, mat: pale },
      { x: 7.1, z: -4.8, h: 4.4, r: 0.6, mat: pale2 },
      { x: -4.7, z: -6, h: 3.6, r: 0.52, mat: blue },
      { x: 4.9, z: -6.4, h: 3.8, r: 0.6, mat: blue },
    ];
    for (const tower of towers) {
      const geometry = new THREE.CylinderGeometry(tower.r * 0.62, tower.r, tower.h, 8, 3);
      this.disposables.push(geometry);
      addMesh(
        architecture,
        geometry,
        tower.mat,
        "future-tower",
        new THREE.Vector3(tower.x, tower.h / 2 - 0.1, tower.z),
      );
      const cap = new THREE.OctahedronGeometry(tower.r * 1.35, 1);
      this.disposables.push(cap);
      addMesh(
        architecture,
        cap,
        tower.mat,
        "tower-cap",
        new THREE.Vector3(tower.x, tower.h + 0.22, tower.z),
      ).scale.y = 0.7;
    }
    const gate = new THREE.Group();
    gate.name = "central-portal";
    const pillarGeometry = new THREE.BoxGeometry(0.42, 4.8, 0.42);
    const beamGeometry = new THREE.BoxGeometry(5.2, 0.38, 0.42);
    this.disposables.push(pillarGeometry, beamGeometry);
    addMesh(gate, pillarGeometry, pale, "portal-pillar-left", new THREE.Vector3(-2.25, 2.05, -5.2));
    addMesh(gate, pillarGeometry, pale, "portal-pillar-right", new THREE.Vector3(2.25, 2.05, -5.2));
    addMesh(gate, beamGeometry, red, "portal-beam", new THREE.Vector3(0, 4.3, -5.2));
    const portal = addMesh(
      gate,
      new THREE.RingGeometry(1.2, 1.34, 6),
      new THREE.MeshBasicMaterial({ color: 0xff405d, transparent: true, opacity: 0.78 }),
      "portal-ring",
      new THREE.Vector3(0, 2.55, -5.0),
    );
    portal.rotation.y = Math.PI / 2;
    this.group.add(architecture, gate);
  }

  isOut(position: THREE.Vector3): boolean {
    return Math.abs(position.x) > this.bounds.x || Math.abs(position.z) > this.bounds.z;
  }

  dispose(): void {
    for (const resource of this.disposables) resource.dispose();
    this.group.clear();
  }
}

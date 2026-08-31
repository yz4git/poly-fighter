import * as THREE from "three";
import { FighterRuntime } from "./fighter";

export class FightCamera {
  private shake = 0;
  private readonly target = new THREE.Vector3();

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  addShake(amount: number): void {
    this.shake = Math.min(0.35, this.shake + amount);
  }

  update(p1: FighterRuntime, p2: FighterRuntime, deltaSeconds: number): void {
    const midX = (p1.position.x + p2.position.x) * 0.5;
    const midZ = (p1.position.z + p2.position.z) * 0.5;
    const separation = Math.hypot(p1.position.x - p2.position.x, p1.position.z - p2.position.z);

    // Real-WebGL playtest pass: move the baseline composition about 8-10%
    // closer.  Both fighters remain visible at maximum practical separation,
    // but the characters now dominate the screen instead of the empty floor.
    const desiredZ = 7.55 + Math.min(3.45, separation * 0.54);
    const desiredY = 2.95 + Math.min(1.0, separation * 0.09);
    this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, midX, 5.8, deltaSeconds);
    this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, desiredY, 5.8, deltaSeconds);
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, desiredZ, 5.8, deltaSeconds);
    const targetY = THREE.MathUtils.clamp(
      1.46 + Math.max(p1.position.y, p2.position.y) * 0.24,
      1.28,
      2.02,
    );
    this.target.set(midX, targetY, midZ * 0.18);
    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.65;
      this.shake *= 0.84;
    } else {
      this.shake = 0;
    }
    this.camera.lookAt(this.target);
  }
}

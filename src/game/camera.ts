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

    // The first deployed V9 screenshot framed the fighters at only ~40% of the
    // viewport height. The visual reference is a much tighter arcade-fighter
    // composition, so keep both players in frame while making the characters
    // the dominant shapes rather than distant figures in a large arena.
    const desiredZ = 8.1 + Math.min(3.6, separation * 0.62);
    const desiredY = 3.15 + Math.min(1.10, separation * 0.10);
    this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, midX, 5.5, deltaSeconds);
    this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, desiredY, 5.5, deltaSeconds);
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, desiredZ, 5.5, deltaSeconds);
    const targetY = THREE.MathUtils.clamp(
      1.52 + Math.max(p1.position.y, p2.position.y) * 0.24,
      1.32,
      2.08,
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

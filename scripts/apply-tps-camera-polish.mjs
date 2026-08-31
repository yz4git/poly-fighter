import { readFile, writeFile } from "node:fs/promises";

const path = "src/game/tps-game.ts";
let source = await readFile(path, "utf8");

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`Missing ${label}`);
  source = source.replace(before, after);
}

replaceOnce(
  "  private finished = false;\n  private lastHudTick = -1;",
  '  private finished = false;\n  private resultWinner: "p1" | "p2" | "draw" | null = null;\n  private lastHudTick = -1;',
  "result winner state",
);

replaceOnce(
  `  private updateCamera(delta: number): void {
    const forward = horizontalDirection(this.p1.position, this.p2.position);
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    this.cameraTarget.copy(this.p1.position).addScaledVector(forward, 1.7).add(new THREE.Vector3(0, 1.16, 0));
    this.cameraDesired.copy(this.p1.position)
      .addScaledVector(forward, -4.75)
      .addScaledVector(right, 0.58)
      .add(new THREE.Vector3(0, 2.65, 0));
    ease(this.camera.position, this.cameraDesired, 9.5, delta);
    this.camera.lookAt(this.cameraTarget);
  }`,
  `  private updateCamera(delta: number): void {
    const forward = horizontalDirection(this.p1.position, this.p2.position);
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    // A true over-the-shoulder composition: keep the locked opponent near the
    // center while the player occupies the lower-left third instead of hiding
    // the target directly behind their torso.
    this.cameraTarget.copy(this.p2.position).add(new THREE.Vector3(0, 1.22, 0));
    this.cameraDesired.copy(this.p1.position)
      .addScaledVector(forward, -5.35)
      .addScaledVector(right, 1.62)
      .add(new THREE.Vector3(0, 2.42, 0));
    ease(this.camera.position, this.cameraDesired, 9.5, delta);
    this.camera.lookAt(this.cameraTarget);
  }`,
  "over-shoulder camera",
);

replaceOnce(
  `    this.finished = true;
    this.input.clear();
    const winner = this.p1.health === this.p2.health ? "draw" : this.p1.health > this.p2.health ? "p1" : "p2";
    this.audio.ko();`,
  `    this.finished = true;
    this.input.clear();
    const winner = this.p1.health === this.p2.health ? "draw" : this.p1.health > this.p2.health ? "p1" : "p2";
    this.resultWinner = winner;
    this.publishHud(true);
    this.audio.ko();`,
  "result winner publish",
);

replaceOnce(
  `    this.enemyCooldown = 52;
    this.timerTicks = ROUND_TICKS;`,
  `    this.enemyCooldown = 52;
    this.timerTicks = ROUND_TICKS;
    this.resultWinner = null;`,
  "result reset",
);

replaceOnce(
  `    const forward = horizontalDirection(this.p1.position, this.p2.position);
    this.camera.position.copy(this.p1.position).addScaledVector(forward, -4.75).add(new THREE.Vector3(0.6, 2.65, 0));
    this.updateCamera(1);`,
  `    const forward = horizontalDirection(this.p1.position, this.p2.position);
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    this.camera.position.copy(this.p1.position)
      .addScaledVector(forward, -5.35)
      .addScaledVector(right, 1.62)
      .add(new THREE.Vector3(0, 2.42, 0));
    this.updateCamera(1);`,
  "initial camera",
);

replaceOnce(
  `      p1Wins: 0,
      p2Wins: 0,`,
  `      p1Wins: this.resultWinner === "p1" ? 1 : 0,
      p2Wins: this.resultWinner === "p2" ? 1 : 0,`,
  "result score",
);

await writeFile(path, source);
console.log("Applied TPS over-shoulder camera and result scoring polish");

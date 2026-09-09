import * as THREE from "three";
import { TpsGraphicsDirector } from "./tps-graphics";
import type { HitEvent } from "./types";

type ImpactWaveRuntime = {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  life: number;
  maxLife: number;
  baseOpacity: number;
};

type GraphicsRuntime = {
  waves?: ImpactWaveRuntime[];
  group: THREE.Group;
};

let installed = false;

function retirePreviousImpactWaves(graphics: GraphicsRuntime): number {
  let retired = 0;
  for (const wave of graphics.waves ?? []) {
    if (wave.life <= 0 && !wave.mesh.visible) continue;
    wave.life = 0;
    wave.maxLife = 0;
    wave.baseOpacity = 0;
    wave.mesh.visible = false;
    wave.mesh.material.opacity = 0;
    retired += 1;
  }
  return retired;
}

export function installTpsLatestImpactWavePresentation(): void {
  if (installed) return;
  installed = true;

  const baseHit = TpsGraphicsDirector.prototype.hit;
  TpsGraphicsDirector.prototype.hit = function hitWithLatestImpactWave(
    event: HitEvent,
    camera: THREE.Camera,
  ): void {
    const runtime = this as unknown as GraphicsRuntime;

    // TpsHypeDirector already retires its previous impact ring before authoring
    // the next contact. Mirror that policy for the lower shared graphics wave
    // pool so fast combo hits do not accumulate several small rings around the
    // fighters. This runs before the normal hit authoring, so the current hit's
    // light/medium/heavy wave count remains untouched (including heavy 2-ring
    // contacts and FINAL IMPACT presentation layered later in the frame).
    const retired = retirePreviousImpactWaves(runtime);
    baseHit.call(this, event, camera);

    this.group.userData.lastRetiredGraphicsImpactWaves = retired;
    this.group.userData.latestImpactWavePolicy = "LATEST_CONTACT";
  };
}

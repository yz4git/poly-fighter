import * as THREE from "three";
import type { FighterDefinition } from "./types";
import type { FighterModelId } from "./model-skins";
import {
  createFighterVisual,
  disposeFighterVisual,
  type FighterVisual,
  type FighterVisualQuality,
} from "./visual-entry";

export interface ModelViewerOptions {
  definition: FighterDefinition;
  quality?: FighterVisualQuality;
  modelId?: FighterModelId;
  onFallback?: (message: string) => void;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

export class ModelViewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly visual: FighterVisual;

  private readonly mount: HTMLElement;
  private readonly pointers = new Map<number, THREE.Vector2>();
  private readonly target = new THREE.Vector3();
  private readonly floor = new THREE.Group();
  private raf = 0;
  private running = false;
  private lastTime = 0;
  private yaw = 0.34;
  private pitch = 0.055;
  private distance = 6;
  private fitDistance = 6;
  private previousPinch = 0;
  private userMoved = false;
  private runtimeState = "";

  constructor(mount: HTMLElement, options: ModelViewerOptions) {
    this.mount = mount;
    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: options.quality !== "LOW",
        alpha: false,
        powerPreference: "high-performance",
        failIfMajorPerformanceCaveat: false,
      });
    } catch (error) {
      options.onFallback?.("MODEL VIEWのWebGLを初期化できませんでした。");
      throw error;
    }

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050d19);
    this.scene.fog = new THREE.Fog(0x050d19, 9, 28);
    this.camera = new THREE.PerspectiveCamera(29, 1, 0.04, 80);

    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = false;
    const qualityDpr = options.quality === "LOW" ? 1 : options.quality === "HIGH" ? 1.9 : 1.45;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, qualityDpr));
    this.renderer.domElement.setAttribute("aria-label", `${options.definition.name} interactive 3D model viewer`);
    this.renderer.domElement.style.touchAction = "none";
    this.renderer.domElement.style.cursor = "grab";
    this.mount.replaceChildren(this.renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xcde8ff, 0x09101e, 2.35);
    const key = new THREE.DirectionalLight(0xffffff, 3.7);
    key.position.set(-4.5, 7.5, 6.5);
    const rim = new THREE.DirectionalLight(0x60d9ff, 2.8);
    rim.position.set(5.5, 3.0, -6.0);
    const fill = new THREE.DirectionalLight(0xff6386, 0.9);
    fill.position.set(-5, 2, -4);
    this.scene.add(hemi, key, rim, fill);

    this.visual = createFighterVisual(options.definition, options.quality ?? "NORMAL", options.modelId ?? "ORIGINAL");
    this.scene.add(this.visual.root);
    this.createFloor(options.definition.colors.primary);
    this.fitModel(true);
    this.runtimeState = String(this.visual.root.userData.blenderRuntimeAssetState ?? "static");

    this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown);
    this.renderer.domElement.addEventListener("pointermove", this.onPointerMove);
    this.renderer.domElement.addEventListener("pointerup", this.onPointerEnd);
    this.renderer.domElement.addEventListener("pointercancel", this.onPointerEnd);
    this.renderer.domElement.addEventListener("lostpointercapture", this.onPointerEnd);
    this.renderer.domElement.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("resize", this.resize);
    window.addEventListener("orientationchange", this.resize);
    this.resize();
  }

  private createFloor(accent: number): void {
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(2.65, 48),
      new THREE.MeshBasicMaterial({ color: 0x081524, transparent: true, opacity: 0.92 }),
    );
    disc.rotation.x = -Math.PI / 2;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.22, 2.25, 64),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.62, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    const innerRing = new THREE.Mesh(
      new THREE.RingGeometry(1.05, 1.065, 48),
      new THREE.MeshBasicMaterial({ color: 0x5ce8ff, transparent: true, opacity: 0.23, side: THREE.DoubleSide }),
    );
    innerRing.rotation.x = -Math.PI / 2;
    this.floor.name = "model-view-floor";
    this.floor.add(disc, ring, innerRing);
    this.scene.add(this.floor);
  }

  private fitModel(resetDistance: boolean): void {
    this.visual.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.visual.root);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    box.getCenter(this.target);
    const maxDimension = Math.max(size.x, size.y, size.z, 0.5);
    const verticalFit = (size.y * 0.5) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5));
    this.fitDistance = clamp(Math.max(maxDimension * 1.32, verticalFit * 1.12), 3.2, 13.5);
    if (resetDistance) this.distance = this.fitDistance;
    else this.distance = clamp(this.distance, this.fitDistance * 0.58, this.fitDistance * 1.9);
    this.floor.position.y = box.min.y - 0.018;
    this.floor.scale.setScalar(clamp(maxDimension / 3.2, 0.72, 1.5));
    this.updateCamera();
  }

  private updateCamera(): void {
    const horizontal = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * horizontal,
      this.target.y + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * horizontal,
    );
    this.camera.lookAt(this.target);
  }

  private resize = (): void => {
    const width = Math.max(1, this.mount.clientWidth || window.innerWidth);
    const height = Math.max(1, this.mount.clientHeight || window.innerHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private pinchDistance(): number {
    const values = [...this.pointers.values()];
    return values.length < 2 ? 0 : values[0].distanceTo(values[1]);
  }

  private onPointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    this.userMoved = true;
    this.renderer.domElement.style.cursor = "grabbing";
    this.renderer.domElement.setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, new THREE.Vector2(event.clientX, event.clientY));
    if (this.pointers.size >= 2) this.previousPinch = this.pinchDistance();
  };

  private onPointerMove = (event: PointerEvent): void => {
    const previous = this.pointers.get(event.pointerId);
    if (!previous) return;
    event.preventDefault();
    const next = new THREE.Vector2(event.clientX, event.clientY);
    if (this.pointers.size === 1) {
      const dx = next.x - previous.x;
      const dy = next.y - previous.y;
      this.yaw -= dx * 0.0082;
      this.pitch = clamp(this.pitch + dy * 0.0048, -0.38, 0.48);
    }
    this.pointers.set(event.pointerId, next);
    if (this.pointers.size >= 2) {
      const pinch = this.pinchDistance();
      if (this.previousPinch > 4 && pinch > 4) {
        const ratio = this.previousPinch / pinch;
        this.distance = clamp(this.distance * ratio, this.fitDistance * 0.58, this.fitDistance * 1.9);
      }
      this.previousPinch = pinch;
    }
    this.updateCamera();
  };

  private onPointerEnd = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    this.previousPinch = this.pointers.size >= 2 ? this.pinchDistance() : 0;
    if (this.pointers.size === 0) this.renderer.domElement.style.cursor = "grab";
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.userMoved = true;
    this.distance = clamp(this.distance * Math.exp(event.deltaY * 0.0012), this.fitDistance * 0.58, this.fitDistance * 1.9);
    this.updateCamera();
  };

  reset(): void {
    this.yaw = 0.34;
    this.pitch = 0.055;
    this.userMoved = false;
    this.fitModel(true);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.raf = window.requestAnimationFrame(this.loop);
  }

  private loop = (time: number): void => {
    if (!this.running) return;
    const dt = clamp((time - this.lastTime) / 1000, 0, 0.05);
    this.lastTime = time;
    if (!this.userMoved && this.pointers.size === 0) {
      this.yaw += dt * 0.16;
      this.updateCamera();
    }
    const nextRuntimeState = String(this.visual.root.userData.blenderRuntimeAssetState ?? "static");
    if (nextRuntimeState !== this.runtimeState) {
      this.runtimeState = nextRuntimeState;
      if (nextRuntimeState === "ready") this.fitModel(false);
    }
    this.renderer.render(this.scene, this.camera);
    this.raf = window.requestAnimationFrame(this.loop);
  };

  destroy(): void {
    this.running = false;
    window.cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("orientationchange", this.resize);
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown);
    this.renderer.domElement.removeEventListener("pointermove", this.onPointerMove);
    this.renderer.domElement.removeEventListener("pointerup", this.onPointerEnd);
    this.renderer.domElement.removeEventListener("pointercancel", this.onPointerEnd);
    this.renderer.domElement.removeEventListener("lostpointercapture", this.onPointerEnd);
    this.renderer.domElement.removeEventListener("wheel", this.onWheel);
    disposeFighterVisual(this.visual);
    this.floor.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
      else object.material.dispose();
    });
    this.floor.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.mount.replaceChildren();
    this.pointers.clear();
  }
}

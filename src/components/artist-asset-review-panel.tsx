"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { inspectArtistGlb, type ArtistAssetTechnicalReport } from "@/src/game/artist-glb-contract";
import { registerLocalArtistPreview } from "@/src/game/local-artist-preview";

type View = "FRONT" | "3/4" | "SIDE" | "BACK" | "FACE" | "OUTFIT";
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";
const angles: Record<View, { eye: [number, number, number]; target: [number, number, number] }> = {
  FRONT: { eye: [0, 1.65, 6], target: [0, 1.6, 0] },
  "3/4": { eye: [4.35, 1.8, 4.35], target: [0, 1.6, 0] },
  SIDE: { eye: [6, 1.7, 0], target: [0, 1.6, 0] },
  BACK: { eye: [0, 1.65, -6], target: [0, 1.6, 0] },
  FACE: { eye: [0.28, 2.96, 1.15], target: [0, 2.91, 0] },
  OUTFIT: { eye: [1.3, 2.1, 3.4], target: [0, 1.95, 0] },
};

type Viewer = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  loaded: THREE.Group | null;
  mixer: THREE.AnimationMixer | null;
  animation: THREE.AnimationAction | null;
  animationClips: THREE.AnimationClip[];
  environment: THREE.Texture;
};

const shell: React.CSSProperties = {
  border: "1px solid rgba(130,190,240,.38)",
  background: "rgba(5,14,29,.89)",
  color: "#e5f3ff",
  borderRadius: 6,
};
const button: React.CSSProperties = {
  ...shell, padding: "9px 11px", minHeight: 40, fontSize: 10,
  fontWeight: 800, cursor: "pointer", letterSpacing: ".04em",
};

function disposeCharacter(root: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of list) {
      materials.add(mat);
      for (const item of Object.values(mat)) {
        if (item instanceof THREE.Texture) textures.add(item);
      }
    }
  });
  geometries.forEach((g) => g.dispose());
  textures.forEach((t) => t.dispose());
  materials.forEach((m) => m.dispose());
}

function normalizeCharacter(root: THREE.Group): void {
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  if (!Number.isFinite(size.y) || size.y < 0.01)
    throw new Error("モデルの高さが不正です。Y軸が上のGLBを書き出してください。");
  const center = bounds.getCenter(new THREE.Vector3());
  const scale = 3.2 / size.y;
  root.scale.setScalar(scale);
  root.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
  root.updateMatrixWorld(true);
}

function formatMiB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

export function ArtistAssetReviewPanel({ onBack, onTestCombat }: {
  onBack: () => void;
  onTestCombat: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const requestId = useRef(0);
  const eligibleFile = useRef<File | null>(null);
  const [report, setReport] = useState<ArtistAssetTechnicalReport | null>(null);
  const [view, setView] = useState<View>("3/4");
  const [message, setMessage] = useState("iPhoneの「ファイル」から、造形済み・テクスチャ同梱のGLBを選択してください。");
  const [loading, setLoading] = useState(false);
  const [showSeraReference, setShowSeraReference] = useState(false);
  const [selectedClip, setSelectedClip] = useState("");
  const [clips, setClips] = useState<string[]>([]);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    const mount = host.current;
    if (!mount) return;
    let alive = true;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1727);
    const camera = new THREE.PerspectiveCamera(34, 1, 0.03, 75);
    const renderer = new THREE.WebGLRenderer({
      antialias: true, alpha: false, preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    renderer.domElement.style.cssText = "width:100%;height:100%;display:block;touch-action:none";
    mount.append(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enablePan = false;
    controls.minDistance = 1.0;
    controls.maxDistance = 11;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const studio = new RoomEnvironment();
    const environment = pmrem.fromScene(studio, 0.035).texture;
    scene.environment = environment;
    pmrem.dispose();
    studio.dispose();
    scene.add(new THREE.HemisphereLight(0xdceeff, 0x1c263d, 1.45));
    const key = new THREE.DirectionalLight(0xfff6ed, 3.25);
    key.position.set(-2.6, 5.8, 4.2);
    scene.add(key);
    const edge = new THREE.DirectionalLight(0x79aaff, 2.2);
    edge.position.set(3, 3.5, -3);
    scene.add(edge);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(2.5, 64),
      new THREE.MeshStandardMaterial({ color: 0x18243b, roughness: 0.92 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.025;
    floor.receiveShadow = false;
    scene.add(floor);
    const state: Viewer = {
      renderer, scene, camera, controls, loaded: null,
      mixer: null, animation: null, animationClips: [], environment,
    };
    viewer.current = state;
    function resize() {
      if (!alive || !mount) return;
      const w = Math.max(320, mount.clientWidth);
      const h = Math.max(240, mount.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    }
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();
    const pose = angles["3/4"];
    camera.position.set(...pose.eye);
    controls.target.set(...pose.target);
    controls.update();
    const clock = new THREE.Clock();
    let frame = 0;
    const loop = () => {
      if (!alive) return;
      frame = window.requestAnimationFrame(loop);
      const delta = Math.min(clock.getDelta(), .05);
      if (state.mixer && state.animation?.isRunning()) state.mixer.update(delta);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();
    return () => {
      alive = false;
      requestId.current++;
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      if (state.animation) state.animation.stop();
      if (state.mixer && state.loaded) state.mixer.uncacheRoot(state.loaded);
      if (state.loaded) {
        scene.remove(state.loaded);
        disposeCharacter(state.loaded);
      }
      controls.dispose();
      environment.dispose();
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
      viewer.current = null;
    };
  }, []);

  const cameraTo = (name: View) => {
    setView(name);
    const state = viewer.current;
    if (!state) return;
    const angle = angles[name];
    state.camera.position.set(...angle.eye);
    state.controls.target.set(...angle.target);
    state.controls.update();
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    const ticket = ++requestId.current;
    eligibleFile.current = null;
    setLoading(true);
    setReport(null);
    setClips([]);
    setMessage("GLB構造・スキニング・テクスチャを検査しています…");
    try {
      if (file.size > 80 * 1024 * 1024)
        throw new Error("造形の目視審査の安全上限は80 MiBです。軽い確認用GLBを書き出してください。");
      const data = await file.arrayBuffer();
      if (ticket !== requestId.current) return;
      const next = inspectArtistGlb(data, file.name);
      setReport(next);
      if (!next.visualReviewEligible)
        throw new Error("GLBの表示不可: " + next.technicalErrors.join(" / "));
      setMessage("実際のPBR材質・顔・髪・衣装を表示しています…");
      const gltf = await new Promise<Awaited<ReturnType<GLTFLoader["loadAsync"]>>>((resolve, reject) => {
        const loader = new GLTFLoader();
        loader.parse(data, "", resolve, reject);
      });
      if (ticket !== requestId.current || !viewer.current) {
        disposeCharacter(gltf.scene);
        return;
      }
      const state = viewer.current;
      normalizeCharacter(gltf.scene);
      if (state.animation) state.animation.stop();
      if (state.mixer && state.loaded) state.mixer.uncacheRoot(state.loaded);
      if (state.loaded) {
        state.scene.remove(state.loaded);
        disposeCharacter(state.loaded);
      }
      state.scene.add(gltf.scene);
      state.loaded = gltf.scene;
      state.animationClips = gltf.animations;
      state.mixer = gltf.animations.length ? new THREE.AnimationMixer(gltf.scene) : null;
      state.animation = null;
      if (state.mixer && gltf.animations[0]) {
        state.animation = state.mixer.clipAction(gltf.animations[0]);
        state.animation.play();
      }
      setClips(gltf.animations.map((clip) => clip.name));
      setSelectedClip(gltf.animations[0]?.name ?? "");
      eligibleFile.current = next.combatRigCompatible ? file : null;
      setPlaying(true);
      cameraTo("3/4");
      setMessage(next.combatRigCompatible
        ? "格闘テストの技術条件に合格。顔・髪・衣装はまだ品質未承認です。"
        : "造形の目視審査モードです。顔や衣装を先に確認できます。骨格・PBR・ポリゴン数は格闘テスト前に修正が必要です。");
    } catch (error) {
      if (ticket === requestId.current) {
        setMessage(error instanceof Error ? error.message : "ファイルの読み込みに失敗しました。");
      }
    } finally {
      if (ticket === requestId.current) setLoading(false);
    }
  };

  const chooseClip = (name: string) => {
    setSelectedClip(name);
    const state = viewer.current;
    if (!state?.mixer) return;
    state.animation?.stop();
    state.animation = null;
    const clip = state.animationClips.find((item) => item.name === name);
    if (clip) {
      state.animation = state.mixer.clipAction(clip);
      state.animation.reset().play();
      setPlaying(true);
    }
  };

  const togglePlay = () => {
    const state = viewer.current;
    if (!state?.animation) return;
    state.animation.paused = playing;
    setPlaying(!playing);
  };

  const capture = () => {
    const state = viewer.current;
    if (!state?.loaded) return;
    state.renderer.render(state.scene, state.camera);
    state.renderer.domElement.toBlob((blob) => {
      if (!blob) { setMessage("このブラウザでは画像保存できませんでした。"); return; }
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = "sera-artist-" + view.toLowerCase().replace("/", "-") + ".png";
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 30000);
    }, "image/png");
  };

  const launchCombatTest = () => {
    if (!report?.combatRigCompatible || !eligibleFile.current) return;
    try {
      registerLocalArtistPreview(eligibleFile.current);
      onTestCombat();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const keyStatus = !report ? "NO SCULPT SELECTED"
    : report.combatRigCompatible ? "COMBAT TECH PASS / ART UNREVIEWED"
    : report.visualReviewEligible ? "SCULPT VISUAL REVIEW ONLY / ART UNREVIEWED"
    : "GLB INVALID / NOT APPROVED";
  return (
    <section aria-label="SERA Artist Asset Lab" data-asset-intake-state={loading ? "loading" : report?.combatRigCompatible ? "tech-pass" : report?.visualReviewEligible ? "visual-only" : report ? "rejected" : "empty"} data-asset-triangles={report?.triangles ?? 0} style={{
      position: "absolute", inset: 0, zIndex: 12, background: "#050c18",
      color: "#eff7ff", overflow: "hidden", touchAction: "manipulation",
    }}>
      <div ref={host} style={{ position: "absolute", inset: 0 }} />
      {showSeraReference && (
        <div aria-label="Original SERA four-view design reference" role="img"
          style={{
            position: "absolute", zIndex: 3, pointerEvents: "none",
            left: "max(8px, env(safe-area-inset-left))",
            top: "max(74px, env(safe-area-inset-top))",
            width: "min(41vw, 370px)", height: "min(58vh, 390px)",
            border: "1px solid #78b3df", borderRadius: 5,
            backgroundColor: "#081323",
            backgroundImage: "url('" + BASE_PATH + "/reference/female-turnaround.jpeg')",
            backgroundSize: "contain", backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            boxShadow: "0 6px 24px #000b",
          }} />
      )}
      <header style={{
        position: "absolute", top: "max(10px, env(safe-area-inset-top))",
        left: "max(12px, env(safe-area-inset-left))", zIndex: 2,
        pointerEvents: "none", textShadow: "0 1px 7px #02060b",
      }}>
        <div style={{ fontSize: 10, color: "#7feeff", letterSpacing: ".16em", fontWeight: 800 }}>
          SERA // ARTIST FIRST
        </div>
        <strong style={{ fontSize: "clamp(20px, 4.2vw, 35px)" }}>3D MODEL QUALITY LAB</strong>
        <div style={{ fontSize: 9, color: "#b3c3d4", marginTop: 3 }}>自動造形ではなく、完成済みの手作りアセットを審査</div>
      </header>
      <aside style={{
        position: "absolute", zIndex: 3, top: "50%",
        right: "max(10px, env(safe-area-inset-right))",
        transform: "translateY(-50%)", width: "clamp(174px, 24vw, 250px)",
        maxHeight: "80%", overflowY: "auto", padding: 10,
        display: "flex", flexDirection: "column", gap: 7, ...shell,
      }}>
        <label style={{ ...button, display: "block", position: "relative", overflow: "hidden", textAlign: "center",
          color: "#06121f", background: "#6ee5ff", borderColor: "#6ee5ff" }}>
          {loading ? "CHECKING…" : "IMPORT ARTIST GLB"}
          <input type="file" accept=".glb,model/gltf-binary" disabled={loading}
            onChange={(event) => { void onFile(event.target.files?.[0]); event.currentTarget.value = ""; }}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%",
              opacity: 0, cursor: "pointer" }} />
        </label>
        <a href="https://theunseenvulga.itch.io/3d-character-riggedema"
          target="_blank" rel="noopener noreferrer"
          style={{ ...button, display: "block", textDecoration: "none",
            padding: "8px 7px", color: "#d6efff", borderColor: "#4b829b",
            textAlign: "center", fontSize: 9 }}>
          TEST GLB / EMA (ART REJECTED)
        </a>
        <div style={{ color: "#9db6c7", fontSize: 8, lineHeight: 1.5 }}>
          EMA.glb (約7.8 MB) を取得して上のボタンから開く。
          これはSERAとして不採用の検査用モデルです。
        </div>
        <div style={{ fontSize: 9, color: report?.combatRigCompatible ? "#9decb8" : report?.visualReviewEligible ? "#f5d88c" : "#d9e3eb",
          fontWeight: 800 }}>{keyStatus}</div>
        {report && (
          <div style={{ fontSize: 9, lineHeight: 1.6, color: "#bdd0e0", overflowWrap: "anywhere" }}>
            {report.filename}<br />
            {report.triangles.toLocaleString()} tris / {formatMiB(report.bytes)} MiB<br />
            {report.skinnedPrimitives} skinned parts / {report.images} images<br />
            {report.normalMaps} normal / {report.pbrRoughnessMaps} roughness maps<br />
            {report.morphTargets} morphs / {report.animations} motion clips
            {!report.combatRigCompatible && report.visualReviewEligible && (
              <div style={{ marginTop: 6, color: "#e7be84" }}>
                格闘テスト未対応 / {report.technicalErrors.slice(0, 3).join(" / ")}
              </div>
            )}
          </div>
        )}
        {report?.combatRigCompatible && (
          <button type="button" onClick={launchCombatTest}
            style={{ ...button, background: "#174a38", borderColor: "#91e9af",
              color: "#d9ffe9", fontSize: 9 }}>
            TEST REAL PUNCH / KICK
          </button>
        )}
        <div style={{ fontSize: 8, lineHeight: 1.5, color: "#9dcfbb" }}>
          端末内のGLBを既存格闘モーションに一時接続します。
          実モデルの関節が合わない場合は旧キャラへ戻ります。製品採用はしません。
        </div>
        <button type="button" aria-pressed={showSeraReference}
          onClick={() => setShowSeraReference((shown) => !shown)}
          style={{ ...button, background: showSeraReference ? "#145a6e" : "#102a3c",
            borderColor: showSeraReference ? "#9dedfd" : "#3c5f7b",
          }}>SERA REFERENCE {showSeraReference ? "ON" : "OFF"}</button>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 4 }}>
          {(Object.keys(angles) as View[]).map((name) => (
            <button key={name} type="button" aria-pressed={view === name}
              onClick={() => cameraTo(name)}
              style={{ ...button, minHeight: 32, padding: "5px 2px", fontSize: 8,
                background: name === view ? "#164e68" : "rgba(6,15,29,.88)" }}>
              {name}
            </button>
          ))}
        </div>
        {clips.length > 0 && (
          <>
            <select aria-label="Artist model animation" value={selectedClip}
              onChange={(e) => chooseClip(e.target.value)} style={{ ...shell, padding: 6, width: "100%", fontSize: 9 }}>
              {clips.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <button onClick={togglePlay} type="button" style={button}>
              {playing ? "PAUSE MOTION" : "PLAY MOTION"}
            </button>
          </>
        )}
        <button type="button" onClick={capture} disabled={!report?.visualReviewEligible}
          style={{ ...button, opacity: report?.visualReviewEligible ? 1 : .5 }}>
          SAVE ACTUAL VIEW
        </button>
        <div style={{ color: "#93a9bf", fontSize: 8, lineHeight: 1.5 }}>
          DRAG = ROTATE / PINCH = ZOOM<br />
          プレビューは端末内だけで処理。GitHubにはアップロードされません。
        </div>
      </aside>
      <div role="status" style={{
        position: "absolute", zIndex: 2,
        left: "max(110px, env(safe-area-inset-left))",
        right: "clamp(194px, 27vw, 276px)",
        bottom: "max(12px, env(safe-area-inset-bottom))",
        fontSize: 10, textAlign: "center", lineHeight: 1.6,
        color: "#d2e9f4", background: "rgba(3,10,23,.85)", padding: "8px 10px",
      }}>
        {message}
      </div>
      <button onClick={onBack} type="button"
        style={{ ...button, position: "absolute", zIndex: 4,
          left: "max(10px, env(safe-area-inset-left))",
          bottom: "max(14px, env(safe-area-inset-bottom))" }}>
        ← MODEL VIEW
      </button>
    </section>
  );
}

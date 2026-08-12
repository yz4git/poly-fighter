"use client";

/* eslint-disable @next/next/no-img-element -- exact pixel artifacts are the reconstruction target */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { FIGHTER_DEFINITIONS } from "@/src/game/definitions";
import { createFemaleV6ReferenceCamera, type FemaleV6ReferenceView } from "@/src/game/reference-v6";
import { createGoldenMasterV7Visual, disposeGoldenMasterV7Visual, type GoldenMasterV7View } from "@/src/game/golden-master-v7-visual";

type ReconstructionMode = "REFERENCE" | "RENDER" | "OVERLAY" | "DIFFERENCE" | "SILHOUETTE" | "SILHOUETTE_XOR" | "EDGES";
type ViewName = GoldenMasterV7View;

const VIEW_ORDER: ViewName[] = ["front", "three-quarter", "side", "back"];
const VIEW_LABELS: Record<ViewName, string> = { front: "FRONT", "three-quarter": "3/4 VIEW", side: "SIDE", back: "BACK" };
const CAMERA_VIEW: Record<ViewName, FemaleV6ReferenceView> = { front: "FRONT", "three-quarter": "THREE_QUARTER", side: "SIDE", back: "BACK" };

interface V7BodyViewMetric { iou: number; contourErrorPx: number; referencePixels: number; generatedPixels: number; }
interface V7MetricBundle {
  body?: Record<string, V7BodyViewMetric>;
  regions?: Record<string, Record<string, number>>;
  face?: Record<string, { headContourErrorPx: number; eyeCenterErrorPx: number; noseTipErrorPx: number; chinErrorPx: number }>;
}

function ReferenceCrop({ view, opacity }: { view: ViewName; opacity: number }) {
  return <div className="reference-crop" style={{ opacity }}><img src={`/reference/v7/reference-${view}.png`} alt={`Golden master ${VIEW_LABELS[view]}`} draggable={false} /></div>;
}

function ArtifactLayer({ src, visible, alt }: { src: string; visible: boolean; alt: string }) {
  if (!visible) return null;
  return <img className="reference-artifact" src={src} alt={alt} draggable={false} />;
}

function formatMetric(value: number | undefined, digits = 4): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

export function ReferenceReconstructionPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewIndex, setViewIndex] = useState(0);
  const [mode, setMode] = useState<ReconstructionMode>("OVERLAY");
  const [opacity, setOpacity] = useState(0.50);
  const [metrics, setMetrics] = useState<V7MetricBundle>({});
  const view = VIEW_ORDER[viewIndex] ?? "front";
  const bodyMetric = metrics.body?.[view];

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [body, regions, face] = await Promise.all([
        fetch("/reference/v7/gate-4-body-metrics.json", { cache: "no-store" }).then((response) => response.ok ? response.json() : undefined).catch(() => undefined),
        fetch("/reference/v7/gate-5-region-metrics.json", { cache: "no-store" }).then((response) => response.ok ? response.json() : undefined).catch(() => undefined),
        fetch("/reference/v7/gate-6-face-metrics.json", { cache: "no-store" }).then((response) => response.ok ? response.json() : undefined).catch(() => undefined),
      ]);
      if (cancelled) return;
      setMetrics({ body: body?.views ?? body?.measured, regions: regions?.measured, face });
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const visual = createGoldenMasterV7Visual(FIGHTER_DEFINITIONS.blue, { view });
    const scene = new THREE.Scene();
    const hemi = new THREE.HemisphereLight(0xd9e9ff, 0x121522, 1.8);
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(-3, 5, 4);
    const fill = new THREE.DirectionalLight(0x6095ff, 1.1);
    fill.position.set(3, 2, -4);
    scene.add(hemi, key, fill, visual.root);
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: false });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    const camera = createFemaleV6ReferenceCamera(CAMERA_VIEW[view], 0.44);
    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (!rect) return;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
      camera.aspect = Math.max(0.1, rect.width / Math.max(1, rect.height));
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    resize();
    const observer = new ResizeObserver(resize);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    return () => { observer.disconnect(); renderer.dispose(); disposeGoldenMasterV7Visual(visual); };
  }, [view]);

  const isStaticArtifact = mode === "DIFFERENCE" || mode === "SILHOUETTE" || mode === "SILHOUETTE_XOR" || mode === "EDGES";
  const referenceOpacity = mode === "RENDER" || isStaticArtifact ? 0 : mode === "REFERENCE" ? 1 : opacity;
  const renderOpacity = mode === "REFERENCE" || isStaticArtifact ? 0 : mode === "OVERLAY" ? opacity : 1;
  const artifact = mode === "SILHOUETTE" ? `/reference/v7/v7-body-generated-${view}.png` : `/reference/v7/v7-body-comparison-${view}.png`;

  return (
    <main className="reference-reconstruction">
      <header className="reference-toolbar">
        <div><span className="reference-kicker">DEVELOPMENT ONLY / GOLDEN MASTER CLOSED LOOP</span><h1>FEMALE V7 RECONSTRUCTION</h1><p>ACTUAL PIXEL MASK → GENERATED TRIANGLES → MEASURED LOSS // 1.68m FIXED CAMERA</p></div>
        <button type="button" className="reference-close" onClick={() => window.history.back()}>EXIT</button>
      </header>
      <section className="reference-stage-wrap">
        <div className="reference-stage" data-mode={mode.toLowerCase()}>
          <ReferenceCrop view={view} opacity={referenceOpacity} />
          <canvas ref={canvasRef} className="reference-render" style={{ opacity: renderOpacity }} aria-label={`Generated V7 ${VIEW_LABELS[view]}`} />
          <ArtifactLayer src={artifact} visible={isStaticArtifact} alt={`Measured V7 ${mode} ${VIEW_LABELS[view]}`} />
        </div>
        <aside className="reference-metrics">
          <div className="reference-metric-title">{VIEW_LABELS[view]} / {mode.replace("_", " ")}</div>
          <p>Comparison artifacts are generated from Golden Master pixels and Three.js polygon masks. Gameplay never samples the reference image.</p>
          <dl>
            <dt>BODY IOU</dt><dd>{formatMetric(bodyMetric?.iou)} <small>actual mask</small></dd>
            <dt>CONTOUR ERROR</dt><dd>{formatMetric(bodyMetric?.contourErrorPx, 2)} px <small>actual mask</small></dd>
            <dt>PIXELS</dt><dd>{bodyMetric ? `${bodyMetric.referencePixels.toLocaleString()} ref / ${bodyMetric.generatedPixels.toLocaleString()} gen` : "loading…"}</dd>
            <dt>REGIONS</dt><dd>HAIR {formatMetric(metrics.regions?.[view]?.hair)} / BLUE {formatMetric(metrics.regions?.[view]?.blue)}<br />BLACK {formatMetric(metrics.regions?.[view]?.black)} / SILVER {formatMetric(metrics.regions?.[view]?.silver)}</dd>
            {metrics.face?.[view] && <><dt>FACE PIXEL ERROR</dt><dd>HEAD {formatMetric(metrics.face[view].headContourErrorPx, 2)} / EYES {formatMetric(metrics.face[view].eyeCenterErrorPx, 2)}<br />NOSE {formatMetric(metrics.face[view].noseTipErrorPx, 2)} / CHIN {formatMetric(metrics.face[view].chinErrorPx, 2)}</dd></>}
            <dt>ARTIFACTS</dt><dd>REFERENCE / GENERATED / XOR</dd>
          </dl>
        </aside>
      </section>
      <footer className="reference-controls">
        <div className="reference-tabs"><span>VIEW</span>{VIEW_ORDER.map((value, index) => <button key={value} type="button" className={index === viewIndex ? "active" : ""} onClick={() => setViewIndex(index)}>{VIEW_LABELS[value]}</button>)}</div>
        <div className="reference-tabs"><span>COMPARE</span>{(["REFERENCE", "RENDER", "OVERLAY", "DIFFERENCE", "SILHOUETTE", "SILHOUETTE_XOR", "EDGES"] as ReconstructionMode[]).map((value) => <button key={value} type="button" className={mode === value ? "active" : ""} onClick={() => setMode(value)}>{value.replace("_", " ")}</button>)}</div>
        <label className="reference-slider">OVERLAY <input type="range" min="0" max="100" value={opacity * 100} onChange={(event) => setOpacity(Number(event.target.value) / 100)} /> {Math.round(opacity * 100)}%</label>
      </footer>
    </main>
  );
}

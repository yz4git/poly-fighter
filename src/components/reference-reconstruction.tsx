"use client";
/* eslint-disable @next/next/no-img-element -- exact pixel crops are required by the reconstruction tool */

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { FIGHTER_DEFINITIONS } from "@/src/game/definitions";
import {
  createFighterVisual,
  disposeFighterVisual,
  generatedLandmarks,
  measureProjectedSilhouette,
  projectGeneratedLandmarks,
  visualGroundOffset,
} from "@/src/game/visual";
import {
  createFemaleV6ReferenceCamera,
  FEMALE_V6_CONTROL_CAGE,
  FEMALE_V6_REFERENCE,
  FEMALE_V6_REFERENCE_ENVELOPES,
  FEMALE_V6_REFERENCE_LANDMARKS,
  FEMALE_V6_VIEW_ORDER,
  envelopeError,
  landmarkRms,
  type FemaleV6ReferenceView,
} from "@/src/game/reference-v6";

type ReconstructionMode = "REFERENCE" | "RENDER" | "OVERLAY" | "DIFFERENCE" | "SILHOUETTE" | "SILHOUETTE_XOR" | "EDGES";

interface ReconstructionMetrics {
  view: FemaleV6ReferenceView;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  areaRatio: number;
  envelopeError: number;
  landmarkRms: number;
  renderedHeight: number;
  triangles: number;
  vertices: number;
  meshes: number;
  materials: number;
}

function ReferenceCrop({ view, opacity }: { view: FemaleV6ReferenceView; opacity: number }) {
  const crop = FEMALE_V6_REFERENCE.views[view];
  const imageStyle = {
    position: "absolute" as const,
    width: `${(FEMALE_V6_REFERENCE.sourceWidth / crop.width) * 100}%`,
    height: `${(FEMALE_V6_REFERENCE.sourceHeight / crop.height) * 100}%`,
    left: `${-(crop.x / crop.width) * 100}%`,
    top: `${-(crop.y / crop.height) * 100}%`,
    maxWidth: "none",
  };
  return <div className="reference-crop" style={{ opacity }}><img src={FEMALE_V6_REFERENCE.asset} alt={`Golden master ${crop.label}`} style={imageStyle} draggable={false} /></div>;
}

function CageOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  const points = Object.entries(FEMALE_V6_CONTROL_CAGE);
  return <div className="reference-cage-labels" aria-hidden="true">{points.map(([name, point]) => <span key={name} style={{ left: `${50 + point.x * 170}%`, top: `${(1 - point.y) * 100}%` }}>{name}</span>)}</div>;
}

export function ReferenceReconstructionPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewIndex, setViewIndex] = useState(0);
  const [mode, setMode] = useState<ReconstructionMode>("OVERLAY");
  const [opacity, setOpacity] = useState(0.50);
  const [showLandmarks, setShowLandmarks] = useState(true);
  const [showCage, setShowCage] = useState(false);
  const [metrics, setMetrics] = useState<ReconstructionMetrics | null>(null);
  const view = FEMALE_V6_VIEW_ORDER[viewIndex] ?? "FRONT";
  const targetLandmarks = FEMALE_V6_REFERENCE_LANDMARKS[view];
  const modeLabel = useMemo(() => mode.replace("_", " "), [mode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const definition = FIGHTER_DEFINITIONS.blue;
    const visual = createFighterVisual(definition, "NORMAL");
    // The gameplay visual is authored in normalized model space and scaled by
    // the existing fighter runtime.  Reconstruction uses the golden master's
    // explicit 1.68m scale and the same sole-to-ground offset.
    visual.root.scale.setScalar(FEMALE_V6_REFERENCE.characterHeightMeters);
    visual.root.position.y = visualGroundOffset(visual);
    visual.root.updateMatrixWorld(true);
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
    const camera = createFemaleV6ReferenceCamera(view, 0.44);
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
    const projected = projectGeneratedLandmarks(visual, camera);
    const silhouette = measureProjectedSilhouette(visual.root, camera, 96);
    const generated = generatedLandmarks(visual);
    const yValues = Object.values(generated).map((point) => point.y);
    setMetrics({
      view,
      bounds: silhouette.bounds,
      areaRatio: silhouette.areaRatio,
      envelopeError: envelopeError(silhouette.bounds, FEMALE_V6_REFERENCE_ENVELOPES[view]),
      landmarkRms: landmarkRms(projected, targetLandmarks),
      renderedHeight: (Math.max(...yValues) - Math.min(...yValues)),
      triangles: visual.stats.triangleCount,
      vertices: visual.stats.vertexCount,
      meshes: visual.stats.meshCount,
      materials: visual.stats.materialCount,
    });
    return () => {
      observer.disconnect();
      renderer.dispose();
      disposeFighterVisual(visual);
    };
  }, [targetLandmarks, view]);

  const referenceOpacity = mode === "RENDER" ? 0 : mode === "DIFFERENCE" || mode === "SILHOUETTE_XOR" ? 1 : opacity;
  const renderOpacity = mode === "REFERENCE" ? 0 : mode === "OVERLAY" || mode === "DIFFERENCE" || mode === "SILHOUETTE_XOR" ? opacity : 1;
  const renderStyle = {
    opacity: renderOpacity,
    mixBlendMode: mode === "DIFFERENCE" || mode === "SILHOUETTE_XOR" ? "difference" as const : "normal" as const,
    filter: mode === "SILHOUETTE" || mode === "SILHOUETTE_XOR" ? "grayscale(1) contrast(2.4) brightness(.45)" : mode === "EDGES" ? "grayscale(1) contrast(2.1)" : "none",
  };

  return (
    <main className="reference-reconstruction">
      <header className="reference-toolbar">
        <div><span className="reference-kicker">DEVELOPMENT ONLY / GOLDEN MASTER</span><h1>FEMALE V6 RECONSTRUCTION</h1><p>1.68m CONTROL CAGE // FIXED CAMERA // MEASURED PROJECTION</p></div>
        <button type="button" className="reference-close" onClick={() => window.history.back()}>EXIT</button>
      </header>
      <section className="reference-stage-wrap">
        <div className="reference-stage" data-mode={mode.toLowerCase()}>
          <ReferenceCrop view={view} opacity={referenceOpacity} />
          <canvas ref={canvasRef} className="reference-render" style={renderStyle} aria-label={`Rendered V6 ${view}`} />
          {showLandmarks && <div className="reference-landmarks" aria-hidden="true">{Object.entries(targetLandmarks).map(([name, point]) => <span key={`target-${name}`} className="target" style={{ left: `${point[0] * 100}%`, top: `${point[1] * 100}%` }} />)}</div>}
          <CageOverlay visible={showCage} />
        </div>
        <aside className="reference-metrics">
          <div className="reference-metric-title">{FEMALE_V6_REFERENCE.views[view].label} / {modeLabel}</div>
          <p>Reference is shown only in this dev scene. Gameplay never samples this image as a texture.</p>
          {metrics ? <dl>
            <dt>PROJECTED BOUNDS</dt><dd>{metrics.bounds.minX.toFixed(3)} / {metrics.bounds.minY.toFixed(3)} → {metrics.bounds.maxX.toFixed(3)} / {metrics.bounds.maxY.toFixed(3)}</dd>
            <dt>ENVELOPE ERROR</dt><dd>{metrics.envelopeError.toFixed(4)} <small>(measured)</small></dd>
            <dt>LANDMARK RMS</dt><dd>{metrics.landmarkRms.toFixed(4)} <small>(normalized)</small></dd>
            <dt>RENDERED HEIGHT</dt><dd>{metrics.renderedHeight.toFixed(3)}m</dd>
            <dt>GEOMETRY</dt><dd>{metrics.triangles.toLocaleString()} tri / {metrics.vertices.toLocaleString()} vtx / {metrics.meshes} mesh / {metrics.materials} mat</dd>
          </dl> : <p>Measuring projected geometry…</p>}
        </aside>
      </section>
      <footer className="reference-controls">
        <div className="reference-tabs"><span>VIEW</span>{FEMALE_V6_VIEW_ORDER.map((value, index) => <button key={value} type="button" className={index === viewIndex ? "active" : ""} onClick={() => setViewIndex(index)}>{FEMALE_V6_REFERENCE.views[value].label}</button>)}</div>
        <div className="reference-tabs"><span>COMPARE</span>{(["REFERENCE", "RENDER", "OVERLAY", "DIFFERENCE", "SILHOUETTE", "SILHOUETTE_XOR", "EDGES"] as ReconstructionMode[]).map((value) => <button key={value} type="button" className={mode === value ? "active" : ""} onClick={() => setMode(value)}>{value.replace("_", " ")}</button>)}</div>
        <label className="reference-slider">OVERLAY <input type="range" min="0" max="100" value={opacity * 100} onChange={(event) => setOpacity(Number(event.target.value) / 100)} /> {Math.round(opacity * 100)}%</label>
        <div className="reference-tabs"><button type="button" className={showLandmarks ? "active" : ""} onClick={() => setShowLandmarks((current) => !current)}>LANDMARKS</button><button type="button" className={showCage ? "active" : ""} onClick={() => setShowCage((current) => !current)}>CONTROL CAGE</button></div>
      </footer>
    </main>
  );
}

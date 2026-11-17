"use client";

import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import type { TpsFightGame } from "../game/tps-game";
import { ARTIST_PRIVATE_COMBAT_VERSION } from "../game/artist-private-combat";
import { artistSourceLifetime } from "../game/artist-local-glb-lifetime";
import { ArtistFrameTimingSampler } from "../game/artist-frame-timing";

export interface ArtistCombatRuntimeSnapshot {
  state: string;
  fighterState: string;
  activeMove: string;
  mappedBones: number;
  triangles: number;
  texturedMaterials: number;
  error: string | null;
  renderFps: number;
  drawCalls: number;
  sceneTriangles: number;
  gpuGeometries: number;
  gpuTextures: number;
  localSourcesActive: number;
  localSourcesLoaded: number;
  localSourcesReleased: number;
  p95FrameMs: number;
  slowFramesPercent: number;
  frameSamples: number;
}

const empty: ArtistCombatRuntimeSnapshot = {
  state: "loading", fighterState: "IDLE", activeMove: "NONE", mappedBones: 0, triangles: 0,
  texturedMaterials: 0, error: null, renderFps: 0,
  drawCalls: 0, sceneTriangles: 0,
  gpuGeometries: 0, gpuTextures: 0,
  localSourcesActive: 0, localSourcesLoaded: 0, localSourcesReleased: 0,
  p95FrameMs: 0, slowFramesPercent: 0, frameSamples: 0,
};

/** iPhone Safari test UI: readings are measured in the live fight renderer.
 * This is not a GPU-timestamp or certified 60 fps benchmark. The local
 * customer-supplied GLB is never uploaded or persisted. */
export function ArtistCombatQaOverlay({
  gameRef,
  onExit,
}: {
  gameRef: RefObject<TpsFightGame | null>;
  onExit: () => void;
}) {
  const [info, setInfo] = useState<ArtistCombatRuntimeSnapshot>(empty);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const frameTiming = new ArtistFrameTimingSampler();
    let timingRaf = 0;
    const measure = (timestamp: number) => {
      frameTiming.record(timestamp, !document.hidden);
      timingRaf = window.requestAnimationFrame(measure);
    };
    timingRaf = window.requestAnimationFrame(measure);
    let previousFrame: number | null = null;
    let previousTime: number | null = null;
    const id = window.setInterval(() => {
      const game = gameRef.current;
      if (!game) return;
      const root = game.p1.visual.root;
      const data = root.userData;
      const now = performance.now();
      const frame = game.renderer.info.render.frame;
      const sourceLife = artistSourceLifetime();
      const frameStats = frameTiming.snapshot();
      const fps = previousTime !== null && previousFrame !== null && now > previousTime
        ? Math.max(0, (frame - previousFrame) * 1000 / (now - previousTime))
        : 0;
      previousFrame = frame;
      previousTime = now;
      setInfo({
        state: String(data.heroModelState ?? "loading"),
        fighterState: String(game.p1.state ?? "IDLE"),
        activeMove: String(game.p1.currentMove?.id ?? "NONE"),
        mappedBones: Number(data.heroModelMappedBones ?? 0),
        triangles: Number(data.heroPbrTriangleCount ?? 0),
        texturedMaterials: Number(data.heroPbrTextureMaterials ?? 0),
        error: typeof data.heroModelError === "string" ? data.heroModelError : null,
        renderFps: Math.min(fps, 240),
        drawCalls: game.renderer.info.render.calls,
        sceneTriangles: game.renderer.info.render.triangles,
        gpuGeometries: game.renderer.info.memory.geometries,
        gpuTextures: game.renderer.info.memory.textures,
        localSourcesActive: sourceLife.active,
        localSourcesLoaded: sourceLife.loaded,
        localSourcesReleased: sourceLife.released,
        p95FrameMs: frameStats.p95Ms,
        slowFramesPercent: frameStats.over20msPercent,
        frameSamples: frameStats.samples,
      });
    }, 1000);
    return () => { window.clearInterval(id); window.cancelAnimationFrame(timingRaf); };
  }, [gameRef]);

  const captureFrame = () => {
    const game = gameRef.current;
    if (!game) return;
    try {
      // Capture at the same game camera/pose currently seen by the player.
      game.renderer.render(game.scene, game.camera);
      const canvas = game.renderer.domElement;
      const link = document.createElement("a");
      link.download = "sera-private-combat-qa.png";
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (error) {
      console.error("[POLY FIGHTER] Private artist capture unavailable", error);
    }
  };

  const exportQaReport = () => {
    // Explicitly export metrics only. Never serialize the private blob URL,
    // the GLB source, a file name, facial textures or game account data.
    const report = {
      schemaVersion: 1,
      kind: "POLY_FIGHTER_LOCAL_ARTIST_COMBAT_TECHNICAL_QA",
      artApproved: false,
      generatedAt: new Date().toISOString(),
      viewport: { width: window.innerWidth, height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio },
      sample: info,
      limitation: "Browser requestAnimationFrame cadence; not GPU timings, iPhone 60fps certification or artist approval",
    };
    const output = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const local = URL.createObjectURL(output);
    const link = document.createElement("a");
    link.href = local;
    link.download = "sera-private-fight-technical-qa.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(local), 20_000);
  };

  const ready = info.state === "ready" && info.mappedBones >= 20;
  const stateColor = ready ? "#91f6b2" : info.state === "failed" ? "#ff9d9d" : "#ffe0a2";
  const surface: CSSProperties = {
    position: "absolute",
    right: "max(8px, env(safe-area-inset-right))",
    top: "max(72px, env(safe-area-inset-top))",
    zIndex: 9,
    maxWidth: expanded ? "min(280px, 54vw)" : "min(185px, 40vw)",
    // A 402–430px iPhone landscape viewport has attack buttons along the
    // bottom. The QA panel must scroll internally, not cover those buttons.
    maxHeight: "max(82px, calc(100dvh - 200px))",
    overflowY: expanded ? "auto" : "hidden",
    overscrollBehavior: "contain",
    color: "#e7f5ff",
    background: "rgba(3, 12, 24, .90)",
    border: "1px solid rgba(114, 203, 231, .70)",
    borderRadius: 8,
    fontSize: 10,
    padding: 8,
    lineHeight: 1.4,
    touchAction: expanded ? "pan-y" : "manipulation",
  };
  const button: CSSProperties = {
    color: "inherit", background: "rgba(45,79,112,.75)",
    border: "1px solid rgba(160,214,255,.56)",
    borderRadius: 4, padding: "7px 9px", fontSize: 10,
  };
  return (
    <aside data-artist-combat-qa={ARTIST_PRIVATE_COMBAT_VERSION}
      data-artist-local-active={info.localSourcesActive}
      data-artist-local-loaded={info.localSourcesLoaded}
      data-artist-local-released={info.localSourcesReleased}
      data-artist-combat-state={info.state} aria-label="Private SERA model combat audit"
      style={surface}>
      <button type="button" aria-expanded={expanded}
        style={{ ...button, width: "100%", textAlign: "left", color: stateColor }}
        onClick={() => setExpanded(value => !value)}>
        PRIVATE GLB QA · {ready ? "RENDERED" : info.state.toUpperCase()} {expanded ? "−" : "+"}
      </button>
      {expanded && (
        <div style={{ display: "grid", gap: 5, paddingTop: 7 }}>
          <strong>UNAPPROVED MODEL · LOCAL ONLY</strong>
          <span>Fight: {info.fighterState} · Move: {info.activeMove}</span>
          <span>Rig: {info.mappedBones} mapped bones · mesh: {info.triangles.toLocaleString()} tris</span>
          <span>Textured PBR materials: {info.texturedMaterials}</span>
          <span>Render frames/s: {info.renderFps.toFixed(1)} (estimated)</span>
          <span>Frame P95: {info.p95FrameMs.toFixed(1)} ms · {info.slowFramesPercent.toFixed(0)}% over 20 ms ({info.frameSamples} samples)</span>
          <span>Draw calls: {info.drawCalls} · scene tris: {info.sceneTriangles.toLocaleString()}</span>
          <span>GPU memory counts: {info.gpuGeometries} meshes / {info.gpuTextures} textures</span>
          <span>Local GLB sources: {info.localSourcesActive} active / {info.localSourcesReleased} released</span>
          {info.error && <span role="alert" style={{ color: "#ffb4b4", overflowWrap: "anywhere" }}>Fallback: {info.error}</span>}
          <span>Chrome/Safari render FPS is not GPU frame timing. Inspect on a real iPhone.</span>
          <button type="button" style={button} onClick={captureFrame}>SAVE FIGHT SCREENSHOT</button>
          <button type="button" style={button} onClick={exportQaReport}>SAVE PRIVATE QA METRICS</button>
          <button type="button" style={button} onClick={onExit}>END PRIVATE TEST</button>
        </div>
      )}
    </aside>
  );
}

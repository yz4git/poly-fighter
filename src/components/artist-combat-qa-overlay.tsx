"use client";

import { useEffect, useState, type RefObject } from "react";
import type { TpsFightGame } from "../game/tps-game";
import { ARTIST_PRIVATE_COMBAT_VERSION } from "../game/artist-private-combat";

export interface ArtistCombatRuntimeSnapshot {
  state: string;
  mappedBones: number;
  triangles: number;
  texturedMaterials: number;
  error: string | null;
  renderFps: number;
  drawCalls: number;
  sceneTriangles: number;
}

const empty: ArtistCombatRuntimeSnapshot = {
  state: "loading", mappedBones: 0, triangles: 0,
  texturedMaterials: 0, error: null, renderFps: 0,
  drawCalls: 0, sceneTriangles: 0,
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
    let previousFrame: number | null = null;
    let previousTime: number | null = null;
    const id = window.setInterval(() => {
      const game = gameRef.current;
      if (!game) return;
      const root = game.p1.visual.root;
      const data = root.userData;
      const now = performance.now();
      const frame = game.renderer.info.render.frame;
      const fps = previousTime !== null && previousFrame !== null && now > previousTime
        ? Math.max(0, (frame - previousFrame) * 1000 / (now - previousTime))
        : 0;
      previousFrame = frame;
      previousTime = now;
      setInfo({
        state: String(data.heroModelState ?? "loading"),
        mappedBones: Number(data.heroModelMappedBones ?? 0),
        triangles: Number(data.heroPbrTriangleCount ?? 0),
        texturedMaterials: Number(data.heroPbrTextureMaterials ?? 0),
        error: typeof data.heroModelError === "string" ? data.heroModelError : null,
        renderFps: Math.min(fps, 240),
        drawCalls: game.renderer.info.render.calls,
        sceneTriangles: game.renderer.info.render.triangles,
      });
    }, 1000);
    return () => window.clearInterval(id);
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

  const ready = info.state === "ready" && info.mappedBones >= 20;
  const stateColor = ready ? "#91f6b2" : info.state === "failed" ? "#ff9d9d" : "#ffe0a2";
  const surface: React.CSSProperties = {
    position: "absolute",
    right: "max(8px, env(safe-area-inset-right))",
    top: "max(72px, env(safe-area-inset-top))",
    zIndex: 9,
    maxWidth: expanded ? "min(280px, 54vw)" : "min(185px, 40vw)",
    color: "#e7f5ff",
    background: "rgba(3, 12, 24, .90)",
    border: "1px solid rgba(114, 203, 231, .70)",
    borderRadius: 8,
    fontSize: 10,
    padding: 8,
    lineHeight: 1.4,
    touchAction: "manipulation",
  };
  const button: React.CSSProperties = {
    color: "inherit", background: "rgba(45,79,112,.75)",
    border: "1px solid rgba(160,214,255,.56)",
    borderRadius: 4, padding: "7px 9px", fontSize: 10,
  };
  return (
    <aside data-artist-combat-qa={ARTIST_PRIVATE_COMBAT_VERSION}
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
          <span>Rig: {info.mappedBones} mapped bones · mesh: {info.triangles.toLocaleString()} tris</span>
          <span>Textured PBR materials: {info.texturedMaterials}</span>
          <span>Render frames/s: {info.renderFps.toFixed(1)} (estimated)</span>
          <span>Draw calls: {info.drawCalls} · scene tris: {info.sceneTriangles.toLocaleString()}</span>
          {info.error && <span role="alert" style={{ color: "#ffb4b4", overflowWrap: "anywhere" }}>Fallback: {info.error}</span>}
          <span>Chrome/Safari render FPS is not GPU frame timing. Inspect on a real iPhone.</span>
          <button type="button" style={button} onClick={captureFrame}>SAVE FIGHT SCREENSHOT</button>
          <button type="button" style={button} onClick={onExit}>END PRIVATE TEST</button>
        </div>
      )}
    </aside>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { FIGHTER_DEFINITIONS } from "@/src/game/definitions";
import { ModelViewer } from "@/src/game/model-viewer";
import {
  unavailableModelViewerMotionSnapshot,
  type ModelViewerMotionSnapshot,
} from "@/src/game/model-viewer-motion";
import { DEFAULT_FIGHTER_MODEL_ID, FIGHTER_MODEL_OPTIONS, type FighterModelId } from "@/src/game/model-skins";

export interface ModelViewerPanelProps {
  quality: "LOW" | "NORMAL" | "HIGH";
  onBack: () => void;
}

const fighterIds = ["blue", "red"] as const;
const speedOptions = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0.00";
  return Math.max(0, seconds).toFixed(2);
}

const transportButtonStyle = {
  minWidth: 38,
  minHeight: 36,
  padding: "7px 9px",
  border: "1px solid rgba(175,218,255,.28)",
  background: "rgba(5,15,30,.88)",
  color: "#d8e8f7",
  fontSize: 9,
  fontWeight: 900,
  letterSpacing: ".08em",
} as const;

export function ModelViewerPanel({ quality, onBack }: ModelViewerPanelProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<ModelViewer | null>(null);
  const [fighterId, setFighterId] = useState<(typeof fighterIds)[number]>("blue");
  const [modelId, setModelId] = useState<FighterModelId>(DEFAULT_FIGHTER_MODEL_ID);
  const [fallback, setFallback] = useState<string | null>(null);
  const [motionState, setMotionState] = useState<ModelViewerMotionSnapshot>(() => unavailableModelViewerMotionSnapshot(true));
  const fighter = FIGHTER_DEFINITIONS[fighterId];
  const motionReady = motionState.available && motionState.clips.length > 0;
  const timeline = motionState.duration > 0 ? Math.min(1, motionState.time / motionState.duration) : 0;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    setFallback(null);
    setMotionState(unavailableModelViewerMotionSnapshot(modelId === "QUATERNIUS_UBC"));
    let viewer: ModelViewer;
    try {
      viewer = new ModelViewer(host, {
        definition: fighter,
        quality,
        modelId,
        onFallback: setFallback,
        onMotionState: setMotionState,
      });
      viewerRef.current = viewer;
      viewer.start();
    } catch (error) {
      console.error("[POLY FIGHTER] model viewer startup failed", error);
      host.replaceChildren();
      window.setTimeout(() => setFallback("MODEL VIEWを開始できませんでした。Safariを再読み込みしてください。"), 0);
      return undefined;
    }
    return () => {
      viewerRef.current = null;
      viewer.destroy();
    };
  }, [fighter, modelId, quality]);

  return (
    <section
      aria-label="Model View"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 7,
        overflow: "hidden",
        background: "#050d19",
        touchAction: "none",
      }}
    >
      <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: "radial-gradient(circle at 50% 40%, transparent 0 34%, rgba(3,8,18,.36) 72%, rgba(3,8,18,.72) 100%)",
        }}
      />

      <header
        style={{
          position: "absolute",
          zIndex: 2,
          top: "max(18px, env(safe-area-inset-top))",
          left: "max(20px, env(safe-area-inset-left))",
          right: "max(20px, env(safe-area-inset-right))",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          pointerEvents: "none",
        }}
      >
        <div>
          <div style={{ color: "#5ce8ff", fontSize: 10, letterSpacing: ".24em", fontWeight: 800 }}>MODEL VIEW // CHARACTER LAB</div>
          <div style={{ marginTop: 5, fontSize: "clamp(28px, 6vw, 58px)", lineHeight: .9, fontWeight: 950, fontStyle: "italic", letterSpacing: "-.04em" }}>{fighter.name}</div>
          <div style={{ marginTop: 6, color: "#91a7bf", fontSize: 9, letterSpacing: ".18em" }}>{fighter.callsign} / {fighter.archetype}</div>
        </div>
        <div style={{ color: "#7894ae", fontSize: 8, letterSpacing: ".16em", textAlign: "right" }}>PRODUCTION VISUAL<br />QUALITY {quality}</div>
      </header>

      <div
        style={{
          position: "absolute",
          zIndex: 3,
          right: "max(18px, env(safe-area-inset-right))",
          top: "50%",
          transform: "translateY(-50%)",
          display: "flex",
          flexDirection: "column",
          gap: 9,
        }}
      >
        {fighterIds.map((id) => {
          const value = FIGHTER_DEFINITIONS[id];
          const active = id === fighterId;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              onClick={() => setFighterId(id)}
              style={{
                minWidth: 104,
                padding: "11px 14px",
                border: active ? "1px solid #5ce8ff" : "1px solid rgba(175,218,255,.25)",
                background: active ? "rgba(24,61,91,.9)" : "rgba(5,15,30,.76)",
                color: active ? "#f5fbff" : "#91a7bf",
                fontSize: 10,
                fontWeight: 900,
                letterSpacing: ".16em",
                textAlign: "left",
                boxShadow: active ? `inset 4px 0 #${value.colors.primary.toString(16).padStart(6, "0")}` : "none",
              }}
            >
              {value.name}
            </button>
          );
        })}
        <div style={{ marginTop: 8, color: "#7894ae", fontSize: 8, letterSpacing: ".16em" }}>VISUAL MODEL</div>
        {FIGHTER_MODEL_OPTIONS.map((option) => {
          const active = option.id === modelId;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() => setModelId(option.id)}
              style={{
                minWidth: 104,
                padding: "9px 12px",
                border: active ? "1px solid #5ce8ff" : "1px solid rgba(175,218,255,.25)",
                background: active ? "rgba(24,61,91,.9)" : "rgba(5,15,30,.76)",
                color: active ? "#f5fbff" : "#91a7bf",
                fontSize: 9,
                fontWeight: 900,
                letterSpacing: ".12em",
                textAlign: "left",
              }}
            >
              {option.label}<br /><small style={{ fontSize: 6, opacity: .7 }}>{option.detail}</small>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => viewerRef.current?.reset()}
          style={{
            marginTop: 5,
            padding: "10px 12px",
            border: "1px solid rgba(175,218,255,.25)",
            background: "rgba(5,15,30,.76)",
            color: "#bdd1e4",
            fontSize: 9,
            letterSpacing: ".15em",
          }}
        >
          RESET VIEW
        </button>
      </div>

      <div
        aria-label="Motion Viewer"
        style={{
          position: "absolute",
          zIndex: 4,
          left: "max(118px, calc(env(safe-area-inset-left) + 104px))",
          right: "max(136px, calc(env(safe-area-inset-right) + 122px))",
          bottom: "max(14px, env(safe-area-inset-bottom))",
          minWidth: 0,
          padding: "9px 11px 10px",
          border: "1px solid rgba(92,232,255,.26)",
          background: "linear-gradient(180deg, rgba(9,26,46,.92), rgba(4,13,26,.94))",
          boxShadow: "0 12px 38px rgba(0,0,0,.34)",
          backdropFilter: "blur(10px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          <div style={{ flex: "0 0 auto", color: "#5ce8ff", fontSize: 8, fontWeight: 950, letterSpacing: ".18em" }}>MOTION VIEWER</div>
          {motionReady ? (
            <>
              <select
                aria-label="Motion clip"
                value={motionState.clipName}
                onChange={(event) => viewerRef.current?.setMotionClip(event.target.value)}
                style={{
                  flex: "1 1 190px",
                  minWidth: 96,
                  height: 36,
                  border: "1px solid rgba(175,218,255,.28)",
                  background: "#071528",
                  color: "#eef8ff",
                  fontSize: 10,
                  fontWeight: 800,
                  padding: "0 7px",
                }}
              >
                {motionState.clips.map((clip) => (
                  <option key={clip.name} value={clip.name}>{clip.source === "PROCEDURAL" ? "PF / " : "BASE / "}{clip.name}</option>
                ))}
              </select>
              <button type="button" aria-label="Restart motion" onClick={() => viewerRef.current?.restartMotion()} style={transportButtonStyle}>↺</button>
              <button type="button" aria-label={motionState.playing ? "Pause motion" : "Play motion"} onClick={() => viewerRef.current?.toggleMotionPlayback()} style={{ ...transportButtonStyle, minWidth: 54, borderColor: "rgba(92,232,255,.52)", color: "#f5fbff" }}>
                {motionState.playing ? "Ⅱ PAUSE" : "▶ PLAY"}
              </button>
              <button type="button" aria-label="Previous frame" onClick={() => viewerRef.current?.stepMotion(-1)} style={transportButtonStyle}>−1F</button>
              <button type="button" aria-label="Next frame" onClick={() => viewerRef.current?.stepMotion(1)} style={transportButtonStyle}>+1F</button>
              <button
                type="button"
                aria-pressed={motionState.loop}
                onClick={() => viewerRef.current?.setMotionLoop(!motionState.loop)}
                style={{ ...transportButtonStyle, color: motionState.loop ? "#5ce8ff" : "#7894ae" }}
              >
                LOOP
              </button>
              <select
                aria-label="Playback speed"
                value={String(motionState.speed)}
                onChange={(event) => viewerRef.current?.setMotionSpeed(Number(event.target.value))}
                style={{
                  width: 64,
                  height: 36,
                  border: "1px solid rgba(175,218,255,.28)",
                  background: "#071528",
                  color: "#d8e8f7",
                  fontSize: 9,
                  fontWeight: 800,
                }}
              >
                {speedOptions.map((speed) => <option key={speed} value={speed}>{speed}×</option>)}
              </select>
            </>
          ) : (
            <div style={{ flex: 1, color: motionState.loading ? "#bdd1e4" : "#7894ae", fontSize: 8, letterSpacing: ".1em" }}>
              {motionState.loading ? "LOADING RETARGETED MOTION LIBRARY…" : "SELECT UBC CC0 TO INSPECT FIGHT MOTIONS"}
            </div>
          )}
        </div>
        <div style={{ marginTop: 7, display: "grid", gridTemplateColumns: "48px minmax(80px, 1fr) 48px", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#91a7bf", fontSize: 8, fontVariantNumeric: "tabular-nums" }}>{formatTime(motionState.time)}s</span>
          <input
            aria-label="Motion timeline"
            type="range"
            min={0}
            max={1000}
            step={1}
            disabled={!motionReady}
            value={Math.round(timeline * 1000)}
            onChange={(event) => viewerRef.current?.seekMotion(Number(event.target.value) / 1000)}
            style={{ width: "100%", accentColor: "#5ce8ff" }}
          />
          <span style={{ color: "#91a7bf", fontSize: 8, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatTime(motionState.duration)}s</span>
        </div>
      </div>

      <footer
        style={{
          position: "absolute",
          zIndex: 5,
          left: "max(18px, env(safe-area-inset-left))",
          right: "max(18px, env(safe-area-inset-right))",
          bottom: "max(17px, env(safe-area-inset-bottom))",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "end",
          gap: 16,
          pointerEvents: "none",
        }}
      >
        <button
          type="button"
          onClick={onBack}
          style={{
            pointerEvents: "auto",
            padding: "11px 16px",
            border: "1px solid rgba(175,218,255,.32)",
            background: "rgba(5,15,30,.78)",
            color: "#d8e8f7",
            fontSize: 10,
            letterSpacing: ".18em",
          }}
        >
          ← TITLE
        </button>
        <div style={{ color: "#7894ae", fontSize: 8, letterSpacing: ".14em", textAlign: "right", lineHeight: 1.7 }}>
          DRAG TO ORBIT<br />PINCH TO ZOOM
        </div>
      </footer>

      {fallback && (
        <div
          role="alert"
          style={{
            position: "absolute",
            zIndex: 5,
            inset: 0,
            display: "grid",
            placeItems: "center",
            padding: 30,
            background: "rgba(3,9,20,.94)",
            color: "#e7f4ff",
            textAlign: "center",
          }}
        >
          <div><strong>MODEL VIEW FALLBACK</strong><p style={{ color: "#91a7bf" }}>{fallback}</p><button type="button" onClick={onBack} style={{ padding: "10px 16px", border: "1px solid #5ce8ff", background: "transparent" }}>RETURN TO TITLE</button></div>
        </div>
      )}
    </section>
  );
}

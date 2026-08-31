"use client";

import { useEffect, useRef, useState } from "react";
import { FIGHTER_DEFINITIONS } from "@/src/game/definitions";
import { ModelViewer } from "@/src/game/model-viewer";
import { DEFAULT_FIGHTER_MODEL_ID, FIGHTER_MODEL_OPTIONS, type FighterModelId } from "@/src/game/model-skins";

export interface ModelViewerPanelProps {
  quality: "LOW" | "NORMAL" | "HIGH";
  onBack: () => void;
}

const fighterIds = ["blue", "red"] as const;

export function ModelViewerPanel({ quality, onBack }: ModelViewerPanelProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<ModelViewer | null>(null);
  const [fighterId, setFighterId] = useState<(typeof fighterIds)[number]>("blue");
  const [modelId, setModelId] = useState<FighterModelId>(DEFAULT_FIGHTER_MODEL_ID);
  const [fallback, setFallback] = useState<string | null>(null);
  const fighter = FIGHTER_DEFINITIONS[fighterId];

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    setFallback(null);
    let viewer: ModelViewer;
    try {
      viewer = new ModelViewer(host, {
        definition: fighter,
        quality,
        modelId,
        onFallback: setFallback,
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

      <footer
        style={{
          position: "absolute",
          zIndex: 3,
          left: "max(18px, env(safe-area-inset-left))",
          right: "max(18px, env(safe-area-inset-right))",
          bottom: "max(17px, env(safe-area-inset-bottom))",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "end",
          gap: 16,
        }}
      >
        <button
          type="button"
          onClick={onBack}
          style={{
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
        <div style={{ color: "#7894ae", fontSize: 8, letterSpacing: ".14em", textAlign: "right", lineHeight: 1.7, pointerEvents: "none" }}>
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

"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { FIGHTER_DEFINITIONS } from "@/src/game/definitions";
import { PolyFightGame } from "@/src/game/game";
import type { CpuDifficulty } from "@/src/game/fighter";
import type { HudSnapshot, InputAction } from "@/src/game/types";

type Screen = "TITLE" | "SELECT" | "MATCH" | "RESULT";
type SettingsDraft = {
  quality: "LOW" | "NORMAL" | "HIGH";
  cameraShake: boolean;
  audio: boolean;
  vibration: boolean;
};

const DEFAULT_SETTINGS: SettingsDraft = {
  quality: "NORMAL",
  cameraShake: true,
  audio: true,
  vibration: true,
};

function requestLandscape(): void {
  try {
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (value: "landscape") => Promise<void>;
    };
    void orientation.lock?.("landscape").catch(() => undefined);
  } catch {
    // Orientation locking is optional on iOS Safari.
  }
}

function pressableAction(
  gameRef: { current: PolyFightGame | null },
  action: InputAction,
  label: string,
  children: ReactNode,
  className = "",
) {
  return (
    <button
      type="button"
      className={`touch-action ${className}`}
      aria-label={label}
      onPointerDown={(event) => {
        event.preventDefault();
        const owner = `${action}-${event.pointerId}`;
        gameRef.current?.press(action, owner);
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerUp={(event) => {
        event.preventDefault();
        gameRef.current?.release(action, `${action}-${event.pointerId}`);
      }}
      onPointerCancel={(event) => gameRef.current?.release(action, `${action}-${event.pointerId}`)}
      onLostPointerCapture={(event) => gameRef.current?.release(action, `${action}-${event.pointerId}`)}
    >
      {children}
    </button>
  );
}

function HealthBar({ value, reverse = false }: { value: number; reverse?: boolean }) {
  return (
    <div className={`health-track ${reverse ? "reverse" : ""}`}>
      <div className="health-fill" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export default function Home() {
  const mountRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<PolyFightGame | null>(null);
  const [screen, setScreen] = useState<Screen>("TITLE");
  const [p1Choice, setP1Choice] = useState("red");
  const [p2Choice, setP2Choice] = useState("blue");
  const [difficulty, setDifficulty] = useState<CpuDifficulty>("NORMAL");
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [paused, setPaused] = useState(false);
  const [settings, setSettings] = useState<SettingsDraft>(() => {
    if (typeof window === "undefined") return DEFAULT_SETTINGS;
    try {
      const stored = window.localStorage.getItem("poly-fighter-settings-v1");
      return stored ? { ...DEFAULT_SETTINGS, ...(JSON.parse(stored) as Partial<SettingsDraft>) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  const settingsRef = useRef(settings);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (screen !== "MATCH" || !mountRef.current) return undefined;
    setFallback(null);
    let game: PolyFightGame;
    try {
      game = new PolyFightGame(mountRef.current, {
        p1Definition: FIGHTER_DEFINITIONS[p1Choice] ?? FIGHTER_DEFINITIONS.red,
        p2Definition: FIGHTER_DEFINITIONS[p2Choice] ?? FIGHTER_DEFINITIONS.blue,
        difficulty,
        onHud: setHud,
        onFallback: setFallback,
        onResult: (winner) => {
          setHud((current) => (current ? { ...current, message: winner === "draw" ? "DRAW" : `${winner === "p1" ? "PLAYER 1" : "PLAYER 2"} WINS` } : current));
          setScreen("RESULT");
        },
      });
    } catch {
      return undefined;
    }
    game.updateSettings(settingsRef.current);
    gameRef.current = game;
    game.start();
    return () => {
      gameRef.current = null;
      game.destroy();
    };
  }, [difficulty, p1Choice, p2Choice, screen]);

  const persistSettings = (patch: Partial<SettingsDraft>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    settingsRef.current = next;
    try {
      window.localStorage.setItem("poly-fighter-settings-v1", JSON.stringify(next));
    } catch {
      // Local settings are best effort.
    }
    gameRef.current?.updateSettings(patch);
  };

  const startMatch = () => {
    requestLandscape();
    setHud(null);
    setScreen("MATCH");
  };

  const backToTitle = () => {
    requestLandscape();
    setPaused(false);
    setScreen("TITLE");
  };

  const cycleQuality = () => {
    const values: SettingsDraft["quality"][] = ["LOW", "NORMAL", "HIGH"];
    const index = values.indexOf(settings.quality);
    persistSettings({ quality: values[(index + 1) % values.length] });
  };

  const p1 = FIGHTER_DEFINITIONS[p1Choice] ?? FIGHTER_DEFINITIONS.red;
  const p2 = FIGHTER_DEFINITIONS[p2Choice] ?? FIGHTER_DEFINITIONS.blue;
  const isGameSurface = screen === "MATCH" || screen === "RESULT";

  return (
    <main className="poly-app">
      <div ref={mountRef} className={`scene-host ${isGameSurface ? "visible" : ""}`} />
      <div className="scanlines" aria-hidden="true" />

      {screen === "TITLE" && (
        <section className="title-screen screen-panel">
          <div className="title-kicker">RETRO 3D DNA / MODERN POLYGON DENSITY</div>
          <h1>POLY<span>FIGHTER</span></h1>
          <p className="title-subtitle">HIGH-POLY FLAT SHADING // RING 01</p>
          <div className="title-mark"><span /> <b>01</b> <span /></div>
          <p className="title-copy">A textureless 3D duel built from light, color, and sharp geometry.</p>
          <button type="button" className="primary-button" onClick={() => { setScreen("SELECT"); requestLandscape(); }}>
            <span>START MATCH</span><small>PRESS TO ENTER THE RING</small>
          </button>
          <button type="button" className="ghost-button" onClick={() => setShowSettings(true)}>SETTINGS</button>
          <div className="title-footer"><span>iPHONE SAFARI / LANDSCAPE</span><span>BUILD 0.1 // LOCAL DUEL</span></div>
        </section>
      )}

      {screen === "SELECT" && (
        <section className="select-screen screen-panel">
          <div className="screen-heading"><span>CHARACTER SELECT</span><i>CHOOSE YOUR VECTOR</i></div>
          <div className="fighter-select-grid">
            {[FIGHTER_DEFINITIONS.red, FIGHTER_DEFINITIONS.blue].map((fighter) => {
              const selected = fighter.id === p1Choice;
              return (
                <button
                  key={`p1-${fighter.id}`}
                  type="button"
                  className={`fighter-card ${selected ? "selected-red" : ""}`}
                  onClick={() => setP1Choice(fighter.id)}
                >
                  <div className="fighter-orb" style={{ "--fighter-color": `#${fighter.colors.primary.toString(16).padStart(6, "0")}` } as CSSProperties} />
                  <strong>{fighter.name}</strong><small>{fighter.callsign}</small><em>PLAYER 1 / {fighter.archetype}</em>
                </button>
              );
            })}
          </div>
          <div className="versus-line"><span>PLAYER 1</span><b>VS</b><span>CPU // PLAYER 2</span></div>
          <div className="fighter-select-grid opponent-grid">
            {[FIGHTER_DEFINITIONS.red, FIGHTER_DEFINITIONS.blue].map((fighter) => {
              const selected = fighter.id === p2Choice;
              return (
                <button
                  key={`p2-${fighter.id}`}
                  type="button"
                  className={`fighter-card ${selected ? "selected-blue" : ""}`}
                  onClick={() => setP2Choice(fighter.id)}
                >
                  <div className="fighter-orb" style={{ "--fighter-color": `#${fighter.colors.primary.toString(16).padStart(6, "0")}` } as CSSProperties} />
                  <strong>{fighter.name}</strong><small>{fighter.callsign}</small><em>PLAYER 2 / {fighter.archetype}</em>
                </button>
              );
            })}
          </div>
          <div className="select-bottom">
            <div className="difficulty"><span>CPU DIFFICULTY</span>{(["EASY", "NORMAL", "HARD"] as CpuDifficulty[]).map((level) => <button key={level} type="button" className={difficulty === level ? "active" : ""} onClick={() => setDifficulty(level)}>{level}</button>)}</div>
            <button type="button" className="primary-button compact" onClick={startMatch}><span>ENTER RING</span><small>{p1.name} / {p2.name}</small></button>
          </div>
          <button type="button" className="back-button" onClick={backToTitle}>← TITLE</button>
        </section>
      )}

      {isGameSurface && (
        <>
          <section className="fight-hud" aria-live="polite">
            <div className="hud-player left-player"><div className="hud-name"><span>PLAYER 1</span><strong>{hud?.p1Name ?? p1.name}</strong></div><HealthBar value={hud?.p1Health ?? 100} /><div className="win-pips"><i className={(hud?.p1Wins ?? 0) > 0 ? "won" : ""} /><i className={(hud?.p1Wins ?? 0) > 1 ? "won" : ""} /></div></div>
            <div className="round-readout"><span>ROUND {hud?.round ?? 1}</span><b>{String(hud?.timer ?? 60).padStart(2, "0")}</b><small>{hud?.message ?? "ROUND 1"}</small></div>
            <div className="hud-player right-player"><div className="hud-name"><span>CPU // PLAYER 2</span><strong>{hud?.p2Name ?? p2.name}</strong></div><HealthBar value={hud?.p2Health ?? 100} reverse /><div className="win-pips"><i className={(hud?.p2Wins ?? 0) > 0 ? "won" : ""} /><i className={(hud?.p2Wins ?? 0) > 1 ? "won" : ""} /></div></div>
          </section>
          <div className="match-badge">HIGH-POLY FLAT SHADING <span>•</span> RING OUT ACTIVE</div>
          <button type="button" className="pause-button" aria-label={paused ? "Resume" : "Pause"} onClick={() => { const next = !paused; setPaused(next); if (next) gameRef.current?.pause(); else gameRef.current?.resume(); }}> {paused ? "▶" : "Ⅱ"} </button>
          <section className="touch-controls" aria-label="Touch controls">
            <div className="dpad" aria-label="Direction input">
              {pressableAction(gameRef, "up", "Jump or axis up", "▲", "up")}
              {pressableAction(gameRef, "left", "Move left", "◀", "left")}
              <div className="dpad-core">AXIS<br /><span>G + ↕</span></div>
              {pressableAction(gameRef, "right", "Move right", "▶", "right")}
              {pressableAction(gameRef, "down", "Crouch or axis down", "▼", "down")}
            </div>
            <div className="action-buttons">
              {pressableAction(gameRef, "guard", "Guard", "G", "guard")}
              {pressableAction(gameRef, "punch", "Punch", "P", "punch")}
              {pressableAction(gameRef, "kick", "Kick", "K", "kick")}
            </div>
          </section>
          <div className="input-hint">PUNCH <b>P</b> / KICK <b>K</b> / GUARD <b>G</b> <span>•</span> HOLD G + ▲▼ TO SIDESTEP</div>
        </>
      )}

      {screen === "RESULT" && (
        <section className="result-panel screen-panel">
          <span className="result-kicker">MATCH COMPLETE</span>
          <h2>{hud?.message ?? "RESULT"}</h2>
          <div className="result-score"><b>{hud?.p1Wins ?? 0}</b><span>—</span><b>{hud?.p2Wins ?? 0}</b></div>
          <button type="button" className="primary-button compact" onClick={() => setScreen("MATCH")}><span>REMATCH</span><small>RUN IT BACK</small></button>
          <button type="button" className="ghost-button" onClick={backToTitle}>TITLE</button>
        </section>
      )}

      {fallback && <section className="fallback-panel screen-panel"><h2>WEBGL FALLBACK</h2><p>{fallback}</p><button type="button" className="ghost-button" onClick={backToTitle}>RETURN TO TITLE</button></section>}

      {showSettings && (
        <section className="settings-panel screen-panel">
          <div className="screen-heading"><span>SETTINGS</span><i>DEVICE SAFE DEFAULTS</i></div>
          <button type="button" className="setting-row" onClick={cycleQuality}><span>GRAPHICS QUALITY</span><b>{settings.quality}</b></button>
          <button type="button" className="setting-row" onClick={() => persistSettings({ cameraShake: !settings.cameraShake })}><span>CAMERA SHAKE</span><b>{settings.cameraShake ? "ON" : "OFF"}</b></button>
          <button type="button" className="setting-row" onClick={() => persistSettings({ audio: !settings.audio })}><span>SYNTH AUDIO</span><b>{settings.audio ? "ON" : "OFF"}</b></button>
          <button type="button" className="setting-row" onClick={() => persistSettings({ vibration: !settings.vibration })}><span>HAPTIC FEEDBACK</span><b>{settings.vibration ? "ON" : "OFF"}</b></button>
          <button type="button" className="ghost-button" onClick={() => setShowSettings(false)}>DONE</button>
        </section>
      )}
    </main>
  );
}

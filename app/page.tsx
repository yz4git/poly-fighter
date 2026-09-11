"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { FIGHTER_DEFINITIONS } from "@/src/game/definitions";
import { TpsFightGame } from "@/src/game/tps-game";
import { ReferenceReconstructionPanel } from "@/src/components/reference-reconstruction";
import { ModelViewerPanel } from "@/src/components/model-viewer-panel";
import type { CpuDifficulty } from "@/src/game/fighter";
import type { HudSnapshot, InputAction } from "@/src/game/types";
import { advanceTpsTrainingStage, EMPTY_TPS_TRAINING, TPS_TRAINING_STEPS, type TpsTrainingStage } from "@/src/game/tps-training";
import { DEFAULT_FIGHTER_MODEL_ID, FIGHTER_MODEL_OPTIONS, type FighterModelId } from "@/src/game/model-skins";
import {
  RIVAL_CIRCUIT_ENCOUNTERS,
  rivalCircuitProtocolOffers,
  rivalCircuitRunGrade,
  scoreRivalCircuitPerformance,
  type RivalCircuitPerformance,
  type RivalCircuitProtocolId,
} from "@/src/game/rival-circuit";
import {
  directionToInput,
  directionVector,
  VirtualPadTracker,
  type DigitalDirection,
} from "@/src/game/virtual-pad";

type Screen =
  | "TITLE"
  | "SELECT"
  | "MODEL_VIEW"
  | "TPS_MATCH"
  | "TRAINING"
  | "RESULT"
  | "CIRCUIT_MATCH"
  | "CIRCUIT_REWARD"
  | "CIRCUIT_RESULT";
type MatchMode = "VERSUS" | "CIRCUIT";
type GameRuntime = TpsFightGame;
type CircuitOutcome = "ACTIVE" | "COMPLETE" | "DEFEAT";
type CircuitRecord = {
  encounterId: string;
  codename: string;
  winner: "p1" | "p2" | "draw";
  performance: RivalCircuitPerformance;
};
type SettingsDraft = {
  quality: "LOW" | "NORMAL" | "HIGH";
  cameraShake: boolean;
  audio: boolean;
  vibration: boolean;
  motionCorrections: boolean;
};

const DEFAULT_SETTINGS: SettingsDraft = {
  quality: "NORMAL",
  cameraShake: true,
  audio: true,
  vibration: true,
  motionCorrections: false,
};

function requestLandscape(): void {
  try {
    const orientation = (typeof window !== "undefined" ? window.screen?.orientation : undefined) as (ScreenOrientation & { lock?: (mode: string) => Promise<void> }) | undefined;
    if (!orientation?.lock) return;
    void orientation.lock("landscape").catch(() => undefined);
  } catch {
    // Orientation locking is optional on iOS Safari.
  }
}

function pressableAction(
  gameRef: { current: GameRuntime | null },
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

const PAD_DIRECTIONS: InputAction[] = ["left", "right", "up", "down"];

function VirtualPad({
  gameRef,
  paused,
}: {
  gameRef: { current: GameRuntime | null };
  paused: boolean;
}) {
  const padRef = useRef<HTMLDivElement>(null);
  const trackerRef = useRef(new VirtualPadTracker());
  const ownerRef = useRef<string | null>(null);
  const directionRef = useRef<DigitalDirection>("NEUTRAL");
  const [direction, setDirection] = useState<DigitalDirection>("NEUTRAL");

  const clear = useCallback(() => {
    const owner = ownerRef.current;
    if (owner) gameRef.current?.releaseOwner(owner);
    trackerRef.current.reset();
    ownerRef.current = null;
    directionRef.current = "NEUTRAL";
    setDirection("NEUTRAL");
  }, [gameRef]);

  const applyPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const pad = padRef.current;
    const pointerId = trackerRef.current.pointerId;
    const owner = ownerRef.current;
    if (!pad || pointerId === null || owner === null || pointerId !== event.pointerId) return;
    const rect = pad.getBoundingClientRect();
    const radius = Math.min(rect.width, rect.height) * 0.5;
    const centerX = rect.left + rect.width * 0.5;
    const centerY = rect.top + rect.height * 0.5;
    const next = trackerRef.current.move(
      event.pointerId,
      event.clientX - centerX,
      centerY - event.clientY,
      radius,
    );
    if (next === directionRef.current) return;
    directionRef.current = next;
    setDirection(next);
    gameRef.current?.releaseOwner(owner);
    const frame = directionToInput(next);
    for (const action of PAD_DIRECTIONS) {
      if (frame[action]) gameRef.current?.press(action, owner);
    }
  }, [gameRef]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) clear();
    };
    const onOrientationChange = () => clear();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("orientationchange", onOrientationChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("orientationchange", onOrientationChange);
    };
  }, [clear]);

  useEffect(() => {
    if (!paused) return undefined;
    const timeout = window.setTimeout(clear, 0);
    return () => window.clearTimeout(timeout);
  }, [clear, paused]);

  useEffect(() => () => clear(), [clear]);

  const vector = directionVector(direction);
  const knobStyle = {
    transform: `translate(calc(-50% + ${vector.x * 31}px), calc(-50% - ${vector.y * 31}px))`,
  };

  const begin = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (paused || trackerRef.current.pointerId !== null) return;
    event.preventDefault();
    const rect = padRef.current?.getBoundingClientRect();
    if (!rect) return;
    const radius = Math.min(rect.width, rect.height) * 0.5;
    ownerRef.current = `virtual-pad-${event.pointerId}`;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    gameRef.current?.interact();
    trackerRef.current.begin(event.pointerId, event.clientX - (rect.left + rect.width * 0.5), (rect.top + rect.height * 0.5) - event.clientY, radius);
    applyPointer(event);
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    applyPointer(event);
  };
  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (trackerRef.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    trackerRef.current.release(event.pointerId);
    clear();
  };

  return (
    <div
      ref={padRef}
      className="virtual-pad"
      aria-label={`8-way direction input: ${direction}`}
      data-direction={direction}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    >
      <div className="virtual-pad-sector" aria-hidden="true" />
      <div className="virtual-pad-ring" aria-hidden="true" />
      <div className="virtual-pad-knob" style={knobStyle} aria-hidden="true" />
      <span className="virtual-pad-label">8-WAY</span>
    </div>
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
  const gameRef = useRef<GameRuntime | null>(null);
  const hudRef = useRef<HudSnapshot | null>(null);
  const [screen, setScreen] = useState<Screen>("TITLE");
  const [matchMode, setMatchMode] = useState<MatchMode>("VERSUS");
  const [p1Choice, setP1Choice] = useState("red");
  const [p2Choice, setP2Choice] = useState("blue");
  const [modelChoice, setModelChoice] = useState<FighterModelId>(DEFAULT_FIGHTER_MODEL_ID);
  const [difficulty, setDifficulty] = useState<CpuDifficulty>("NORMAL");
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [paused, setPaused] = useState(false);
  const [trainingStage, setTrainingStage] = useState<TpsTrainingStage>(0);
  const trainingProgressRef = useRef(EMPTY_TPS_TRAINING);
  const [circuitStage, setCircuitStage] = useState(0);
  const [circuitScore, setCircuitScore] = useState(0);
  const [circuitProtocols, setCircuitProtocols] = useState<RivalCircuitProtocolId[]>([]);
  const [circuitHistory, setCircuitHistory] = useState<CircuitRecord[]>([]);
  const [circuitOutcome, setCircuitOutcome] = useState<CircuitOutcome>("ACTIVE");
  const [referenceMode, setReferenceMode] = useState(false);
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

  const circuitEncounter = RIVAL_CIRCUIT_ENCOUNTERS[Math.min(circuitStage, RIVAL_CIRCUIT_ENCOUNTERS.length - 1)];
  const circuitOpponentChoice = circuitEncounter?.fighterId ?? "blue";

  useEffect(() => {
    const referenceTimeout = window.setTimeout(() => {
      setReferenceMode(new URLSearchParams(window.location.search).get("reference") === "1");
    }, 0);
    const preventContextMenu = (event: Event) => event.preventDefault();
    window.addEventListener("contextmenu", preventContextMenu, { passive: false });
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker
        .register("/sw.js", { updateViaCache: "none" })
        .then((registration) => registration.update())
        .catch(() => undefined);
    }
    return () => {
      window.clearTimeout(referenceTimeout);
      window.removeEventListener("contextmenu", preventContextMenu);
    };
  }, []);

  useEffect(() => {
    if (!["TPS_MATCH", "TRAINING", "CIRCUIT_MATCH"].includes(screen) || !mountRef.current) return undefined;
    setFallback(null);
    let game: GameRuntime;
    let reportedFallback = false;
    const circuitMatch = screen === "CIRCUIT_MATCH";
    const opponentChoice = circuitMatch ? circuitOpponentChoice : p2Choice;
    const activeDifficulty = screen === "TRAINING" ? "EASY" : circuitMatch ? circuitEncounter.difficulty : difficulty;
    try {
      game = new TpsFightGame(mountRef.current, {
        p1Definition: FIGHTER_DEFINITIONS[p1Choice] ?? FIGHTER_DEFINITIONS.red,
        p2Definition: FIGHTER_DEFINITIONS[opponentChoice] ?? FIGHTER_DEFINITIONS.blue,
        p1Model: modelChoice,
        p2Model: modelChoice,
        difficulty: activeDifficulty,
        training: screen === "TRAINING",
        onHud: (snapshot) => {
          hudRef.current = snapshot;
          setHud(snapshot);
        },
        onFallback: (message) => {
          reportedFallback = true;
          setFallback(message);
        },
        onResult: (winner) => {
          const finalHud = hudRef.current;
          setHud((current) => (current ? { ...current, message: winner === "draw" ? "DRAW" : `${winner === "p1" ? "PLAYER 1" : "PLAYER 2"} WINS` } : current));
          if (screen === "CIRCUIT_MATCH") {
            const performance = scoreRivalCircuitPerformance(finalHud, winner, circuitProtocols);
            const record: CircuitRecord = {
              encounterId: circuitEncounter.id,
              codename: circuitEncounter.codename,
              winner,
              performance,
            };
            setCircuitHistory((current) => [...current, record]);
            if (winner === "p1") {
              setCircuitScore((current) => current + performance.score);
              if (circuitStage >= RIVAL_CIRCUIT_ENCOUNTERS.length - 1) {
                setCircuitOutcome("COMPLETE");
                setScreen("CIRCUIT_RESULT");
              } else {
                setScreen("CIRCUIT_REWARD");
              }
            } else {
              setCircuitOutcome("DEFEAT");
              setScreen("CIRCUIT_RESULT");
            }
            return;
          }
          if (screen !== "TRAINING") setScreen("RESULT");
        },
      });
    } catch (error) {
      console.error("[POLY FIGHTER] game startup failed", error);
      mountRef.current?.replaceChildren();
      if (!reportedFallback) {
        window.setTimeout(() => setFallback("3D描画を開始できませんでした。Safariを再読み込みしてもう一度お試しください。"), 0);
      }
      return undefined;
    }
    game.updateSettings(settingsRef.current);
    gameRef.current = game;
    try {
      game.start();
    } catch (error) {
      console.error("[POLY FIGHTER] game loop startup failed", error);
      gameRef.current = null;
      game.destroy();
      if (!reportedFallback) {
        window.setTimeout(() => setFallback("ゲームループを開始できませんでした。Safariを再読み込みしてもう一度お試しください。"), 0);
      }
      return undefined;
    }
    return () => {
      gameRef.current = null;
      game.destroy();
    };
  }, [circuitEncounter, circuitOpponentChoice, circuitProtocols, circuitStage, difficulty, modelChoice, p1Choice, p2Choice, screen]);

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

  useEffect(() => {
    if (screen !== "TRAINING" || !hud) return;
    const previous = trainingProgressRef.current;
    setTrainingStage((stage) => advanceTpsTrainingStage(stage, hud, previous));
    trainingProgressRef.current = hud.tpsTraining ?? previous;
  }, [hud, screen]);

  const startTraining = () => {
    requestLandscape();
    trainingProgressRef.current = EMPTY_TPS_TRAINING;
    setTrainingStage(0);
    setHud(null);
    hudRef.current = null;
    setPaused(false);
    setP1Choice("red");
    setP2Choice("blue");
    setScreen("TRAINING");
  };

  const startMatch = () => {
    requestLandscape();
    setMatchMode("VERSUS");
    setHud(null);
    hudRef.current = null;
    setPaused(false);
    setScreen("TPS_MATCH");
  };

  const startCircuit = () => {
    requestLandscape();
    setMatchMode("CIRCUIT");
    setCircuitStage(0);
    setCircuitScore(0);
    setCircuitProtocols([]);
    setCircuitHistory([]);
    setCircuitOutcome("ACTIVE");
    setHud(null);
    hudRef.current = null;
    setPaused(false);
    setScreen("SELECT");
  };

  const startCircuitMatch = () => {
    requestLandscape();
    setHud(null);
    hudRef.current = null;
    setPaused(false);
    setScreen("CIRCUIT_MATCH");
  };

  const chooseCircuitProtocol = (protocol: RivalCircuitProtocolId) => {
    setCircuitProtocols((current) => current.includes(protocol) ? current : [...current, protocol]);
    setCircuitStage((current) => Math.min(current + 1, RIVAL_CIRCUIT_ENCOUNTERS.length - 1));
    setHud(null);
    hudRef.current = null;
    setPaused(false);
    setScreen("CIRCUIT_MATCH");
  };

  const backToTitle = () => {
    requestLandscape();
    setPaused(false);
    setMatchMode("VERSUS");
    setScreen("TITLE");
  };

  const cycleQuality = () => {
    const values: SettingsDraft["quality"][] = ["LOW", "NORMAL", "HIGH"];
    const index = values.indexOf(settings.quality);
    persistSettings({ quality: values[(index + 1) % values.length] });
  };

  const p1 = FIGHTER_DEFINITIONS[p1Choice] ?? FIGHTER_DEFINITIONS.red;
  const normalP2 = FIGHTER_DEFINITIONS[p2Choice] ?? FIGHTER_DEFINITIONS.blue;
  const circuitP2 = FIGHTER_DEFINITIONS[circuitOpponentChoice] ?? FIGHTER_DEFINITIONS.blue;
  const p2 = matchMode === "CIRCUIT" ? circuitP2 : normalP2;
  // Keep the original live-surface contract explicit for regression coverage.
  const isGameSurface = screen === "TPS_MATCH" || screen === "TRAINING";
  const isCircuitGameSurface = screen === "CIRCUIT_MATCH";
  const isPlayableSurface = isGameSurface || isCircuitGameSurface;
  const trainingStep = TPS_TRAINING_STEPS[trainingStage];
  const tpsIncoming = hud?.tpsCue === "INCOMING";
  const tpsWindup = hud?.tpsCue === "WINDUP";
  const tpsPunish = hud?.tpsCue === "PUNISH";
  const tpsIntercept = hud?.tpsCue === "WINDUP";
  const tpsStrikeRange = hud?.tpsCue === "RANGE";
  const tpsComboMessage = (hud?.message ?? "").startsWith("COMBO ");
  const tpsKoMessage = ["KO", "FINAL IMPACT"].includes(hud?.message ?? "");
  const tpsFaceSafeMessage = Boolean(hud?.message);
  const circuitOffers = rivalCircuitProtocolOffers(circuitStage, circuitProtocols);
  const lastCircuitRecord = circuitHistory.at(-1) ?? null;
  const circuitWins = circuitHistory.filter((record) => record.winner === "p1").length;
  const circuitRunGrade = rivalCircuitRunGrade(circuitScore, circuitWins);

  if (referenceMode) return <ReferenceReconstructionPanel />;

  return (
    <main className="poly-app">
      <div ref={mountRef} className={`scene-host ${isPlayableSurface ? "visible" : ""}`} />
      <div className="scanlines" aria-hidden="true" />

      {screen === "TITLE" && (
        <section className="title-screen screen-panel">
          <div className="title-kicker">RETRO 3D DNA / MODERN POLYGON DENSITY</div>
          <h1>POLY<span>FIGHTER</span></h1>
          <p className="title-subtitle">HIGH-POLY FLAT SHADING // RING 01</p>
          <div className="title-mark"><span /> <b>02</b> <span /></div>
          <p className="title-copy">A close-range 3D lock-on fighter built for direct movement, readable impact, and fast rematches.</p>
          <button type="button" className="primary-button circuit-primary" onClick={startCircuit}>
            <span>RIVAL CIRCUIT</span><small>NEW // 5 FIGHTS / STYLE GRADE / PROTOCOLS</small>
          </button>
          <button type="button" className="primary-button" onClick={() => { setMatchMode("VERSUS"); setScreen("SELECT"); requestLandscape(); }}>
            <span>START FIGHT</span><small>TPS LOCK-ON / LOADOUT SELECT</small>
          </button>
          <button type="button" className="ghost-button" onClick={startTraining}>TRAINING</button>
          <button type="button" className="ghost-button" onClick={() => { requestLandscape(); setScreen("MODEL_VIEW"); }}>MODEL VIEW</button>
          <button type="button" className="ghost-button" onClick={() => setShowSettings(true)}>SETTINGS</button>
          <div className="title-footer"><span>iPHONE SAFARI / LANDSCAPE</span><span>BUILD 0.2 // RIVAL CIRCUIT</span></div>
        </section>
      )}

      {screen === "MODEL_VIEW" && <ModelViewerPanel quality={settings.quality} onBack={backToTitle} />}

      {screen === "SELECT" && (
        <section className="select-screen screen-panel">
          <div className="screen-heading"><span>{matchMode === "CIRCUIT" ? "RIVAL CIRCUIT LOADOUT" : "TPS LOADOUT"}</span><i>{matchMode === "CIRCUIT" ? "CHOOSE YOUR FIGHTER / MODEL" : "LOCK-ON FIGHTER / CPU / DIFFICULTY"}</i></div>
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

          {matchMode === "CIRCUIT" ? (
            <div className="circuit-briefing">
              <div className="circuit-briefing-code">
                <span>STAGE {circuitEncounter.order}/5</span>
                <strong>{circuitEncounter.codename}</strong>
                <em>{circuitEncounter.style}</em>
              </div>
              <div className="circuit-briefing-copy">
                <strong>{circuitEncounter.title}</strong>
                <p>{circuitEncounter.description}</p>
                <div className="circuit-briefing-meta">
                  <span>{circuitEncounter.arenaLabel}</span>
                  <span>{circuitEncounter.difficulty}</span>
                  <span>{circuitEncounter.rule}</span>
                  <span>CPU // {circuitP2.name}</span>
                </div>
              </div>
            </div>
          ) : (
            <>
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
            </>
          )}

          <div className="difficulty" style={{ marginTop: 10 }}>
            <span>VISUAL MODEL</span>
            {FIGHTER_MODEL_OPTIONS.map((option) => (
              <button key={option.id} type="button" className={modelChoice === option.id ? "active" : ""} onClick={() => setModelChoice(option.id)}>
                {option.label}
              </button>
            ))}
          </div>
          <div style={{ color: "#7894ae", fontSize: 8, letterSpacing: ".12em", margin: "5px 0 2px" }}>
            {modelChoice === "QUATERNIUS_UBC" ? "CC0 / UNIVERSAL RIG / MOTION READY" : "POLY FIGHTER CUSTOM VISUAL"}
          </div>
          <div className="select-bottom">
            {matchMode === "CIRCUIT" ? (
              <div className="circuit-select-note">5 consecutive rivals. Win to install a Protocol and continue. One defeat ends the run.</div>
            ) : (
              <div className="difficulty"><span>CPU DIFFICULTY</span>{(["EASY", "NORMAL", "HARD"] as CpuDifficulty[]).map((level) => <button key={level} type="button" className={difficulty === level ? "active" : ""} onClick={() => setDifficulty(level)}>{level}</button>)}</div>
            )}
            <button type="button" className="primary-button compact" onClick={matchMode === "CIRCUIT" ? startCircuitMatch : startMatch}>
              <span>{matchMode === "CIRCUIT" ? "ENTER CIRCUIT" : "ENGAGE"}</span>
              <small>{p1.name} / {p2.name} / {matchMode === "CIRCUIT" ? circuitEncounter.style : difficulty}</small>
            </button>
          </div>
          <button type="button" className="back-button" onClick={backToTitle}>← TITLE</button>
        </section>
      )}

      {isPlayableSurface && (
        <>
          <section className={`fight-hud ${tpsFaceSafeMessage ? "tps-face-safe-active" : ""}`} aria-live="polite">
            <div className="hud-player left-player"><div className="hud-name"><span>PLAYER 1</span><strong>{hud?.p1Name ?? p1.name}</strong></div><HealthBar value={hud?.p1Health ?? 100} /><div className="win-pips"><i className={(hud?.p1Wins ?? 0) > 0 ? "won" : ""} /><i className={(hud?.p1Wins ?? 0) > 1 ? "won" : ""} /></div></div>
            <div className="round-readout"><span>ROUND {hud?.round ?? 1}</span><b>{String(hud?.timer ?? 60).padStart(2, "0")}</b><small>{hud?.message ?? "ROUND 1"}</small></div>
            <div className="hud-player right-player"><div className="hud-name"><span>CPU // PLAYER 2</span><strong>{hud?.p2Name ?? p2.name}</strong></div><HealthBar value={hud?.p2Health ?? 100} reverse /><div className="win-pips"><i className={(hud?.p2Wins ?? 0) > 0 ? "won" : ""} /><i className={(hud?.p2Wins ?? 0) > 1 ? "won" : ""} /></div></div>
          </section>
          <div className={`match-badge tps-badge ${tpsFaceSafeMessage ? "tps-face-safe-badge" : ""} ${tpsComboMessage ? "tps-combo-badge" : ""} ${tpsKoMessage ? "tps-ko-badge" : ""}`}>{tpsFaceSafeMessage ? <strong>{hud?.message}</strong> : <><strong>{hud?.message ?? "TARGET LOCKED"}</strong><span>•</span><b>{hud?.p2Name ?? p2.name}</b></>}</div>
          {screen === "CIRCUIT_MATCH" && (
            <div className="circuit-run-strip">
              <b>CIRCUIT {circuitEncounter.order}/5</b>
              <strong>{circuitEncounter.codename}</strong>
              <span>{circuitEncounter.style} // SCORE {circuitScore}</span>
            </div>
          )}
          <button type="button" className="pause-button tps-pause-button" aria-label={paused ? "Resume" : "Pause"} onClick={() => { const next = !paused; setPaused(next); if (next) gameRef.current?.pause(); else gameRef.current?.resume(); }}> {paused ? "▶" : "Ⅱ"} </button>
          <section className="touch-controls" aria-label="Touch controls">
            <VirtualPad gameRef={gameRef} paused={paused} />
            <div className="action-buttons tps-two-button-actions">
              {pressableAction(gameRef, "guard", "Step", tpsIncoming ? "STEP NOW" : tpsWindup ? "READY" : "STEP", "guard tps-step-action " + (tpsIncoming ? "tps-threat-action" : tpsWindup ? "tps-windup-action" : ""))}
              {pressableAction(gameRef, "punch", "Attack", tpsPunish ? "PUNISH" : tpsIntercept ? "INTERCEPT" : "ATTACK", "punch tps-attack-action " + (tpsPunish ? "tps-punish-action" : tpsIntercept ? "tps-intercept-action" : tpsStrikeRange ? "tps-ready-action" : ""))}
            </div>
          </section>
          <div className="input-hint tps-input-hint"><b>ATTACK</b> AUTO PUNCH / KICK <span>•</span> <b>WINDUP</b> STEP OR INTERCEPT <span>•</span> <b>PERFECT STEP</b> → REVERSAL <span>•</span> FORWARD STEP → ATTACK = DASH</div>
          {screen === "TRAINING" && (
            <section className={`training-coach ${trainingStage === 5 ? "complete" : ""}`} aria-live="polite">
              <span>RIVAL CORE TRAINING // {Math.min(trainingStage + 1, 6)}/6</span>
              <strong>{trainingStep.title}</strong>
              <p>{trainingStep.detail}</p>
              <div>{TPS_TRAINING_STEPS.map((_, index) => <i key={index} className={index <= trainingStage ? "done" : ""} />)}</div>
              {trainingStage === 5 && <button type="button" onClick={backToTitle}>RETURN TO TITLE</button>}
            </section>
          )}
        </>
      )}

      {screen === "CIRCUIT_REWARD" && lastCircuitRecord && (
        <section className="screen-panel circuit-reward-panel">
          <span className="circuit-reward-kicker">RIVAL DOWN // INSTALL ONE PROTOCOL</span>
          <div className="circuit-performance">
            <div className="circuit-grade">{lastCircuitRecord.performance.grade}</div>
            <div className="circuit-performance-copy">
              <strong>{lastCircuitRecord.codename} // {lastCircuitRecord.performance.score} STYLE</strong>
              <p>TECH {lastCircuitRecord.performance.techniqueBonus} / HEALTH {lastCircuitRecord.performance.healthBonus} / PROTOCOL {lastCircuitRecord.performance.protocolBonus}</p>
            </div>
          </div>
          <div className="circuit-route">
            {RIVAL_CIRCUIT_ENCOUNTERS.map((encounter, index) => <span key={encounter.id} className={index < circuitStage + 1 ? "done" : index === circuitStage + 1 ? "current" : ""}>{index + 1}</span>)}
          </div>
          <div className="protocol-grid">
            {circuitOffers.map((protocol) => (
              <button type="button" className="protocol-card" key={protocol.id} onClick={() => chooseCircuitProtocol(protocol.id)}>
                <span>{protocol.kicker}</span>
                <strong>{protocol.name}</strong>
                <p>{protocol.detail}</p>
              </button>
            ))}
          </div>
          {circuitProtocols.length > 0 && <div className="circuit-protocol-owned" style={{ marginTop: 10 }}>{circuitProtocols.map((protocol) => <span key={protocol}>{protocol.replaceAll("_", " ")}</span>)}</div>}
        </section>
      )}

      {screen === "CIRCUIT_RESULT" && (
        <section className="screen-panel result-panel circuit-result-panel">
          <span className="circuit-result-kicker">{circuitOutcome === "COMPLETE" ? "RIVAL CIRCUIT CLEARED" : "RIVAL CIRCUIT TERMINATED"}</span>
          <h2>{circuitOutcome === "COMPLETE" ? "CIRCUIT COMPLETE" : "RUN ENDED"}</h2>
          <div className="circuit-result-score"><b>{circuitRunGrade}</b><span>{circuitScore} PTS</span></div>
          <div className="circuit-history">
            {circuitHistory.map((record, index) => (
              <div className="circuit-history-row" key={`${record.encounterId}-${index}`}>
                <strong>{index + 1}. {record.codename}</strong>
                <span>{record.winner === "p1" ? "WIN" : record.winner === "draw" ? "DRAW" : "LOSS"}</span>
                <b>{record.performance.grade} / {record.performance.score}</b>
              </div>
            ))}
          </div>
          {circuitProtocols.length > 0 && <div className="circuit-protocol-owned" style={{ justifyContent: "center", marginBottom: 12 }}>{circuitProtocols.map((protocol) => <span key={protocol}>{protocol.replaceAll("_", " ")}</span>)}</div>}
          <button type="button" className="primary-button compact" onClick={startCircuit}><span>NEW CIRCUIT</span><small>RESET RUN / CHOOSE FIGHTER</small></button>
          <button type="button" className="ghost-button" onClick={backToTitle}>TITLE</button>
        </section>
      )}

      {screen === "RESULT" && (
        <section className="result-panel screen-panel">
          <span className="result-kicker">MATCH COMPLETE</span>
          <h2>{hud?.message ?? "RESULT"}</h2>
          <div className="result-score"><b>{hud?.p1Wins ?? 0}</b><span>—</span><b>{hud?.p2Wins ?? 0}</b></div>
          <button type="button" className="primary-button compact" onClick={() => setScreen("TPS_MATCH")}><span>REMATCH</span><small>RE-ENGAGE TARGET</small></button>
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
          <button type="button" className="setting-row" onClick={() => persistSettings({ motionCorrections: !settings.motionCorrections })}><span>MOTION CORRECTION</span><b>{settings.motionCorrections ? "ON" : "OFF"}</b></button>
          <button type="button" className="ghost-button" onClick={() => setShowSettings(false)}>DONE</button>
        </section>
      )}
    </main>
  );
}

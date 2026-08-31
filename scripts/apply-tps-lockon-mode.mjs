import { readFile, writeFile } from "node:fs/promises";

async function patch(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after === before) {
    console.log(`${path}: already current`);
    return;
  }
  await writeFile(path, after);
  console.log(`${path}: patched`);
}

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Missing ${label}`);
  return source.replace(before, after);
}

await patch("src/game/tps-game.ts", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    "  p2Model?: FighterModelId;\n  onHud?:",
    "  p2Model?: FighterModelId;\n  difficulty?: unknown;\n  onHud?:",
    "TPS difficulty compatibility field",
  );
  source = source.replace(
    "const right = toEnemy.clone().cross(UP).normalize().multiplyScalar(-1);",
    "const right = new THREE.Vector3(-toEnemy.z, 0, toEnemy.x);",
  );
  source = source.replace(
    "const right = new THREE.Vector3(forward.z, 0, -forward.x);",
    "const right = new THREE.Vector3(-forward.z, 0, forward.x);",
  );
  return source;
});

await patch("app/page.tsx", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    'import { PolyFightGame } from "@/src/game/game";',
    'import { PolyFightGame } from "@/src/game/game";\nimport { TpsFightGame } from "@/src/game/tps-game";',
    "TPS game import",
  );
  source = replaceOnce(
    source,
    'type Screen = "TITLE" | "SELECT" | "MODEL_VIEW" | "MATCH" | "RESULT";',
    'type Screen = "TITLE" | "SELECT" | "MODEL_VIEW" | "MATCH" | "TPS_MATCH" | "RESULT";\ntype BattleMode = "DUEL" | "TPS";\ntype GameRuntime = PolyFightGame | TpsFightGame;',
    "screen types",
  );
  source = source.replaceAll(
    'gameRef: { current: PolyFightGame | null }',
    'gameRef: { current: GameRuntime | null }',
  );
  source = replaceOnce(
    source,
    'const gameRef = useRef<PolyFightGame | null>(null);',
    'const gameRef = useRef<GameRuntime | null>(null);',
    "game ref type",
  );
  source = replaceOnce(
    source,
    'const [screen, setScreen] = useState<Screen>("TITLE");',
    'const [screen, setScreen] = useState<Screen>("TITLE");\n  const [battleMode, setBattleMode] = useState<BattleMode>("DUEL");',
    "battle mode state",
  );
  source = replaceOnce(
    source,
    'if (screen !== "MATCH" || !mountRef.current) return undefined;',
    'if ((screen !== "MATCH" && screen !== "TPS_MATCH") || !mountRef.current) return undefined;',
    "game screen effect gate",
  );
  source = replaceOnce(
    source,
    'let game: PolyFightGame;',
    'let game: GameRuntime;',
    "game runtime local type",
  );
  source = replaceOnce(
    source,
    'game = new PolyFightGame(mountRef.current, {',
    'game = new (screen === "TPS_MATCH" ? TpsFightGame : PolyFightGame)(mountRef.current, {',
    "runtime constructor selection",
  );
  source = replaceOnce(
    source,
    'const startMatch = () => {\n    requestLandscape();\n    setHud(null);\n    setScreen("MATCH");\n  };',
    'const startMatch = () => {\n    requestLandscape();\n    setBattleMode("DUEL");\n    setHud(null);\n    setScreen("MATCH");\n  };\n\n  const startTpsMatch = () => {\n    requestLandscape();\n    setBattleMode("TPS");\n    setHud(null);\n    setPaused(false);\n    setScreen("TPS_MATCH");\n  };',
    "TPS start function",
  );
  source = replaceOnce(
    source,
    'const isGameSurface = screen === "MATCH" || screen === "RESULT";',
    'const isGameSurface = screen === "MATCH" || screen === "TPS_MATCH" || screen === "RESULT";',
    "game surface mode",
  );
  const titleNeedle = '          <button type="button" className="ghost-button" onClick={() => { requestLandscape(); setScreen("MODEL_VIEW"); }}>MODEL VIEW</button>';
  const titleReplacement = '          <button type="button" className="ghost-button tps-mode-button" onClick={startTpsMatch}><span>TPS LOCK-ON BATTLE</span><small>360° CIRCULAR ARENA</small></button>\n' + titleNeedle;
  source = replaceOnce(source, titleNeedle, titleReplacement, "TPS title button");
  source = replaceOnce(
    source,
    '<div className="match-badge">HIGH-POLY FLAT SHADING <span>•</span> RING OUT ACTIVE</div>',
    '<div className={`match-badge ${battleMode === "TPS" ? "tps-badge" : ""}`}>{battleMode === "TPS" ? <>TPS LOCK-ON <span>•</span> CIRCULAR ARENA</> : <>HIGH-POLY FLAT SHADING <span>•</span> RING OUT ACTIVE</>}</div>\n          {battleMode === "TPS" && <div className="tps-mode-hud"><span>LOCK</span><b>{hud?.p2Name ?? p2.name}</b><i>◇</i></div>}',
    "TPS match badge",
  );
  source = replaceOnce(
    source,
    '<div className="input-hint">PUNCH <b>P</b> / KICK <b>K</b> / GUARD <b>G</b> <span>•</span> HOLD G + 8-WAY TO SIDESTEP</div>',
    '<div className="input-hint">{battleMode === "TPS" ? <>MOVE <b>8-WAY</b> / PUNCH <b>P</b> / KICK <b>K</b> / GUARD <b>G</b> <span>•</span> TARGET LOCKED</> : <>PUNCH <b>P</b> / KICK <b>K</b> / GUARD <b>G</b> <span>•</span> HOLD G + 8-WAY TO SIDESTEP</>}</div>',
    "TPS input hint",
  );
  source = replaceOnce(
    source,
    '<button type="button" className="primary-button compact" onClick={() => setScreen("MATCH")}><span>REMATCH</span><small>RUN IT BACK</small></button>',
    '<button type="button" className="primary-button compact" onClick={() => setScreen(battleMode === "TPS" ? "TPS_MATCH" : "MATCH")}><span>REMATCH</span><small>{battleMode === "TPS" ? "RE-ENGAGE TARGET" : "RUN IT BACK"}</small></button>',
    "mode-aware rematch",
  );
  return source;
});

await patch("app/globals.css", (input) => {
  if (input.includes(".tps-mode-hud")) return input;
  return input + `

/* TPS LOCK-ON BATTLE */
.tps-mode-button {
  border-color: rgba(91, 221, 255, 0.7) !important;
  background: linear-gradient(90deg, rgba(17, 70, 103, 0.46), rgba(7, 21, 38, 0.7)) !important;
}
.tps-mode-button span { display: block; font-weight: 900; letter-spacing: .14em; }
.tps-mode-button small { display: block; margin-top: .18rem; opacity: .65; font-size: .58rem; letter-spacing: .16em; }
.tps-badge { border-color: rgba(90, 226, 255, .75) !important; color: #a9f3ff !important; }
.tps-mode-hud {
  position: fixed;
  left: 50%;
  top: max(14%, calc(env(safe-area-inset-top) + 58px));
  transform: translateX(-50%);
  display: grid;
  place-items: center;
  pointer-events: none;
  z-index: 7;
  color: #aaf4ff;
  text-shadow: 0 0 12px rgba(65, 214, 255, .75);
}
.tps-mode-hud span { font-size: .52rem; letter-spacing: .34em; opacity: .8; }
.tps-mode-hud b { font-size: .72rem; letter-spacing: .16em; margin-top: .1rem; }
.tps-mode-hud i { font-style: normal; font-size: 1.5rem; line-height: 1; animation: tps-lock-pulse .9s ease-in-out infinite alternate; }
@keyframes tps-lock-pulse { from { transform: scale(.86); opacity: .58; } to { transform: scale(1.08); opacity: 1; } }
`;
});

await patch("public/sw.js", (input) => input.replace('poly-fighter-v20', 'poly-fighter-v21'));
await patch("tests/pwa-cache.test.mjs", (input) => input.replace('/poly-fighter-v20/', '/poly-fighter-v21/'));

await patch("package.json", (input) => {
  const pkg = JSON.parse(input);
  const command = String(pkg.scripts?.["test:rules"] ?? "");
  if (!command.includes("tests/tps-mode.test.ts")) {
    pkg.scripts["test:rules"] = `${command} tests/tps-mode.test.ts`;
  }
  return `${JSON.stringify(pkg, null, 2)}\n`;
});

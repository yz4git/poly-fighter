import { readFile, writeFile } from "node:fs/promises";

async function patch(path, replacements) {
  let source = await readFile(path, "utf8");
  for (const [before, after] of replacements) {
    if (!source.includes(before)) throw new Error(`${path}: expected patch anchor missing: ${before.slice(0, 80)}`);
    source = source.replace(before, after);
  }
  await writeFile(path, source);
}

await patch("src/game/game.ts", [
  [
    'import { createFighterVisual, disposeFighterVisual } from "./visual-entry";\nimport type { FighterDefinition, HudSnapshot, InputAction } from "./types";',
    'import { createFighterVisual, disposeFighterVisual } from "./visual-entry";\nimport type { FighterModelId } from "./model-skins";\nimport type { FighterDefinition, HudSnapshot, InputAction } from "./types";',
  ],
  [
    '  p1Definition: FighterDefinition;\n  p2Definition: FighterDefinition;\n  difficulty?: CpuDifficulty;',
    '  p1Definition: FighterDefinition;\n  p2Definition: FighterDefinition;\n  p1Model?: FighterModelId;\n  p2Model?: FighterModelId;\n  difficulty?: CpuDifficulty;',
  ],
  [
    '    this.p1 = new FighterRuntime("p1", options.p1Definition, false, createFighterVisual(options.p1Definition, settings.quality));\n    this.p2 = new FighterRuntime("p2", options.p2Definition, true, createFighterVisual(options.p2Definition, settings.quality));',
    '    this.p1 = new FighterRuntime("p1", options.p1Definition, false, createFighterVisual(options.p1Definition, settings.quality, options.p1Model ?? "ORIGINAL"));\n    this.p2 = new FighterRuntime("p2", options.p2Definition, true, createFighterVisual(options.p2Definition, settings.quality, options.p2Model ?? "ORIGINAL"));',
  ],
]);

await patch("src/game/model-viewer.ts", [
  [
    'import type { FighterDefinition } from "./types";\nimport {',
    'import type { FighterDefinition } from "./types";\nimport type { FighterModelId } from "./model-skins";\nimport {',
  ],
  [
    '  definition: FighterDefinition;\n  quality?: FighterVisualQuality;',
    '  definition: FighterDefinition;\n  quality?: FighterVisualQuality;\n  modelId?: FighterModelId;',
  ],
  [
    '    this.visual = createFighterVisual(options.definition, options.quality ?? "NORMAL");',
    '    this.visual = createFighterVisual(options.definition, options.quality ?? "NORMAL", options.modelId ?? "ORIGINAL");',
  ],
]);

await patch("src/components/model-viewer-panel.tsx", [
  [
    'import { ModelViewer } from "@/src/game/model-viewer";',
    'import { ModelViewer } from "@/src/game/model-viewer";\nimport { DEFAULT_FIGHTER_MODEL_ID, FIGHTER_MODEL_OPTIONS, type FighterModelId } from "@/src/game/model-skins";',
  ],
  [
    '  const [fighterId, setFighterId] = useState<(typeof fighterIds)[number]>("blue");\n  const [fallback, setFallback] = useState<string | null>(null);',
    '  const [fighterId, setFighterId] = useState<(typeof fighterIds)[number]>("blue");\n  const [modelId, setModelId] = useState<FighterModelId>(DEFAULT_FIGHTER_MODEL_ID);\n  const [fallback, setFallback] = useState<string | null>(null);',
  ],
  [
    '        definition: fighter,\n        quality,\n        onFallback: setFallback,',
    '        definition: fighter,\n        quality,\n        modelId,\n        onFallback: setFallback,',
  ],
  [
    '  }, [fighter, quality]);',
    '  }, [fighter, modelId, quality]);',
  ],
  [
    '        <button\n          type="button"\n          onClick={() => viewerRef.current?.reset()}',
    '        <div style={{ marginTop: 8, color: "#7894ae", fontSize: 8, letterSpacing: ".16em" }}>VISUAL MODEL</div>\n        {FIGHTER_MODEL_OPTIONS.map((option) => {\n          const active = option.id === modelId;\n          return (\n            <button\n              key={option.id}\n              type="button"\n              aria-pressed={active}\n              onClick={() => setModelId(option.id)}\n              style={{\n                minWidth: 104,\n                padding: "9px 12px",\n                border: active ? "1px solid #5ce8ff" : "1px solid rgba(175,218,255,.25)",\n                background: active ? "rgba(24,61,91,.9)" : "rgba(5,15,30,.76)",\n                color: active ? "#f5fbff" : "#91a7bf",\n                fontSize: 9,\n                fontWeight: 900,\n                letterSpacing: ".12em",\n                textAlign: "left",\n              }}\n            >\n              {option.label}<br /><small style={{ fontSize: 6, opacity: .7 }}>{option.detail}</small>\n            </button>\n          );\n        })}\n        <button\n          type="button"\n          onClick={() => viewerRef.current?.reset()}',
  ],
]);

await patch("app/page.tsx", [
  [
    'import type { HudSnapshot, InputAction } from "@/src/game/types";',
    'import type { HudSnapshot, InputAction } from "@/src/game/types";\nimport { DEFAULT_FIGHTER_MODEL_ID, FIGHTER_MODEL_OPTIONS, type FighterModelId } from "@/src/game/model-skins";',
  ],
  [
    '  const [p1Choice, setP1Choice] = useState("red");\n  const [p2Choice, setP2Choice] = useState("blue");',
    '  const [p1Choice, setP1Choice] = useState("red");\n  const [p2Choice, setP2Choice] = useState("blue");\n  const [modelChoice, setModelChoice] = useState<FighterModelId>(DEFAULT_FIGHTER_MODEL_ID);',
  ],
  [
    '        p1Definition: FIGHTER_DEFINITIONS[p1Choice] ?? FIGHTER_DEFINITIONS.red,\n        p2Definition: FIGHTER_DEFINITIONS[p2Choice] ?? FIGHTER_DEFINITIONS.blue,\n        difficulty,',
    '        p1Definition: FIGHTER_DEFINITIONS[p1Choice] ?? FIGHTER_DEFINITIONS.red,\n        p2Definition: FIGHTER_DEFINITIONS[p2Choice] ?? FIGHTER_DEFINITIONS.blue,\n        p1Model: modelChoice,\n        p2Model: modelChoice,\n        difficulty,',
  ],
  [
    '  }, [difficulty, p1Choice, p2Choice, screen]);',
    '  }, [difficulty, modelChoice, p1Choice, p2Choice, screen]);',
  ],
  [
    '          <div className="select-bottom">',
    '          <div className="difficulty" style={{ marginTop: 10 }}>\n            <span>VISUAL MODEL</span>\n            {FIGHTER_MODEL_OPTIONS.map((option) => (\n              <button key={option.id} type="button" className={modelChoice === option.id ? "active" : ""} onClick={() => setModelChoice(option.id)}>\n                {option.label}\n              </button>\n            ))}\n          </div>\n          <div style={{ color: "#7894ae", fontSize: 8, letterSpacing: ".12em", margin: "5px 0 2px" }}>\n            {modelChoice === "QUATERNIUS_UBC" ? "CC0 / UNIVERSAL RIG / MOTION READY" : "POLY FIGHTER CUSTOM VISUAL"}\n          </div>\n          <div className="select-bottom">',
  ],
]);

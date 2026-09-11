import { EMPTY_RIVAL_CIRCUIT_MEMORY, type RivalCircuitMemory } from "./rival-circuit-memory";
import {
  resetRivalCircuitRunMemory,
  subscribeRivalCircuitRunMemory,
} from "./rival-circuit-memory-runtime";
import {
  RIVAL_CIRCUIT_PROTOCOLS,
  type RivalCircuitProtocolId,
} from "./rival-circuit";
import { buildRivalCircuitIntel } from "./rival-circuit-intel";

const ownedProtocols = new Set<RivalCircuitProtocolId>();
let memory: RivalCircuitMemory = { ...EMPTY_RIVAL_CIRCUIT_MEMORY };
let installed = false;
let observer: MutationObserver | null = null;

function protocolFromLabel(label: string): RivalCircuitProtocolId | null {
  const upper = label.toUpperCase().replaceAll("_", " ");
  const ids = Object.keys(RIVAL_CIRCUIT_PROTOCOLS) as RivalCircuitProtocolId[];
  return ids.find((id) => upper.includes(RIVAL_CIRCUIT_PROTOCOLS[id].name.toUpperCase())) ?? null;
}

function ensureIntelPanel(host: Element, mode: "BRIEFING" | "REWARD"): HTMLElement {
  let panel = host.querySelector<HTMLElement>(`.circuit-intel[data-intel-mode="${mode}"]`);
  if (panel) return panel;

  panel = document.createElement("div");
  panel.className = `circuit-intel circuit-intel-${mode.toLowerCase()}`;
  panel.dataset.intelMode = mode;
  panel.dataset.rivalIntel = "RIVAL_INTEL_V1";

  const kicker = document.createElement("span");
  kicker.className = "circuit-intel-kicker";
  const read = document.createElement("strong");
  read.className = "circuit-intel-read";
  const protocols = document.createElement("div");
  protocols.className = "circuit-intel-protocols";
  panel.append(kicker, read, protocols);

  if (mode === "REWARD") {
    const grid = host.querySelector(".protocol-grid");
    host.insertBefore(panel, grid ?? null);
  } else {
    host.append(panel);
  }
  return panel;
}

function updatePanel(panel: HTMLElement, mode: "BRIEFING" | "REWARD"): void {
  const intel = buildRivalCircuitIntel(memory, [...ownedProtocols]);
  const kicker = panel.querySelector<HTMLElement>(".circuit-intel-kicker");
  const read = panel.querySelector<HTMLElement>(".circuit-intel-read");
  const protocols = panel.querySelector<HTMLElement>(".circuit-intel-protocols");
  if (!kicker || !read || !protocols) return;

  const fightWord = intel.fights === 1 ? "FIGHT" : "FIGHTS";
  const nextKicker = mode === "REWARD"
    ? `RIVAL READ UPDATED // ${intel.fights} ${fightWord} ANALYZED`
    : `RIVAL INTEL // ${intel.fights} ${fightWord} ANALYZED`;
  const nextRead = intel.read === "NONE"
    ? "NO READ // FIRST CONTACT"
    : `${intel.readLabel} // ${intel.confidencePercent}% CONFIDENCE`;
  const nextProtocols = intel.protocolNames.length > 0
    ? `INSTALLED // ${intel.protocolNames.join(" · ")}`
    : "INSTALLED // NONE";

  if (kicker.textContent !== nextKicker) kicker.textContent = nextKicker;
  if (read.textContent !== nextRead) read.textContent = nextRead;
  if (protocols.textContent !== nextProtocols) protocols.textContent = nextProtocols;
}

function renderIntel(): void {
  if (typeof document === "undefined") return;
  const intel = buildRivalCircuitIntel(memory, [...ownedProtocols]);

  const briefing = document.querySelector(".circuit-briefing");
  if (briefing) updatePanel(ensureIntelPanel(briefing, "BRIEFING"), "BRIEFING");

  const reward = document.querySelector(".circuit-reward-panel");
  if (reward) updatePanel(ensureIntelPanel(reward, "REWARD"), "REWARD");

  const strip = document.querySelector<HTMLElement>(".circuit-run-strip");
  if (strip) {
    let compact = strip.querySelector<HTMLElement>(".circuit-intel-strip");
    if (!compact) {
      compact = document.createElement("em");
      compact.className = "circuit-intel-strip";
      strip.append(compact);
    }
    if (compact.textContent !== intel.combatLabel) compact.textContent = intel.combatLabel;
    strip.dataset.rivalIntel = "RIVAL_INTEL_V1";
    strip.dataset.rivalIntelRead = intel.read;
    strip.dataset.rivalIntelProtocols = String(intel.protocolCount);
  }
}

function resetIntelRun(): void {
  ownedProtocols.clear();
  memory = { ...EMPTY_RIVAL_CIRCUIT_MEMORY };
  resetRivalCircuitRunMemory();
  renderIntel();
}

function onDocumentClick(event: MouseEvent): void {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest<HTMLButtonElement>("button");
  if (!button) return;
  const label = button.textContent ?? "";

  if (button.classList.contains("circuit-primary") || label.includes("NEW CIRCUIT")) {
    resetIntelRun();
    return;
  }

  if (!button.classList.contains("protocol-card")) return;
  const protocol = protocolFromLabel(label);
  if (!protocol) return;
  ownedProtocols.add(protocol);
  queueMicrotask(renderIntel);
}

export function installRivalCircuitIntelRuntime(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;

  subscribeRivalCircuitRunMemory((nextMemory) => {
    memory = { ...nextMemory };
    renderIntel();
  });
  document.addEventListener("click", onDocumentClick, true);
  observer = new MutationObserver(() => renderIntel());
  observer.observe(document.body, { childList: true, subtree: true });
  renderIntel();
}

export function rivalCircuitIntelObserverInstalled(): boolean {
  return observer !== null;
}

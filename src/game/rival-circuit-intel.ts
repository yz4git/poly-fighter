import { RIVAL_MEMORY_LABELS, type RivalCircuitMemory, type RivalCircuitMemoryRead } from "./rival-circuit-memory";
import { RIVAL_CIRCUIT_PROTOCOLS, type RivalCircuitProtocolId } from "./rival-circuit";

export interface RivalCircuitIntel {
  read: RivalCircuitMemoryRead;
  readLabel: string;
  confidencePercent: number;
  fights: number;
  protocolNames: string[];
  protocolCount: number;
  combatLabel: string;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

export function buildRivalCircuitIntel(
  memory: Pick<RivalCircuitMemory, "read" | "confidence" | "fights">,
  protocols: readonly RivalCircuitProtocolId[] = [],
): RivalCircuitIntel {
  const protocolNames = protocols
    .map((id) => RIVAL_CIRCUIT_PROTOCOLS[id]?.name)
    .filter((name): name is string => Boolean(name));
  const confidencePercent = clampPercent(memory.confidence);
  const readLabel = RIVAL_MEMORY_LABELS[memory.read] ?? RIVAL_MEMORY_LABELS.NONE;
  const readText = memory.read === "NONE"
    ? "READ NONE"
    : `READ ${readLabel} ${confidencePercent}%`;
  const protocolText = protocolNames.length > 0 ? `P${protocolNames.length}` : "P0";

  return {
    read: memory.read,
    readLabel,
    confidencePercent,
    fights: Math.max(0, memory.fights),
    protocolNames,
    protocolCount: protocolNames.length,
    combatLabel: `${readText} // ${protocolText}`,
  };
}

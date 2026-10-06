"use client";

import { installRivalCircuitAiRuntime } from "@/src/game/rival-circuit-ai";
import { installRivalCircuitApexBossRuntime } from "@/src/game/rival-circuit-apex-boss";
import { installRivalCircuitArenaPresentation } from "@/src/game/rival-circuit-arena";
import { installRivalCircuitArenaTactics } from "@/src/game/rival-circuit-arena-tactics";
import { installRivalCircuitFinishRuntime } from "@/src/game/rival-circuit-finish-runtime";
import { installRivalCircuitIntelRuntime } from "@/src/game/rival-circuit-intel-runtime";
import { installRivalCircuitMemoryRuntime } from "@/src/game/rival-circuit-memory-runtime";
import { installRivalCircuitProtocolRuntime } from "@/src/game/rival-circuit-protocol-runtime";
import { installAxionFighterPresentation } from "@/src/game/fighter-axion-presentation";
import { installVantaFighterPresentation } from "@/src/game/fighter-vanta-presentation";
import { installTpsArenaSpectaclePresentation } from "@/src/game/tps-arena-spectacle";
import { installTpsAttackActionHandoffPresentation } from "@/src/game/tps-attack-action-handoff";
import { installTpsBackfistSweepBoostPresentation } from "@/src/game/tps-backfist-sweep-boost";
import { installTpsBodyBlowLevelChangePresentation } from "@/src/game/tps-bodyblow-level-change";
import { installTpsCloseNeutralLanePresentation } from "@/src/game/tps-close-neutral-lane";
import { installTpsClosePunchLanePresentation } from "@/src/game/tps-close-punch-lane";
import { installTpsCounterSlipBoostPresentation } from "@/src/game/tps-counter-slip-boost";
import { installTpsCounterattackHandoffPresentation } from "@/src/game/tps-counterattack-handoff";
import { installTpsFinalImpactVfxReadability } from "@/src/game/tps-final-impact-vfx-readability";
import { installTpsGroundingReadabilityPresentation } from "@/src/game/tps-grounding-readability";
import { installTpsGuardClashPresentation } from "@/src/game/tps-guard-clash";
import { installTpsImpactBeatSyncPresentation } from "@/src/game/tps-impact-beat-sync";
import { installTpsImpactFollowthroughPresentation } from "@/src/game/tps-impact-followthrough";
import { installTpsImpactLensPulsePresentation } from "@/src/game/tps-impact-lens-pulse";
import { installTpsInterceptSilhouettePresentation } from "@/src/game/tps-intercept-silhouette";
import { installTpsLatestImpactWavePresentation } from "@/src/game/tps-latest-impact-wave";
import { installTpsPowerBodyDrivePresentation } from "@/src/game/tps-power-body-drive";
import { installTpsPunishReadyPresentation } from "@/src/game/tps-punish-ready";
import { installTpsQuickstepBodyPresentation } from "@/src/game/tps-quickstep-body";
import { installTpsTelegraphHandoffPresentation } from "@/src/game/tps-telegraph-handoff";
import { installTpsThrowStagingPresentation } from "@/src/game/tps-throw-staging";

type Installer = () => void;

function installAll(installers: readonly Installer[]): void {
  for (const install of installers) install();
}

const RIVAL_RUNTIME_INSTALLERS = [
  installRivalCircuitAiRuntime,
  installRivalCircuitMemoryRuntime,
  installRivalCircuitProtocolRuntime,
  installRivalCircuitIntelRuntime,
  installRivalCircuitApexBossRuntime,
] as const;

const FIGHTER_PRESENTATION_INSTALLERS = [
  installVantaFighterPresentation,
  installAxionFighterPresentation,
] as const;

// Order is part of the presentation contract: each installer wraps the previous
// PresentationAnimationController update. Keep this list explicit and reviewable.
const TPS_PRESENTATION_INSTALLERS = [
  installTpsArenaSpectaclePresentation,
  installRivalCircuitArenaPresentation,
  installRivalCircuitArenaTactics,
  installTpsGroundingReadabilityPresentation,
  installTpsGuardClashPresentation,
  installTpsThrowStagingPresentation,
  installTpsQuickstepBodyPresentation,
  installTpsTelegraphHandoffPresentation,
  installTpsPunishReadyPresentation,
  installTpsInterceptSilhouettePresentation,
  installTpsBodyBlowLevelChangePresentation,
  installTpsBackfistSweepBoostPresentation,
  installTpsCounterSlipBoostPresentation,
  installTpsImpactFollowthroughPresentation,
  installTpsPowerBodyDrivePresentation,
  installTpsCloseNeutralLanePresentation,
  installTpsClosePunchLanePresentation,
  installTpsLatestImpactWavePresentation,
  installTpsFinalImpactVfxReadability,
  installTpsImpactLensPulsePresentation,
  installTpsImpactBeatSyncPresentation,
  installTpsCounterattackHandoffPresentation,
  installTpsAttackActionHandoffPresentation,
] as const;

installAll(RIVAL_RUNTIME_INSTALLERS);
installAll(FIGHTER_PRESENTATION_INSTALLERS);
installAll(TPS_PRESENTATION_INSTALLERS);

// Install last so the two-button chord is the outer gameplay guard. All existing
// motion/readability wrappers still process the committed finisher on later ticks.
installRivalCircuitFinishRuntime();

export default function TpsPresentationBootstrap() {
  return null;
}

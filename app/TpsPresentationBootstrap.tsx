"use client";

import { installTpsBackfistSweepBoostPresentation } from "@/src/game/tps-backfist-sweep-boost";
import { installTpsBodyBlowLevelChangePresentation } from "@/src/game/tps-bodyblow-level-change";
import { installTpsCounterSlipBoostPresentation } from "@/src/game/tps-counter-slip-boost";
import { installTpsGuardClashPresentation } from "@/src/game/tps-guard-clash";
import { installTpsImpactFollowthroughPresentation } from "@/src/game/tps-impact-followthrough";
import { installTpsInterceptSilhouettePresentation } from "@/src/game/tps-intercept-silhouette";
import { installTpsPunishReadyPresentation } from "@/src/game/tps-punish-ready";
import { installTpsQuickstepBodyPresentation } from "@/src/game/tps-quickstep-body";
import { installTpsTelegraphHandoffPresentation } from "@/src/game/tps-telegraph-handoff";
import { installTpsThrowStagingPresentation } from "@/src/game/tps-throw-staging";

installTpsGuardClashPresentation();
installTpsThrowStagingPresentation();
installTpsQuickstepBodyPresentation();
installTpsTelegraphHandoffPresentation();
installTpsPunishReadyPresentation();
installTpsInterceptSilhouettePresentation();
installTpsBodyBlowLevelChangePresentation();
installTpsBackfistSweepBoostPresentation();
installTpsCounterSlipBoostPresentation();
installTpsImpactFollowthroughPresentation();

export default function TpsPresentationBootstrap() {
  return null;
}

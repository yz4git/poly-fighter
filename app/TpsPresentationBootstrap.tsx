"use client";

import { installTpsBackfistSweepBoostPresentation } from "@/src/game/tps-backfist-sweep-boost";
import { installTpsBodyBlowLevelChangePresentation } from "@/src/game/tps-bodyblow-level-change";
import { installTpsCloseNeutralLanePresentation } from "@/src/game/tps-close-neutral-lane";
import { installTpsCounterSlipBoostPresentation } from "@/src/game/tps-counter-slip-boost";
import { installTpsFrontKickOpenLinePresentation } from "@/src/game/tps-frontkick-open-line";
import { installTpsGuardClashPresentation } from "@/src/game/tps-guard-clash";
import { installTpsImpactFollowthroughPresentation } from "@/src/game/tps-impact-followthrough";
import { installTpsInterceptSilhouettePresentation } from "@/src/game/tps-intercept-silhouette";
import { installTpsLowKickOpenLinePresentation } from "@/src/game/tps-lowkick-open-line";
import { installTpsPowerBodyDrivePresentation } from "@/src/game/tps-power-body-drive";
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
installTpsFrontKickOpenLinePresentation();
installTpsPowerBodyDrivePresentation();
installTpsLowKickOpenLinePresentation();
installTpsCloseNeutralLanePresentation();

export default function TpsPresentationBootstrap() {
  return null;
}

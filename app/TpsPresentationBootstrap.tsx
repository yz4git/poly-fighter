"use client";

import { installTpsBodyBlowLevelChangePresentation } from "@/src/game/tps-bodyblow-level-change";
import { installTpsGuardClashPresentation } from "@/src/game/tps-guard-clash";
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

export default function TpsPresentationBootstrap() {
  return null;
}

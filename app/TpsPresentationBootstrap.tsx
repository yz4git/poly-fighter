"use client";

import { installTpsGuardClashPresentation } from "@/src/game/tps-guard-clash";
import { installTpsPunishReadyPresentation } from "@/src/game/tps-punish-ready";
import { installTpsQuickstepBodyPresentation } from "@/src/game/tps-quickstep-body";
import { installTpsTelegraphHandoffPresentation } from "@/src/game/tps-telegraph-handoff";
import { installTpsThrowStagingPresentation } from "@/src/game/tps-throw-staging";

installTpsGuardClashPresentation();
installTpsThrowStagingPresentation();
installTpsQuickstepBodyPresentation();
installTpsTelegraphHandoffPresentation();
installTpsPunishReadyPresentation();

export default function TpsPresentationBootstrap() {
  return null;
}

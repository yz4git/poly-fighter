"use client";

import { installTpsGuardClashPresentation } from "@/src/game/tps-guard-clash";
import { installTpsQuickstepBodyPresentation } from "@/src/game/tps-quickstep-body";
import { installTpsThrowStagingPresentation } from "@/src/game/tps-throw-staging";

installTpsGuardClashPresentation();
installTpsThrowStagingPresentation();
installTpsQuickstepBodyPresentation();

export default function TpsPresentationBootstrap() {
  return null;
}

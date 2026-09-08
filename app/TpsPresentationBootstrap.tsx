"use client";

import { installTpsGuardClashPresentation } from "@/src/game/tps-guard-clash";
import { installTpsThrowStagingPresentation } from "@/src/game/tps-throw-staging";

installTpsGuardClashPresentation();
installTpsThrowStagingPresentation();

export default function TpsPresentationBootstrap() {
  return null;
}

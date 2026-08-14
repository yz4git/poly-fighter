export const SERA_SKIN_PROFILE = {
  collar: { neck: 0.52, chest: 0.48 },
  shoulder: {
    armBase: 0.34,
    armLowerBonus: 0.12,
    blendStartY: 0.700,
    blendEndY: 0.810,
  },
  upperArm: {
    elbowMax: 0.28,
    elbowStartY: 0.615,
    elbowEndY: 0.690,
  },
  forearm: {
    handMax: 0.18,
    handStartY: 0.475,
    handEndY: 0.535,
    guardRigidForearm: 0.96,
    guardHand: 0.04,
  },
} as const;

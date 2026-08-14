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
  hand: { hand: 0.97, forearm: 0.03 },
  hips: {
    spineMax: 0.34,
    spineStartY: 0.595,
    spineEndY: 0.675,
  },
  frontSkirt: {
    thighMax: 0.10,
    thighStartY: 0.420,
    thighEndY: 0.565,
  },
  sideSkirt: {
    thighMax: 0.18,
    thighStartY: 0.410,
    thighEndY: 0.575,
  },
} as const;

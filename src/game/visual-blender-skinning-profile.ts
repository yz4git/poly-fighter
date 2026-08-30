export const SERA_SKIN_PROFILE = {
  collar: { neck: 0.52, chest: 0.48 },
  shoulder: {
    // Blend the clavicle into the arm across the canonical shoulder width.
    // Duplicate body seam vertices receive identical weights after solving.
    armBase: 0.05,
    armOuterMax: 0.98,
    radialStartX: 0.045,
    radialEndX: 0.125,
  },
  upperArm: {
    // The continuous bind fit places the elbow around canonical y = .650.
    elbowMax: 1.0,
    elbowStartY: 0.625,
    elbowEndY: 0.675,
  },
  forearm: {
    // Match the fitted wrist to the canonical hand pivot at y = .477.
    handMax: 0.98,
    handStartY: 0.460,
    handEndY: 0.500,
    guardRigidForearm: 0.96,
    guardHand: 0.04,
  },
  hand: { hand: 0.85, forearm: 0.15 },
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
  thigh: {
    hipMax: 0.18,
    hipStartY: 0.500,
    hipEndY: 0.590,
    kneeMax: 0.28,
    kneeStartY: 0.285,
    kneeEndY: 0.345,
  },
  shin: {
    kneeMax: 0.18,
    kneeStartY: 0.270,
    kneeEndY: 0.315,
    ankleMax: 0.18,
    ankleStartY: 0.075,
    ankleEndY: 0.120,
    guardRigidShin: 0.97,
    guardFoot: 0.03,
  },
  foot: { foot: 0.985, shin: 0.015 },
  fallback: {
    lowerBodyCutoffY: 0.590,
    hipsCutoffY: 0.675,
    headCutoffY: 0.835,
  },
} as const;

export const SERA_SKIN_PROFILE = {
  collar: { neck: 0.52, chest: 0.48 },
  shoulder: {
    // The Blender source shoulder and upper-arm regions share real geometric
    // boundaries. Match those duplicated seam vertices by driving the outer
    // shoulder almost entirely with the upper-arm bone while keeping the inner
    // clavicle attached to the chest.
    armBase: 0.16,
    armOuterMax: 0.98,
    radialStartX: 0.025,
    radialEndX: 0.085,
  },
  upperArm: {
    // Source upper-arm/forearm regions overlap around y ~= .666-.686. Make the
    // bottom of the upper-arm region follow the forearm so both copies of the
    // elbow seam transform together.
    elbowMax: 0.96,
    elbowStartY: 0.690,
    elbowEndY: 0.720,
  },
  forearm: {
    // Source forearm/hand regions overlap around y ~= .537-.553. The old .475
    // thresholds gave the forearm side almost zero hand influence and opened a
    // visible wrist gap. Blend aggressively through the real source seam.
    handMax: 0.92,
    handStartY: 0.540,
    handEndY: 0.585,
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

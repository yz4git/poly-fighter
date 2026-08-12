import * as THREE from "three";

/**
 * V6 is calibrated against the supplied four-view turnaround sheet.  The
 * sheet is a development reference only; it is never assigned to a fighter
 * material or downloaded by the gameplay renderer.
 */
export const FEMALE_V6_REFERENCE = {
  asset: "/reference/female-turnaround.jpeg",
  sourceWidth: 1536,
  sourceHeight: 1024,
  characterHeightMeters: 1.68,
  cameraFov: 35,
  cameraDistance: 3.25,
  aimHeight: 0.84,
  views: {
    FRONT: { x: 8, y: 115, width: 381, height: 899, label: "FRONT" },
    THREE_QUARTER: { x: 390, y: 115, width: 379, height: 899, label: "3/4 VIEW" },
    SIDE: { x: 770, y: 115, width: 363, height: 899, label: "SIDE" },
    BACK: { x: 1133, y: 115, width: 395, height: 899, label: "BACK" },
  },
} as const;

export type FemaleV6ReferenceView = keyof typeof FEMALE_V6_REFERENCE.views;

/**
 * Hand-annotated landmarks in the source-sheet panel coordinates.  These are
 * targets for the reconstruction tool, not measurements copied into runtime
 * scoring.  Generated landmarks are projected and compared to these values.
 */
export const FEMALE_V6_REFERENCE_LANDMARKS: Record<FemaleV6ReferenceView, Record<string, readonly [number, number]>> = {
  FRONT: {
    headTop: [0.50, 0.075], chin: [0.50, 0.175],
    leftShoulder: [0.30, 0.205], rightShoulder: [0.70, 0.205],
    leftWaist: [0.40, 0.425], rightWaist: [0.60, 0.425],
    leftHip: [0.34, 0.505], rightHip: [0.66, 0.505],
    leftElbow: [0.24, 0.390], rightElbow: [0.76, 0.390],
    leftWrist: [0.22, 0.560], rightWrist: [0.78, 0.560],
    leftFinger: [0.20, 0.615], rightFinger: [0.80, 0.615],
    leftKnee: [0.40, 0.705], rightKnee: [0.60, 0.705],
    leftAnkle: [0.39, 0.925], rightAnkle: [0.61, 0.925],
    leftHeel: [0.36, 0.965], rightHeel: [0.64, 0.965],
    leftToe: [0.29, 0.985], rightToe: [0.71, 0.985],
  },
  THREE_QUARTER: {
    headTop: [0.49, 0.075], chin: [0.47, 0.175],
    leftShoulder: [0.31, 0.205], rightShoulder: [0.68, 0.220],
    leftWaist: [0.41, 0.425], rightWaist: [0.59, 0.435],
    leftHip: [0.34, 0.505], rightHip: [0.66, 0.525],
    leftElbow: [0.25, 0.395], rightElbow: [0.75, 0.410],
    leftWrist: [0.21, 0.565], rightWrist: [0.77, 0.580],
    leftFinger: [0.19, 0.620], rightFinger: [0.79, 0.635],
    leftKnee: [0.39, 0.710], rightKnee: [0.61, 0.720],
    leftAnkle: [0.36, 0.930], rightAnkle: [0.64, 0.940],
    leftHeel: [0.33, 0.970], rightHeel: [0.66, 0.975],
    leftToe: [0.25, 0.988], rightToe: [0.73, 0.990],
  },
  SIDE: {
    headTop: [0.50, 0.075], chin: [0.43, 0.175],
    leftShoulder: [0.45, 0.205], rightShoulder: [0.58, 0.215],
    leftWaist: [0.46, 0.425], rightWaist: [0.56, 0.430],
    leftHip: [0.43, 0.505], rightHip: [0.60, 0.515],
    leftElbow: [0.38, 0.395], rightElbow: [0.65, 0.405],
    leftWrist: [0.35, 0.565], rightWrist: [0.68, 0.575],
    leftFinger: [0.32, 0.625], rightFinger: [0.70, 0.635],
    leftKnee: [0.42, 0.710], rightKnee: [0.58, 0.715],
    leftAnkle: [0.42, 0.930], rightAnkle: [0.58, 0.935],
    leftHeel: [0.39, 0.970], rightHeel: [0.59, 0.972],
    leftToe: [0.28, 0.990], rightToe: [0.69, 0.992],
  },
  BACK: {
    headTop: [0.50, 0.075], chin: [0.50, 0.175],
    leftShoulder: [0.70, 0.205], rightShoulder: [0.30, 0.205],
    leftWaist: [0.60, 0.425], rightWaist: [0.40, 0.425],
    leftHip: [0.66, 0.505], rightHip: [0.34, 0.505],
    leftElbow: [0.76, 0.395], rightElbow: [0.24, 0.395],
    leftWrist: [0.78, 0.565], rightWrist: [0.22, 0.565],
    leftFinger: [0.80, 0.620], rightFinger: [0.20, 0.620],
    leftKnee: [0.60, 0.640], rightKnee: [0.40, 0.640],
    leftAnkle: [0.60, 0.862], rightAnkle: [0.40, 0.862],
    leftHeel: [0.59, 0.930], rightHeel: [0.41, 0.930],
    leftToe: [0.60, 0.836], rightToe: [0.40, 0.836],
  },
};

export interface FemaleV6ControlCage {
  headTop: THREE.Vector3;
  chin: THREE.Vector3;
  leftShoulder: THREE.Vector3;
  rightShoulder: THREE.Vector3;
  ribcage: THREE.Vector3;
  waist: THREE.Vector3;
  pelvis: THREE.Vector3;
  leftHip: THREE.Vector3;
  rightHip: THREE.Vector3;
  leftKnee: THREE.Vector3;
  rightKnee: THREE.Vector3;
  leftAnkle: THREE.Vector3;
  rightAnkle: THREE.Vector3;
  leftToe: THREE.Vector3;
  rightToe: THREE.Vector3;
  leftElbow: THREE.Vector3;
  rightElbow: THREE.Vector3;
  leftWrist: THREE.Vector3;
  rightWrist: THREE.Vector3;
}

/** Normalized, named model-space cage used by the V6 body surfaces. */
export const FEMALE_V6_CONTROL_CAGE: FemaleV6ControlCage = {
  headTop: new THREE.Vector3(0, 1.000, 0),
  chin: new THREE.Vector3(0, 0.860, 0.028),
  leftShoulder: new THREE.Vector3(-0.1125, 0.775, 0),
  rightShoulder: new THREE.Vector3(0.1125, 0.775, 0),
  ribcage: new THREE.Vector3(0, 0.835, 0.008),
  waist: new THREE.Vector3(0, 0.742, 0.006),
  pelvis: new THREE.Vector3(0, 0.585, 0),
  leftHip: new THREE.Vector3(-0.055, 0.585, 0),
  rightHip: new THREE.Vector3(0.055, 0.585, 0),
  leftKnee: new THREE.Vector3(-0.055, 0.295, 0),
  rightKnee: new THREE.Vector3(0.055, 0.295, 0),
  leftAnkle: new THREE.Vector3(-0.060, 0.020, 0),
  rightAnkle: new THREE.Vector3(0.060, 0.020, 0),
  leftToe: new THREE.Vector3(-0.060, 0.018, 0.075),
  rightToe: new THREE.Vector3(0.060, 0.018, 0.075),
  leftElbow: new THREE.Vector3(-0.135, 0.585, 0),
  rightElbow: new THREE.Vector3(0.135, 0.585, 0),
  leftWrist: new THREE.Vector3(-0.150, 0.435, 0.008),
  rightWrist: new THREE.Vector3(0.150, 0.435, 0.008),
};

export const FEMALE_V6_VIEW_ORDER: FemaleV6ReferenceView[] = ["FRONT", "THREE_QUARTER", "SIDE", "BACK"];

export function referenceViewYaw(view: FemaleV6ReferenceView): number {
  if (view === "SIDE") return Math.PI * 0.5;
  if (view === "BACK") return Math.PI;
  if (view === "THREE_QUARTER") return Math.PI * 0.25;
  return 0;
}

/** Fixed camera used by the reconstruction scene, independent of gameplay camera. */
export function createFemaleV6ReferenceCamera(view: FemaleV6ReferenceView, aspect = 0.44): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(FEMALE_V6_REFERENCE.cameraFov, aspect, 0.01, 50);
  const yaw = referenceViewYaw(view);
  const position = new THREE.Vector3(
    Math.sin(yaw) * FEMALE_V6_REFERENCE.cameraDistance,
    FEMALE_V6_REFERENCE.aimHeight,
    Math.cos(yaw) * FEMALE_V6_REFERENCE.cameraDistance,
  );
  camera.position.copy(position);
  camera.lookAt(0, FEMALE_V6_REFERENCE.aimHeight, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

export interface ReferenceEnvelope {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const FEMALE_V6_REFERENCE_ENVELOPES: Record<FemaleV6ReferenceView, ReferenceEnvelope> = {
  FRONT: { minX: 0.18, minY: 0.075, maxX: 0.82, maxY: 0.990 },
  THREE_QUARTER: { minX: 0.18, minY: 0.075, maxX: 0.82, maxY: 0.992 },
  SIDE: { minX: 0.27, minY: 0.075, maxX: 0.73, maxY: 0.992 },
  BACK: { minX: 0.18, minY: 0.075, maxX: 0.82, maxY: 0.992 },
};

export function envelopeError(actual: { minX: number; minY: number; maxX: number; maxY: number }, target: ReferenceEnvelope): number {
  return (Math.abs(actual.minX - target.minX) + Math.abs(actual.minY - target.minY) + Math.abs(actual.maxX - target.maxX) + Math.abs(actual.maxY - target.maxY)) * 0.25;
}

export function landmarkRms(actual: Record<string, readonly [number, number]>, target: Record<string, readonly [number, number]>): number {
  const keys = Object.keys(target).filter((key) => actual[key]);
  if (!keys.length) return Number.POSITIVE_INFINITY;
  const squared = keys.reduce((sum, key) => {
    const a = actual[key];
    const b = target[key];
    return sum + ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
  }, 0);
  return Math.sqrt(squared / keys.length);
}

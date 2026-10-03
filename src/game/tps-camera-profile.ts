// Camera-only TPS tuning. Keep this separate from deterministic gameplay tuning
// so visual composition can be reviewed/refined without mixing it into combat rules.
export const TPS_CAMERA_CLOSE_SHOULDER_BONUS = 3.75;
export const TPS_CAMERA_CLOSE_BACK_DELTA = -0.95;
export const TPS_CAMERA_CLOSE_ANCHOR_BLEND = 0.88;
export const TPS_CAMERA_CLOSE_TARGET_MIDPOINT_BLEND = 0.42;
export const TPS_CAMERA_CLOSE_TARGET_SIDE_SHIFT = 0.36;
export const TPS_CAMERA_CLOSE_TARGET_LIFT = 0.14;
export const TPS_CAMERA_IMPACT_BACK_DELTA = 0.24;
export const TPS_CAMERA_IMPACT_SHOULDER = 0.18;

// Authored-contact framing offsets are presentation-only. They change camera
// composition, never gameplay position, hitboxes, reach, or animation timing.
export const TPS_CAMERA_CONTACT_BACK_BONUS = 0.18;
export const TPS_CAMERA_CONTACT_SHOULDER_BONUS = 0.32;
export const TPS_CAMERA_KICK_CONTACT_BACK_BONUS = 0.10;
export const TPS_CAMERA_KICK_CONTACT_SHOULDER_BONUS = 0.20;
export const TPS_CAMERA_CONTACT_TARGET_SIDE_BONUS = 0.10;
export const TPS_CAMERA_KICK_TARGET_SIDE_BONUS = 0.08;
export const TPS_CAMERA_FRONT_KICK_SHOULDER_BONUS = 0.98;
export const TPS_CAMERA_FRONT_KICK_TARGET_SIDE_BONUS = 0.24;
export const TPS_CAMERA_FRONT_KICK_BACK_BONUS = 0.10;
export const TPS_CAMERA_LOW_KICK_TARGET_DROP = 0.16;

export const TPS_CAMERA_MAX_TRAVEL_SPEED = 13.2;
export const TPS_CLOSE_ORBIT_SPEED_SCALE = 0.65;

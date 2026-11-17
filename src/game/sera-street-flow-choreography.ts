import type { StreetFlowMove } from "./sera-street-flow";
import type { VideoBodyPose, VideoPoint } from "./video-demo-choreography";

/**
 * Hand-posed study of the user's 12-frame action reference, NOT extracted
 * motion-capture data or an animated 2D texture. Each independent skinned
 * action keeps its own contact frame at .50 so the actual fixed-step hit test
 * and IK can agree. The last key returns to the same ready guard.
 */
export const SERA_STREET_FLOW_POSE_VERSION = "SERA_STREET_12_FRAME_IK_V1";
export const SERA_STREET_FLOW_CLIPS: Readonly<Record<StreetFlowMove, string>> = {
  streetFlowJab: "CM_StreetFlow_Jab",
  streetFlowKick: "CM_StreetFlow_HighKick",
  streetFlowPalm: "CM_StreetFlow_LowPalm",
};

type BodyKey = Readonly<{t: number; pose: VideoBodyPose}>;
const keys: Record<StreetFlowMove, readonly BodyKey[]> = {
  streetFlowJab: [
    {t: 0, pose: {highGuard: 1, drop: -.025, leftHand: [-.10,.77,.16], rightHand: [.09,.79,.16]}},
    // Motion accelerates from grounded guard; lead shoulder loads before hand.
    {t: .18, pose: {highGuard: 1, drop: -.056, forward: -.025, side: -.020,
      yaw: -.30, roll: .055, leftHand: [-.12,.78,.12], rightHand: [.08,.81,.12]}},
    {t: .34, pose: {highGuard: .95, drop: -.045, side: .035, forward: .018,
      yaw: .13, chest: .12, leftHand: [-.075,.78,.34], rightHand: [.09,.80,.13]}},
    {t: .50, pose: {highGuard: .90, drop: -.035, side: .060, forward: .070,
      yaw: .60, chest: .19, pitch: -.09, roll: -.07,
      leftHand: [-.018,.79,.73], rightHand: [.12,.78,.16]}},
    {t: .60, pose: {highGuard: .91, drop: -.040, side: .058, forward: .052,
      yaw: .52, chest: .16, leftHand: [-.022,.77,.71], rightHand: [.11,.78,.14]}},
    {t: .78, pose: {highGuard: 1, drop: -.026, side: .015, forward: .010,
      yaw: .10, leftHand: [-.08,.77,.30], rightHand: [.09,.78,.15]}},
    {t: 1, pose: {highGuard: 1, drop: -.025, leftHand: [-.10,.77,.16], rightHand: [.09,.79,.16]}},
  ],
  streetFlowKick: [
    {t: 0, pose: {highGuard: 1, drop: -.025, leftHand: [-.10,.77,.16], rightHand: [.09,.79,.16]}},
    // The high side kick is a real foot IK goal, not a leg/card-shaped VFX.
    {t: .17, pose: {highGuard: 1, drop: -.090, side: -.045, yaw: -.46,
      chest: .085, pitch: .11, leftFoot: [-.10,0,.06], rightFoot: [.07,.27,.16],
      leftHand: [-.14,.73,.17], rightHand: [.13,.72,.10]}},
    {t: .33, pose: {highGuard: .96, drop: -.105, side: -.090, yaw: -.78,
      pitch: .14, roll: -.09, leftFoot: [-.11,0,.055],
      rightFoot: [.10,.53,.27], leftHand: [-.15,.68,.18], rightHand: [.16,.68,.08]}},
    {t: .50, pose: {highGuard: .85, drop: -.067, side: -.115, forward: .063,
      yaw: -1.03, pitch: .12, roll: -.13,
      leftFoot: [-.12,0,.06], rightFoot: [.20,.84,.68],
      leftHand: [-.17,.64,.17], rightHand: [.15,.67,.08]}},
    {t: .60, pose: {highGuard: .84, drop: -.070, side: -.112, forward: .064,
      yaw: -.99, pitch: .12, roll: -.13,
      leftFoot: [-.12,0,.06], rightFoot: [.21,.82,.66],
      leftHand: [-.17,.64,.17], rightHand: [.15,.67,.08]}},
    {t: .73, pose: {highGuard: .9, drop: -.082, side: -.070, yaw: -.60,
      pitch: .12, rightFoot: [.12,.45,.40], leftHand: [-.14,.70,.13]}},
    {t: .88, pose: {highGuard: 1, drop: -.050, side: -.022, yaw: -.17,
      rightFoot: [.08,.15,.15], leftHand: [-.10,.74,.16]}},
    {t: 1, pose: {highGuard: 1, drop: -.025, leftHand: [-.10,.77,.16], rightHand: [.09,.79,.16]}},
  ],
  streetFlowPalm: [
    {t: 0, pose: {highGuard: 1, drop: -.025, leftHand: [-.10,.77,.16], rightHand: [.09,.79,.16]}},
    // Low evasive change of level (reference frames 6-8): both feet stay
    // supporting and the pelvis drops while the forward hand sweeps low.
    {t: .15, pose: {highGuard: .65, drop: -.142, forward: .025, side: -.048,
      yaw: -.45, pitch: .18, chest: .16, roll: -.07,
      leftFoot: [-.13,0,.11], rightFoot: [.11,0,-.10],
      leftHand: [-.19,.48,.40], rightHand: [.12,.68,.14]}},
    {t: .29, pose: {highGuard: .55, drop: -.195, forward: .075, side: -.060,
      yaw: -.70, pitch: .19, chest: .12, roll: -.09,
      leftFoot: [-.14,0,.12], rightFoot: [.11,0,-.10],
      leftHand: [-.24,.30,.49], rightHand: [.11,.68,.14]}},
    {t: .40, pose: {highGuard: .72, drop: -.142, forward: .075, side: -.035,
      yaw: .03, pitch: .13, chest: .13,
      leftFoot: [-.14,0,.12], rightFoot: [.11,0,-.10],
      leftHand: [-.19,.55,.18], rightHand: [.17,.73,.34]}},
    // Frame 10's palm/deflection: leg drive and pelvis lead, torso stays tall.
    {t: .52, pose: {highGuard: .75, drop: -.066, forward: .110, side: .055,
      yaw: .87, pitch: -.04, chest: .08, roll: -.10,
      leftFoot: [-.14,0,.12], rightFoot: [.10,0,-.08],
      leftHand: [-.12,.83,.12], rightHand: [.33,.79,.71]}},
    {t: .62, pose: {highGuard: .73, drop: -.065, forward: .10, side: .058,
      yaw: .82, chest: .08, roll: -.11,
      leftHand: [-.13,.84,.12], rightHand: [.34,.79,.72]}},
    {t: .76, pose: {highGuard: .88, drop: -.055, forward: .045, yaw: .36,
      leftHand: [-.10,.79,.16], rightHand: [.23,.77,.40]}},
    {t: .90, pose: {highGuard: 1, drop: -.032, forward: .01, yaw: .08,
      rightHand: [.12,.78,.20]}},
    {t: 1, pose: {highGuard: 1, drop: -.025, leftHand: [-.10,.77,.16], rightHand: [.09,.79,.16]}},
  ],
};

const clamp01 = (n: number): number => Number.isFinite(n) ? Math.max(0, Math.min(1,n)) : 0;
const smooth = (u: number): number => { const x=clamp01(u); return x*x*(3-2*x); };

export function sampleSeraStreetFlowPose(
  move: StreetFlowMove,
  phase: number,
  bodyWidth: number,
): VideoBodyPose {
  const width = Math.max(.065, Math.min(.15, Number.isFinite(bodyWidth) ? bodyWidth : .084));
  const defaults: Required<VideoBodyPose> = {
    side: 0, forward: 0, drop: 0, yaw: 0, pitch: .025, roll: 0,
    chest: .035, highGuard: 1, spin: 0,
    leftFoot: [-width,0,.065], rightFoot: [width,0,-.07],
    leftHand: [-.10,.77,.16], rightHand: [.09,.79,.16],
  };
  const frames = keys[move];
  const u = clamp01(phase);
  let from=frames[0], to=frames[frames.length-1];
  for(let i=1;i<frames.length;i++){
    if(u<=frames[i].t){from=frames[i-1];to=frames[i];break;}
  }
  const amount=smooth((u-from.t)/Math.max(1e-6,to.t-from.t));
  const lerp=(a:number,b:number)=>a+(b-a)*amount;
  const result: VideoBodyPose = {};
  for (const name of ["side","forward","drop","yaw","pitch","roll","chest","highGuard","spin"] as const)
    result[name]=lerp(from.pose[name] ?? defaults[name],to.pose[name] ?? defaults[name]);
  for (const name of ["leftFoot","rightFoot","leftHand","rightHand"] as const)
    result[name]=[0,1,2].map(i=>lerp(from.pose[name]?.[i] ?? defaults[name][i],
      to.pose[name]?.[i] ?? defaults[name][i])) as VideoPoint;
  return result;
}

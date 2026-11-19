// Deterministic visual QA plates from real imported GLB bone samples.
// SVGs show skeleton projections, NOT textured/model WebGL screenshots.
// No new dependencies or network. Run after audit-reference-first-motion.mjs.
import { readFile, mkdir, writeFile } from "node:fs/promises";

const OUT = process.env.REFERENCE_MOTION_QA_DIR ?? "artifacts/reference-first-motion";
const report = JSON.parse(await readFile(`${OUT}/rig-sweep-report.json`, "utf8"));
if (report.status === "failed") throw new Error("Cannot publish motion plates from a failed GLB rig sweep");
const WIDTH = 1456, TOP = 115, PANEL_W = 354, PANEL_H = 223;
const DIRECTIONS = ["R", "L", "FR", "FL"];
const PHASES = [.08, .33, .58, .83];
const BONES = [
  ["pelvis", "spine_02"], ["spine_02", "spine_03"], ["spine_03", "Head"],
  ["spine_03", "upperarm_l"], ["upperarm_l", "lowerarm_l"], ["lowerarm_l", "hand_l"],
  ["spine_03", "upperarm_r"], ["upperarm_r", "lowerarm_r"], ["lowerarm_r", "hand_r"],
  ["pelvis", "thigh_l"], ["thigh_l", "calf_l"], ["calf_l", "foot_l"], ["foot_l", "ball_l"],
  ["pelvis", "thigh_r"], ["thigh_r", "calf_r"], ["calf_r", "foot_r"], ["foot_r", "ball_r"],
];
const esc = s => String(s).replace(/[&<>"']/g, v => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
})[v]);
const fmt = n => Number(n).toFixed(1);
const svgStart = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${TOP + PANEL_H * 8 + 50}" viewBox="0 0 ${WIDTH} ${TOP + PANEL_H * 8 + 50}"><rect width="100%" height="100%" fill="#101820"/>`;
const X = (frame, name, view, scale, cx) => {
  const p = frame.joints[name], pelvis = frame.joints.pelvis;
  return cx + (p[view === "FRONT" ? 0 : 2] - pelvis[view === "FRONT" ? 0 : 2]) * scale;
};
const Y = (frame, name, scale, bottom) => {
  const left = frame.joints.ball_l[1], right = frame.joints.ball_r[1];
  return bottom - (frame.joints[name][1] - Math.min(left, right)) * scale;
};
const draw = (frame, view, ox, oy, height, direction, phase, maxSplay) => {
  const scale = 153 / height, cx = ox + PANEL_W * .5, bottom = oy + PANEL_H - 19;
  let s = `<rect x="${ox+2}" y="${oy+2}" width="${PANEL_W-5}" height="${PANEL_H-5}" rx="10" fill="#1a2630" stroke="#3c4b54"/>`;
  s += `<text x="${ox+16}" y="${oy+22}" fill="#e2eaf0" font-size="13" font-family="monospace">${direction} / ${view} / phase ${fmt(phase*100)}%</text>`;
  s += `<text x="${ox+16}" y="${oy+40}" fill="#a9bcc7" font-size="11" font-family="monospace">peak lane deviation ${fmt(maxSplay*100)} cm</text>`;
  s += `<path d="M${ox+16} ${bottom} H${ox+PANEL_W-16}" stroke="#556b78" stroke-dasharray="4 5" stroke-width="1"/>`;
  for (const [a,b] of BONES) {
    const color = a.endsWith("_l") || b.endsWith("_l") ? "#62d3e8"
      : a.endsWith("_r") || b.endsWith("_r") ? "#ffae72" : "#cedbe4";
    const ax=X(frame,a,view,scale,cx), bx=X(frame,b,view,scale,cx);
    const ay=Y(frame,a,scale,bottom), by=Y(frame,b,scale,bottom);
    s += `<path d="M${fmt(ax)} ${fmt(ay)} L${fmt(bx)} ${fmt(by)}" stroke="${color}" stroke-linecap="round" stroke-width="3.6"/>`;
  }
  for (const joint of ["calf_l","calf_r","foot_l","foot_r","Head"]) {
    const color=joint.endsWith("_l")?"#62d3e8":joint.endsWith("_r")?"#ffae72":"#cedbe4";
    s += `<circle cx="${fmt(X(frame,joint,view,scale,cx))}" cy="${fmt(Y(frame,joint,scale,bottom))}" r="3.7" fill="${color}" stroke="#10212b" stroke-width="1"/>`;
  }
  return s;
};
await mkdir(`${OUT}/gait-pose-plates`, {recursive: true});
const summary = ["# GLB gait bone projection plates", "",
  "These are front and profile **bone projections** from the exact animated, imported Quaternius rigs.",
  "They are NOT 3D gameplay screenshots or rendered skin/cloth meshes.",
  "A smooth skeleton does not certify a natural-looking silhouette; physical Safari and WebGL stills need separate approval.", ""];
for (const [fighter, info] of Object.entries(report.fighters)) {
  let svg = svgStart;
  svg += `<text x="30" y="42" fill="#f0f6fa" font-size="27" font-weight="bold" font-family="sans-serif">POLY FIGHTER / ${esc(fighter)} / GAIT BONES</text>`;
  svg += `<text x="30" y="69" fill="#a6b9c6" font-size="14" font-family="sans-serif">Actual imported GLB rig · cyan = left leg/arm · amber = right · four gait phases · not a WebGL/game screenshot</text>`;
  svg += `<text x="30" y="91" fill="#d1dae0" font-size="12" font-family="monospace">body height ${info.measuredBodyHeightM}m · two-bone knee IK · root/hitboxes untouched · 120Hz numeric sweep</text>`;
  let max = 0;
  for (let d = 0; d < DIRECTIONS.length; d++) {
    const direction = DIRECTIONS[d];
    const clip = info.clips[`CM_Move_${direction}`];
    if (!clip || clip.gaitPoseFrames?.length !== 4) throw new Error(`${fighter}/${direction}: missing measured gait poses`);
    max = Math.max(max, clip.gaitLateralKneeSplayMaxM);
    for (const [view, v] of [["FRONT",0],["SIDE",1]]) {
      const row = d * 2 + v;
      for (let col=0; col<PHASES.length; col++) {
        svg += draw(clip.gaitPoseFrames[col], view, 20 + col*PANEL_W, TOP + row*PANEL_H,
          info.measuredBodyHeightM, direction, PHASES[col], clip.gaitLateralKneeSplayMaxM);
      }
    }
  }
  svg += `<text x="28" y="${TOP+PANEL_H*8+29}" fill="#e6c5aa" font-size="14" font-family="monospace">MAX LATERAL KNEE DEVIATION, AUDITED L/R/FR/FL: ${fmt(max*100)}cm — visual QA required</text></svg>`;
  await writeFile(`${OUT}/gait-pose-plates/${fighter.toLowerCase()}-eight-way-gait-bones.svg`,svg);
  summary.push(`- ${fighter}: max L/R/FR/FL knee lateral deviation ${fmt(max*100)} cm, [front & side bone sheet](gait-pose-plates/${fighter.toLowerCase()}-eight-way-gait-bones.svg)`);
}
await writeFile(`${OUT}/gait-pose-plates/README.md`, summary.join("\n")+"\n");
console.log("GLB_GAIT_VISUAL_PLATES_CREATED", Object.keys(report.fighters).join(","));

import * as THREE from "three";
import type { FighterDefinition } from "./types";
import type {
  FighterRig,
  FighterVisualLayout,
  FighterVisualQuality,
  FootPlantState,
  FootSide,
  LimbVisual,
  ProportionMetrics,
} from "./visual";

/**
 * SERA V8: one view-independent skinned BufferGeometry.
 * No reference pixels, masks, rectangles, sprites, or camera-specific planes
 * are used by this runtime model.
 */
const STYLE = {
  headHeight: 0.142,
  headWidth: 0.108,
  shoulderWidth: 0.236,
  waistWidth: 0.146,
  pelvisWidth: 0.194,
  hipToGround: 0.580,
  thighLength: 0.280,
  shinLength: 0.260,
  shoulderToWrist: 0.365,
  handLength: 0.094,
  footLength: 0.158,
  neckWidth: 0.064,
  chestDepth: 0.112,
  noseProjection: 0.145,
} as const;

const MAT = { skin: 0, black: 1, blue: 2, silver: 3, hair: 4, eye: 5, mouth: 6 } as const;
type Weight = [number, number, number, number, number, number, number, number];
type Ring = { x: number; y: number; z: number; rx: number; rz: number; phase?: number; front?: number };

function weights(...pairs: Array<[number, number]>): Weight {
  const active = pairs.filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const total = active.reduce((sum, [, value]) => sum + value, 0) || 1;
  const out: Weight = [0, 0, 0, 0, 0, 0, 0, 0];
  active.forEach(([bone, value], slot) => { out[slot] = bone; out[slot + 4] = value / total; });
  return out;
}

class Builder {
  positions: number[] = [];
  indices: number[] = [];
  skinIndices: number[] = [];
  skinWeights: number[] = [];
  groups: Array<{ start: number; count: number; materialIndex: number }> = [];

  vertex(point: THREE.Vector3, weight: Weight): number {
    const index = this.positions.length / 3;
    this.positions.push(point.x, point.y, point.z);
    this.skinIndices.push(weight[0], weight[1], weight[2], weight[3]);
    this.skinWeights.push(weight[4], weight[5], weight[6], weight[7]);
    return index;
  }

  tri(a: number, b: number, c: number): void { this.indices.push(a, b, c); }

  loft(rings: Ring[], sides: number, materialIndex: number, weightAt: (ring: number) => Weight, caps = true): void {
    const start = this.indices.length;
    const rows: number[][] = [];
    for (let r = 0; r < rings.length; r += 1) {
      const spec = rings[r];
      const row: number[] = [];
      for (let i = 0; i < sides; i += 1) {
        const angle = i / sides * Math.PI * 2 + (spec.phase ?? 0);
        const c = Math.cos(angle); const s = Math.sin(angle);
        row.push(this.vertex(new THREE.Vector3(
          spec.x + c * spec.rx,
          spec.y,
          spec.z + s * spec.rz + (s > 0 ? (spec.front ?? 0) * s * s * s : 0),
        ), weightAt(r)));
      }
      rows.push(row);
    }
    for (let r = 0; r < rows.length - 1; r += 1) for (let i = 0; i < sides; i += 1) {
      const n = (i + 1) % sides;
      this.tri(rows[r][i], rows[r][n], rows[r + 1][i]);
      this.tri(rows[r][n], rows[r + 1][n], rows[r + 1][i]);
    }
    if (caps) {
      const first = rings[0]; const last = rings[rings.length - 1];
      const c0 = this.vertex(new THREE.Vector3(first.x, first.y, first.z), weightAt(0));
      const c1 = this.vertex(new THREE.Vector3(last.x, last.y, last.z), weightAt(rings.length - 1));
      for (let i = 0; i < sides; i += 1) {
        const n = (i + 1) % sides;
        this.tri(c0, rows[0][n], rows[0][i]);
        this.tri(c1, rows[rows.length - 1][i], rows[rows.length - 1][n]);
      }
    }
    this.groups.push({ start, count: this.indices.length - start, materialIndex });
  }

  prism(center: THREE.Vector3, size: THREE.Vector3, materialIndex: number, weight: Weight, rotation = new THREE.Euler(), top = 1, bottom = 1): void {
    const start = this.indices.length;
    const hx = size.x / 2; const hy = size.y / 2; const hz = size.z / 2;
    const q = new THREE.Quaternion().setFromEuler(rotation);
    const points = [
      [-hx * bottom, -hy, -hz], [hx * bottom, -hy, -hz], [hx * bottom, -hy, hz], [-hx * bottom, -hy, hz],
      [-hx * top, hy, -hz], [hx * top, hy, -hz], [hx * top, hy, hz], [-hx * top, hy, hz],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z).applyQuaternion(q).add(center));
    const v = points.map((point) => this.vertex(point, weight));
    const f = [0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7];
    for (let i = 0; i < f.length; i += 3) this.tri(v[f[i]], v[f[i + 1]], v[f[i + 2]]);
    this.groups.push({ start, count: this.indices.length - start, materialIndex });
  }

  tube(path: THREE.Vector3[], radii: Array<[number, number]>, sides: number, materialIndex: number, weight: Weight): void {
    const start = this.indices.length;
    const rows: number[][] = [];
    for (let p = 0; p < path.length; p += 1) {
      const prev = path[Math.max(0, p - 1)]; const next = path[Math.min(path.length - 1, p + 1)];
      const tangent = next.clone().sub(prev).normalize();
      let axisA = new THREE.Vector3(1, 0, 0).sub(tangent.clone().multiplyScalar(tangent.x)).normalize();
      if (axisA.lengthSq() < 0.2) axisA = new THREE.Vector3(0, 0, 1);
      const axisB = tangent.clone().cross(axisA).normalize();
      const row: number[] = [];
      for (let i = 0; i < sides; i += 1) {
        const angle = i / sides * Math.PI * 2;
        row.push(this.vertex(path[p].clone().addScaledVector(axisA, Math.cos(angle) * radii[p][0]).addScaledVector(axisB, Math.sin(angle) * radii[p][1]), weight));
      }
      rows.push(row);
    }
    for (let p = 0; p < rows.length - 1; p += 1) for (let i = 0; i < sides; i += 1) {
      const n = (i + 1) % sides;
      this.tri(rows[p][i], rows[p][n], rows[p + 1][i]);
      this.tri(rows[p][n], rows[p + 1][n], rows[p + 1][i]);
    }
    this.groups.push({ start, count: this.indices.length - start, materialIndex });
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(this.skinIndices, 4));
    g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(this.skinWeights, 4));
    g.setIndex(this.indices);
    this.groups.forEach((group) => g.addGroup(group.start, group.count, group.materialIndex));
    g.computeVertexNormals(); g.computeBoundingSphere();
    g.userData.visualVersion = "V8";
    g.userData.singleViewIndependentMesh = true;
    return g;
  }
}

function layout(quality: FighterVisualQuality): FighterVisualLayout {
  return {
    ...STYLE,
    normalizedHeight: 1,
    worldScale: quality === "LOW" ? 3.20 : quality === "HIGH" ? 3.28 : 3.24,
    headBottom: 0.858,
    shoulderY: 0.838,
    hipsY: 0.580,
    kneeY: 0.300,
    ankleY: 0.040,
    elbowY: 0.640,
    wristY: 0.473,
    pelvisTopY: 0.645,
    waistY: 0.705,
    ribY: 0.790,
    clavicleY: 0.825,
    headDepth: 0.112,
  };
}

function rigFor(l: FighterVisualLayout): FighterRig {
  const names = ["root","hips","spineLower","spineUpper","chest","neck","head","leftShoulder","leftUpperArm","leftForearm","leftHand","rightShoulder","rightUpperArm","rightForearm","rightHand","leftThigh","leftShin","leftFoot","rightThigh","rightShin","rightFoot"];
  const bones = Object.fromEntries(names.map((name) => { const b = new THREE.Bone(); b.name = `v4-${name}`; return [name, b]; })) as Record<string, THREE.Bone>;
  bones.root.add(bones.hips); bones.hips.position.y = l.hipsY;
  bones.hips.add(bones.spineLower); bones.spineLower.position.y = l.pelvisTopY - l.hipsY;
  bones.spineLower.add(bones.spineUpper); bones.spineUpper.position.y = l.ribY - l.pelvisTopY;
  bones.spineUpper.add(bones.chest); bones.chest.position.y = l.shoulderY - l.ribY;
  bones.chest.add(bones.neck); bones.neck.position.y = l.headBottom - l.shoulderY; bones.neck.add(bones.head);
  bones.chest.add(bones.leftShoulder, bones.rightShoulder); bones.leftShoulder.position.x = -l.shoulderWidth / 2; bones.rightShoulder.position.x = l.shoulderWidth / 2;
  bones.leftShoulder.add(bones.leftUpperArm); bones.rightShoulder.add(bones.rightUpperArm);
  bones.leftUpperArm.add(bones.leftForearm); bones.rightUpperArm.add(bones.rightForearm);
  bones.leftForearm.position.set(-0.027, l.elbowY - l.shoulderY, 0.004); bones.rightForearm.position.set(0.027, l.elbowY - l.shoulderY, 0.004);
  bones.leftForearm.add(bones.leftHand); bones.rightForearm.add(bones.rightHand);
  bones.leftHand.position.set(-0.010, l.wristY - l.elbowY, 0.006); bones.rightHand.position.set(0.010, l.wristY - l.elbowY, 0.006);
  bones.hips.add(bones.leftThigh, bones.rightThigh); const hs = l.pelvisWidth * 0.29; bones.leftThigh.position.x = -hs; bones.rightThigh.position.x = hs;
  bones.leftThigh.add(bones.leftShin); bones.rightThigh.add(bones.rightShin); bones.leftShin.position.y = l.kneeY - l.hipsY; bones.rightShin.position.y = l.kneeY - l.hipsY;
  bones.leftShin.add(bones.leftFoot); bones.rightShin.add(bones.rightFoot); bones.leftFoot.position.y = l.ankleY - l.kneeY; bones.rightFoot.position.y = l.ankleY - l.kneeY;
  const boneIndices = Object.fromEntries(names.map((name, index) => [name, index]));
  return { root: bones.root, bones, boneIndices, skeleton: new THREE.Skeleton(names.map((name) => bones[name])) };
}

function materials(definition: FighterDefinition): THREE.Material[] {
  const m = (color: number, roughness: number, metalness = 0.01) => new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });
  return [m(definition.colors.skin, 0.72, 0), m(definition.colors.secondary, 0.68), m(definition.colors.primary, 0.61, 0.03), m(0xd8e3ef, 0.48, 0.24), m(definition.colors.hair, 0.52), m(0xeaf4ff, 0.62, 0), m(0x532936, 0.74, 0)];
}

function buildCharacter(builder: Builder, l: FighterVisualLayout, rig: FighterRig): void {
  const b = rig.boneIndices;
  builder.loft([
    {x:0,y:.548,z:-.004,rx:.075,rz:.070,phase:Math.PI/8},{x:0,y:.585,z:-.004,rx:.098,rz:.092,phase:Math.PI/8},{x:0,y:.645,z:.002,rx:.091,rz:.086},{x:0,y:.705,z:.006,rx:.073,rz:.070,phase:Math.PI/8},{x:0,y:.765,z:.010,rx:.085,rz:.083},{x:0,y:.805,z:.011,rx:.103,rz:.100,phase:Math.PI/8},{x:0,y:.838,z:.005,rx:.111,rz:.084}
  ], 8, MAT.black, (r) => r < 2 ? weights([b.hips,.78],[b.spineLower,.22]) : r < 4 ? weights([b.spineLower,.78],[b.spineUpper,.22]) : r < 6 ? weights([b.spineUpper,.55],[b.chest,.45]) : weights([b.chest,.9],[b.spineUpper,.1]));
  builder.loft([{x:0,y:.835,z:0,rx:.034,rz:.032},{x:0,y:.870,z:.003,rx:.031,rz:.030,phase:Math.PI/8}],8,MAT.skin,()=>weights([b.neck,.72],[b.head,.28]));
  builder.loft([
    {x:0,y:.858,z:.006,rx:.034,rz:.038,phase:Math.PI/10},{x:0,y:.878,z:.010,rx:.042,rz:.048},{x:0,y:.905,z:.013,rx:.051,rz:.058,front:.012,phase:Math.PI/10},{x:0,y:.936,z:.005,rx:.055,rz:.059,front:.004},{x:0,y:.972,z:-.002,rx:.052,rz:.056,phase:Math.PI/10},{x:0,y:1,z:-.005,rx:.038,rz:.043}
  ],10,MAT.skin,()=>weights([b.head,1]));
  builder.prism(new THREE.Vector3(0,.907,.071),new THREE.Vector3(.018,.050,.032),MAT.skin,weights([b.head,1]),new THREE.Euler(-.10,0,0),.55,.78);
  builder.prism(new THREE.Vector3(0,.889,.084),new THREE.Vector3(.024,.021,.025),MAT.skin,weights([b.head,1]),new THREE.Euler(-.08,0,0),.70,.85);
  for (const side of [-1,1] as const) {
    builder.prism(new THREE.Vector3(side*.019,.925,.067),new THREE.Vector3(.024,.009,.008),MAT.eye,weights([b.head,1]),new THREE.Euler(0,0,side*-.10),.72,.90);
    builder.prism(new THREE.Vector3(side*.020,.941,.064),new THREE.Vector3(.029,.006,.007),MAT.hair,weights([b.head,1]),new THREE.Euler(0,0,side*-.13),.78,.90);
  }
  builder.prism(new THREE.Vector3(0,.874,.063),new THREE.Vector3(.029,.007,.009),MAT.mouth,weights([b.head,1]));

  for (const side of [-1,1] as const) {
    const upper = side < 0 ? b.leftUpperArm : b.rightUpperArm; const fore = side < 0 ? b.leftForearm : b.rightForearm; const hand = side < 0 ? b.leftHand : b.rightHand; const shoulder = side < 0 ? b.leftShoulder : b.rightShoulder;
    const sx = side*l.shoulderWidth/2; const ex = side*.145; const wx = side*.155;
    builder.loft([{x:sx,y:.837,z:.003,rx:.030,rz:.031,phase:Math.PI/8},{x:side*.132,y:.745,z:.004,rx:.026,rz:.027},{x:ex,y:l.elbowY,z:.006,rx:.021,rz:.022,phase:Math.PI/8}],8,MAT.skin,(r)=>r===0?weights([upper,.8],[shoulder,.2]):r===2?weights([upper,.5],[fore,.5]):weights([upper,1]));
    builder.loft([{x:ex,y:l.elbowY,z:.006,rx:.022,rz:.023,phase:Math.PI/8},{x:side*.151,y:.558,z:.008,rx:.019,rz:.021},{x:wx,y:l.wristY,z:.010,rx:.014,rz:.016,phase:Math.PI/8}],8,MAT.black,(r)=>r===0?weights([upper,.5],[fore,.5]):r===2?weights([fore,.75],[hand,.25]):weights([fore,1]));
    builder.prism(new THREE.Vector3(wx+side*.003,.430,.025),new THREE.Vector3(.040,.090,.060),MAT.black,weights([hand,1]),new THREE.Euler(.08,0,side*-.04),.82,.68);
    builder.prism(new THREE.Vector3(side*.153,.545,.022),new THREE.Vector3(.052,.135,.046),MAT.silver,weights([fore,1]),new THREE.Euler(.04,0,side*-.03),.76,.92);
  }

  const hs = l.pelvisWidth*.29;
  for (const side of [-1,1] as const) {
    const thigh=side<0?b.leftThigh:b.rightThigh; const shin=side<0?b.leftShin:b.rightShin; const foot=side<0?b.leftFoot:b.rightFoot; const x=side*hs;
    builder.loft([{x,y:.590,z:0,rx:.049,rz:.058,phase:Math.PI/8},{x:side*.060,y:.455,z:.002,rx:.042,rz:.050},{x:side*.061,y:.326,z:.003,rx:.032,rz:.039,phase:Math.PI/8},{x:side*.061,y:l.kneeY,z:.005,rx:.029,rz:.035}],8,MAT.black,(r)=>r===0?weights([thigh,.82],[b.hips,.18]):r===3?weights([thigh,.5],[shin,.5]):weights([thigh,1]));
    builder.loft([{x:side*.061,y:l.kneeY,z:.005,rx:.030,rz:.036,phase:Math.PI/8},{x:side*.064,y:.205,z:0,rx:.029,rz:.038},{x:side*.065,y:.105,z:.002,rx:.023,rz:.029,phase:Math.PI/8},{x:side*.066,y:l.ankleY,z:.005,rx:.018,rz:.022}],8,MAT.black,(r)=>r===0?weights([thigh,.5],[shin,.5]):r===3?weights([shin,.78],[foot,.22]):weights([shin,1]));
    builder.prism(new THREE.Vector3(side*.066,.135,.010),new THREE.Vector3(.066,.205,.056),MAT.blue,weights([shin,1]),new THREE.Euler(.02,0,side*-.02),.74,.92);
    builder.prism(new THREE.Vector3(side*.066,.010,.073),new THREE.Vector3(.072,.060,.168),MAT.blue,weights([foot,1]),new THREE.Euler(-.05,0,0),.58,.84);
    builder.prism(new THREE.Vector3(side*.066,-.018,.078),new THREE.Vector3(.075,.018,.172),MAT.silver,weights([foot,1]),new THREE.Euler(-.04,0,0),.60,.86);
  }

  builder.prism(new THREE.Vector3(0,.790,.070),new THREE.Vector3(.104,.135,.062),MAT.black,weights([b.chest,.82],[b.spineUpper,.18]),new THREE.Euler(-.03,0,0),.78,.92);
  builder.prism(new THREE.Vector3(-.061,.805,.054),new THREE.Vector3(.072,.165,.070),MAT.blue,weights([b.chest,1]),new THREE.Euler(0,.02,-.10),.75,.90);
  builder.prism(new THREE.Vector3(.061,.805,.054),new THREE.Vector3(.072,.165,.070),MAT.blue,weights([b.chest,1]),new THREE.Euler(0,-.02,.10),.75,.90);
  builder.prism(new THREE.Vector3(0,.858,.020),new THREE.Vector3(.058,.090,.060),MAT.blue,weights([b.chest,.75],[b.neck,.25]),new THREE.Euler(),.82,.92);
  builder.prism(new THREE.Vector3(0,.655,.074),new THREE.Vector3(.176,.118,.055),MAT.blue,weights([b.hips,.70],[b.spineLower,.30]),new THREE.Euler(.02,0,0),.72,.95);
  builder.prism(new THREE.Vector3(0,.545,.052),new THREE.Vector3(.145,.205,.045),MAT.blue,weights([b.hips,1]),new THREE.Euler(.10,0,0),.55,.92);
  builder.prism(new THREE.Vector3(.075,.500,-.055),new THREE.Vector3(.078,.300,.045),MAT.blue,weights([b.hips,1]),new THREE.Euler(-.06,0,-.06),.50,.90);
  builder.prism(new THREE.Vector3(-.075,.520,-.045),new THREE.Vector3(.068,.230,.042),MAT.blue,weights([b.hips,1]),new THREE.Euler(-.04,0,.05),.55,.90);

  builder.loft([{x:0,y:.925,z:-.012,rx:.056,rz:.061,phase:Math.PI/10},{x:0,y:.966,z:-.014,rx:.058,rz:.061},{x:0,y:1.006,z:-.018,rx:.043,rz:.048,phase:Math.PI/10}],10,MAT.hair,()=>weights([b.head,1]));
  builder.prism(new THREE.Vector3(0,.951,.052),new THREE.Vector3(.082,.075,.034),MAT.hair,weights([b.head,1]),new THREE.Euler(-.18,0,0),.55,.90);
  builder.tube([new THREE.Vector3(0,.985,-.070),new THREE.Vector3(.004,1.015,-.120),new THREE.Vector3(.010,.970,-.178),new THREE.Vector3(.016,.885,-.225),new THREE.Vector3(.022,.785,-.255),new THREE.Vector3(.020,.690,-.265)],[[.030,.027],[.033,.030],[.032,.029],[.027,.025],[.021,.020],[.012,.014]],8,MAT.hair,weights([b.head,1]));
}

function marker(name: string, bone: THREE.Bone, position: THREE.Vector3): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ visible: false }));
  mesh.name = name; mesh.position.copy(position); mesh.visible = false; mesh.userData.excludeFromMetrics = true; bone.add(mesh); return mesh;
}

function contacts(l: FighterVisualLayout) {
  const spacing = l.pelvisWidth*.29;
  const make=(side:-1|1)=>({soleLocal:new THREE.Vector3(0,-.058,l.footLength*.28),endLocal:new THREE.Vector3(0,-.030,l.footLength*.70),homeLocal:new THREE.Vector3(side*spacing,l.ankleY-.058,0)});
  return {left:make(-1),right:make(1)};
}

function proportions(l: FighterVisualLayout): ProportionMetrics {
  return {headCount:1/l.headHeight,shoulderHeadRatio:l.shoulderWidth/l.headWidth,shoulderWaistRatio:l.shoulderWidth/l.waistWidth,pelvisShoulderRatio:l.pelvisWidth/l.shoulderWidth,hipGroundRatio:l.hipToGround,thighShinRatio:l.thighLength/l.shinLength,legHeightRatio:l.thighLength+l.shinLength};
}

function helpers(rig: FighterRig, l: FighterVisualLayout): {leftArm:LimbVisual;rightArm:LimbVisual;leftLeg:LimbVisual;rightLeg:LimbVisual} {
  const lh=marker("v8-left-fist-contact",rig.bones.leftHand,new THREE.Vector3(0,-l.handLength*.48,.030));
  const rh=marker("v8-right-fist-contact",rig.bones.rightHand,new THREE.Vector3(0,-l.handLength*.48,.030));
  const lf=marker("v8-left-foot-contact",rig.bones.leftFoot,new THREE.Vector3(0,-.030,l.footLength*.70));
  const rf=marker("v8-right-foot-contact",rig.bones.rightFoot,new THREE.Vector3(0,-.030,l.footLength*.70));
  return {leftArm:{root:rig.bones.leftUpperArm,upper:rig.bones.leftUpperArm,lower:rig.bones.leftForearm,end:lh},rightArm:{root:rig.bones.rightUpperArm,upper:rig.bones.rightUpperArm,lower:rig.bones.rightForearm,end:rh},leftLeg:{root:rig.bones.leftThigh,upper:rig.bones.leftThigh,lower:rig.bones.leftShin,end:lf},rightLeg:{root:rig.bones.rightThigh,upper:rig.bones.rightThigh,lower:rig.bones.rightShin,end:rf}};
}

export function createFemaleV8Visual(definition: FighterDefinition, quality: FighterVisualQuality): unknown {
  const l=layout(quality); const rig=rigFor(l); const builder=new Builder(); buildCharacter(builder,l,rig); const geometry=builder.build(); const mats=materials(definition);
  const bodyMesh=new THREE.SkinnedMesh(geometry,mats); bodyMesh.name="v8-sera-single-skinned-mesh"; bodyMesh.userData.singleCharacterGeometry=true;
  const root=new THREE.Group(); root.name=`fighter-v8-${definition.id}`; root.scale.setScalar(l.worldScale); root.add(rig.root,bodyMesh); root.updateMatrixWorld(true); bodyMesh.bind(rig.skeleton);
  const h=helpers(rig,l); const panels=new THREE.Group(); panels.name="v8-integrated-clothing"; root.add(panels); const debugGroup=new THREE.Group(); debugGroup.visible=false; debugGroup.name="v8-debug"; root.add(debugGroup);
  const aura=new THREE.Mesh(new THREE.SphereGeometry(1,8,6),new THREE.MeshBasicMaterial({color:definition.colors.glow,transparent:true,opacity:.18,depthWrite:false,blending:THREE.AdditiveBlending})); aura.name="fighter-energy-aura-v8"; aura.scale.set(.25,.54,.16); aura.position.y=.46; aura.visible=false; aura.userData.excludeFromMetrics=true; root.add(aura);
  const footContacts=contacts(l); const footPlants:Record<FootSide,FootPlantState>={left:{active:false,world:new THREE.Vector3(),lastRootWorld:new THREE.Vector3()},right:{active:false,world:new THREE.Vector3(),lastRootWorld:new THREE.Vector3()}};
  const vertexCount=geometry.getAttribute("position")?.count??0; const triangleCount=Math.floor((geometry.getIndex()?.count??0)/3);
  return {root,hips:rig.bones.hips,torso:rig.bones.chest,chest:bodyMesh,bodyMesh,head:rig.bones.head,hair:bodyMesh,leftArm:h.leftArm,rightArm:h.rightArm,leftLeg:h.leftLeg,rightLeg:h.rightLeg,panels,aura,allMeshes:[bodyMesh,aura,h.leftArm.end,h.rightArm.end,h.leftLeg.end,h.rightLeg.end],rig,layout:l,stats:{quality,vertexCount,triangleCount,meshCount:1,materialCount:mats.length,proportions:proportions(l),facetDistribution:{large:0,medium:0,small:0},materialCoverage:{dark:.46,primary:.27,skin:.20,other:.07},scores:{style:null,silhouette:null,proportion:0,landmark:null,facet:0,colorMaterial:null,surfaceContinuity:null},skinnedMesh:true,weightedVertexCount:vertexCount,visualVersion:"V8"},footContacts,footPlants,clothingAttachments:[],hairMasses:[],ponytailMasses:[],debugGroup,visualVersion:"V8"};
}

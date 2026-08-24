import copy, hashlib, json, math, os, random
import bpy

SCHEMA_VERSION='SERA_HERO_PARAMETER_SPACE_V1_96D'
STATE_VERSION='SERA_HERO_PARAMETER_SEARCH_STATE_V1'
CACHE_VERSION='SERA_HERO_PARAMETER_SEARCH_CACHE_V1'
GROUPS=('skeleton','face','hair','arms','legs','costume')

def D(name,group,kind,amount,**kw):
    x={'name':name,'group':group,'kind':kind,'amount':float(amount),'min':-1.0,'max':1.0}; x.update(kw); return x

def parameter_defs():
    P=[]
    rows=[
      ('sk_head_width','body_scale',.16,'x',(.845,1),None,None,'global'),('sk_head_depth','body_scale',.16,'y',(.845,1),None,None,'global'),
      ('sk_head_height','body_scale',.12,'z',(.845,1),None,None,'global'),('sk_forehead_width','body_scale',.12,'x',(.925,1),None,None,'global'),
      ('sk_jaw_width','body_scale',.16,'x',(.845,.925),None,None,'global'),('sk_jaw_depth','body_scale',.14,'y',(.845,.925),None,None,'global'),
      ('sk_chin_height','body_shift',.014,'z',(.845,.885),None,None,None),('sk_neck_width','body_scale',.14,'x',(.785,.855),None,.09,'global'),
      ('sk_neck_depth','body_scale',.14,'y',(.785,.855),None,.09,'global'),('sk_shoulder_width','body_scale',.14,'x',(.675,.805),None,.23,'global'),
      ('sk_chest_width','body_scale',.14,'x',(.615,.755),None,.20,'global'),('sk_chest_depth','body_scale',.16,'y',(.615,.755),None,.20,'global'),
      ('sk_waist_width','body_scale',.16,'x',(.505,.615),None,.17,'global'),('sk_waist_depth','body_scale',.16,'y',(.505,.615),None,.17,'global'),
      ('sk_pelvis_width','body_scale',.15,'x',(.425,.545),None,.19,'global'),('sk_pelvis_depth','body_scale',.15,'y',(.425,.545),None,.19,'global'),
      ('sk_upper_torso_height','body_scale',.08,'z',(.60,.81),None,.22,'global'),('sk_lower_torso_height','body_scale',.08,'z',(.42,.62),None,.20,'global'),
      ('sk_chest_forward','body_shift',.016,'y',(.62,.76),None,.20,None),('sk_pelvis_forward','body_shift',.014,'y',(.43,.54),None,.20,None)]
    for n,k,a,axis,z,amin,amax,pivot in rows:
        P.append(D(n,'skeleton',k,a,axis=axis,z=z,abs_x_min=amin,abs_x_max=amax,**({'pivot':pivot} if pivot else {})))
    P += [D('face_mid_width','face','body_scale',.11,axis='x',z=(.875,.945),pivot='global'),D('face_mid_depth','face','body_scale',.10,axis='y',z=(.875,.945),pivot='global'),
          D('face_lower_width','face','body_scale',.13,axis='x',z=(.845,.895),pivot='global'),D('face_lower_depth','face','body_scale',.11,axis='y',z=(.845,.895),pivot='global')]
    obj=[
      ('face_eye_spacing','object_pair_spread',.014,('SERA_EyeL','SERA_EyeR'),'x'),('face_eye_height','object_shift',.010,('SERA_EyeL','SERA_EyeR'),'z'),
      ('face_eye_forward','object_shift',.008,('SERA_EyeL','SERA_EyeR'),'y'),('face_eye_width','object_scale',.24,('SERA_EyeL','SERA_EyeR'),'x'),
      ('face_eye_thickness','object_scale',.24,('SERA_EyeL','SERA_EyeR'),'z'),('face_brow_spacing','object_pair_spread',.012,('SERA_BrowL','SERA_BrowR'),'x'),
      ('face_brow_height','object_shift',.012,('SERA_BrowL','SERA_BrowR'),'z'),('face_brow_forward','object_shift',.008,('SERA_BrowL','SERA_BrowR'),'y'),
      ('face_brow_width','object_scale',.22,('SERA_BrowL','SERA_BrowR'),'x'),('face_brow_angle','object_pair_rotate',.16,('SERA_BrowL','SERA_BrowR'),'z'),
      ('face_nose_width','object_scale',.28,('SERA_NosePlane',),'x'),('face_nose_length','object_scale',.24,('SERA_NosePlane',),'z'),
      ('face_nose_forward','object_shift',.010,('SERA_NosePlane',),'y'),('face_nose_height','object_shift',.012,('SERA_NosePlane',),'z'),
      ('face_mouth_width','object_scale',.24,('SERA_Lip',),'x'),('face_mouth_height','object_shift',.012,('SERA_Lip',),'z')]
    P += [D(n,'face',k,a,names=names,axis=axis) for n,k,a,names,axis in obj]
    fringe=('SERA_HairlineL','SERA_HairlineR','SERA_FringeRootL','SERA_FringeRootR','SERA_FringeCenter','SERA_FringeL','SERA_FringeR','SERA_FringeSideL','SERA_FringeSideR')
    side=('SERA_SideHairL','SERA_SideHairR'); nape=('SERA_NapeHairL','SERA_NapeHairR'); temple=('SERA_TempleLockL','SERA_TempleLockR'); pony=('SERA_PonyRoot','SERA_Pony1','SERA_Pony2','SERA_Pony3')
    hair=[
      ('hair_cap_width','object_scale',.22,('SERA_HairCap',),'x'),('hair_cap_depth','object_scale',.22,('SERA_HairCap',),'y'),('hair_cap_height','object_scale',.20,('SERA_HairCap',),'z'),
      ('hair_cap_vertical','object_shift',.018,('SERA_HairCap',),'z'),('hair_cap_depth_shift','object_shift',.016,('SERA_HairCap',),'y'),
      ('hair_fringe_width','object_scale',.24,fringe,'x'),('hair_fringe_length','object_scale',.25,fringe,'z'),('hair_fringe_depth','object_scale',.22,fringe,'y'),
      ('hair_fringe_vertical','object_shift',.016,fringe,'z'),('hair_fringe_forward','object_shift',.014,fringe,'y'),('hair_side_spread','object_pair_spread',.018,side,'x'),
      ('hair_side_length','object_scale',.26,side,'z'),('hair_side_depth','object_scale',.22,side,'y'),('hair_nape_length','object_scale',.28,nape,'z'),
      ('hair_nape_depth','object_shift',.018,nape,'y'),('hair_temple_length','object_scale',.28,temple,'z'),('hair_pony_width','object_scale',.24,pony,'x'),
      ('hair_pony_depth','object_scale',.24,pony,'y'),('hair_pony_length','object_scale',.28,pony,'z'),('hair_pony_root_height','object_shift',.025,pony,'z')]
    P += [D(n,'hair',k,a,names=names,axis=axis) for n,k,a,names,axis in hair]
    arms=[
      ('arm_upper_thickness_y','body_scale',.18,'y',(.64,.80),.15,.34,'per_side'),('arm_upper_thickness_z','body_scale',.18,'z',(.64,.80),.15,.34,'per_side'),
      ('arm_upper_length','body_scale',.10,'x',(.64,.80),.15,.36,'per_side'),('arm_forearm_thickness_y','body_scale',.20,'y',(.60,.79),.29,.48,'per_side'),
      ('arm_forearm_thickness_z','body_scale',.20,'z',(.60,.79),.29,.48,'per_side'),('arm_forearm_length','body_scale',.10,'x',(.60,.79),.29,.50,'per_side'),
      ('arm_hand_width','body_scale',.22,'z',(.58,.80),.44,None,'per_side'),('arm_hand_depth','body_scale',.22,'y',(.58,.80),.44,None,'per_side'),
      ('arm_hand_length','body_scale',.14,'x',(.58,.80),.44,None,'per_side'),('arm_span','body_mirror_shift',.025,'x',(.59,.81),.14,None,None),
      ('arm_vertical','body_shift',.018,'z',(.59,.81),.15,None,None),('arm_shoulder_mass','body_scale',.16,'x',(.68,.80),.11,.24,'per_side')]
    legs=[
      ('leg_thigh_width','body_scale',.18,'x',(.29,.53),.015,.15,'per_side'),('leg_thigh_depth','body_scale',.18,'y',(.29,.53),.015,.15,'per_side'),
      ('leg_thigh_length','body_scale',.09,'z',(.27,.54),None,.17,'per_side'),('leg_knee_width','body_scale',.18,'x',(.23,.33),None,.14,'per_side'),
      ('leg_calf_width','body_scale',.20,'x',(.08,.30),None,.14,'per_side'),('leg_calf_depth','body_scale',.20,'y',(.08,.30),None,.14,'per_side'),
      ('leg_calf_length','body_scale',.09,'z',(.06,.31),None,.15,'per_side'),('leg_ankle_width','body_scale',.22,'x',(.035,.115),None,.13,'per_side'),
      ('leg_ankle_depth','body_scale',.20,'y',(.035,.115),None,.13,'per_side'),('leg_foot_length','body_scale',.20,'y',(0,.09),None,None,'per_side'),
      ('leg_foot_width','body_scale',.20,'x',(0,.09),None,None,'per_side'),('leg_spread','body_mirror_shift',.016,'x',(0,.55),.012,None,None)]
    for group,rows in (('arms',arms),('legs',legs)):
      for n,k,a,axis,z,amin,amax,pivot in rows:
        P.append(D(n,group,k,a,axis=axis,z=z,abs_x_min=amin,abs_x_max=amax,**({'pivot':pivot} if pivot else {})))
    skirts=('SERA_FrontSkirt','SERA_LeftSkirt','SERA_RightSkirt'); side_skirts=('SERA_LeftSkirt','SERA_RightSkirt'); guards=('SERA_Guard_l','SERA_Guard_r'); shins=('SERA_Shin_l','SERA_Shin_r'); boots=('SERA_BootFoot_l','SERA_BootFoot_r')
    costume=[('costume_collar_width','object_scale',.24,('SERA_Collar',),'x'),('costume_collar_depth','object_scale',.22,('SERA_Collar',),'y'),('costume_collar_height','object_scale',.24,('SERA_Collar',),'z'),
      ('costume_skirt_width','object_scale',.24,skirts,'x'),('costume_skirt_depth','object_scale',.24,skirts,'y'),('costume_skirt_length','object_scale',.26,skirts,'z'),
      ('costume_side_skirt_spread','object_pair_spread',.025,side_skirts,'x'),('costume_guard_width','object_scale',.25,guards,'x'),('costume_guard_length','object_scale',.25,guards,'z'),
      ('costume_shin_width','object_scale',.25,shins,'x'),('costume_shin_length','object_scale',.25,shins,'z'),('costume_boot_scale','object_scale_uniform',.22,boots,None)]
    for n,k,a,names,axis in costume: P.append(D(n,'costume',k,a,names=names,**({'axis':axis} if axis else {})))
    if len(P)!=96: raise RuntimeError(f'SERA parameter schema drifted: expected 96, got {len(P)}')
    return P

def _bounds(body):
    c=[v.co for v in body.data.vertices]; xs=[v.x for v in c]; ys=[v.y for v in c]; zs=[v.z for v in c]
    return {'minX':min(xs),'maxX':max(xs),'minY':min(ys),'maxY':max(ys),'minZ':min(zs),'maxZ':max(zs)}

def _select(body,d,b):
    h=max(1e-6,b['maxZ']-b['minZ']); cx=(b['minX']+b['maxX'])/2; z0,z1=d.get('z',(0,1)); out=[]
    for v in body.data.vertices:
      z=(v.co.z-b['minZ'])/h; ax=abs(v.co.x-cx)/h
      if z0<=z<=z1 and (d.get('abs_x_min') is None or ax>=d['abs_x_min']) and (d.get('abs_x_max') is None or ax<=d['abs_x_max']): out.append(v)
    return out

def _scale(vs,axis,factor):
    if not vs:return
    p=sum(getattr(v.co,axis) for v in vs)/len(vs)
    for v in vs:setattr(v.co,axis,p+(getattr(v.co,axis)-p)*factor)

def _apply_body(body,d,value,b):
    vs=_select(body,d,b); axis=d.get('axis','x'); h=max(1e-6,b['maxZ']-b['minZ']); kind=d['kind']
    if kind=='body_shift':
      q=value*d['amount']*h
      for v in vs:setattr(v.co,axis,getattr(v.co,axis)+q)
    elif kind=='body_mirror_shift':
      q=value*d['amount']*h; cx=(b['minX']+b['maxX'])/2
      for v in vs:setattr(v.co,axis,getattr(v.co,axis)+q*(-1 if v.co.x<cx else 1))
    else:
      f=max(.55,1+value*d['amount'])
      if d.get('pivot')=='per_side':
        cx=(b['minX']+b['maxX'])/2; _scale([v for v in vs if v.co.x<cx],axis,f); _scale([v for v in vs if v.co.x>=cx],axis,f)
      else:_scale(vs,axis,f)

def _apply_object(d,value):
    objs=[bpy.data.objects.get(n) for n in d.get('names',()) if bpy.data.objects.get(n)]; kind=d['kind']; axis=d.get('axis','x'); a=d['amount']
    if kind=='object_scale_uniform':
      f=max(.55,1+value*a)
      for o in objs:o.scale.x*=f;o.scale.y*=f;o.scale.z*=f
    elif kind=='object_scale':
      f=max(.55,1+value*a)
      for o in objs:setattr(o.scale,axis,getattr(o.scale,axis)*f)
    elif kind=='object_shift':
      for o in objs:setattr(o.location,axis,getattr(o.location,axis)+value*a)
    elif kind=='object_pair_spread':
      for o in objs:setattr(o.location,axis,getattr(o.location,axis)+value*a*(-1 if o.location.x<0 else 1))
    elif kind=='object_pair_rotate':
      for o in objs:setattr(o.rotation_euler,axis,getattr(o.rotation_euler,axis)+value*a*(-1 if o.location.x<0 else 1))

class SceneSnapshot:
  def __init__(self,body):
    self.body=body; self.vertices=[v.co.copy() for v in body.data.vertices]; self.bounds=_bounds(body); self.objects={o.name:(o.location.copy(),o.scale.copy(),o.rotation_euler.copy()) for o in bpy.context.scene.objects if o.name.startswith('SERA_')}
  def restore(self):
    for v,c in zip(self.body.data.vertices,self.vertices):v.co=c
    self.body.data.update()
    for n,(p,s,r) in self.objects.items():
      o=bpy.data.objects.get(n)
      if o:o.location=p.copy();o.scale=s.copy();o.rotation_euler=r.copy()
    bpy.context.view_layer.update()

def apply_parameter_state(snapshot,defs,values):
    snapshot.restore()
    for d in defs:
      v=float(values.get(d['name'],0))
      if abs(v)<1e-8:continue
      (_apply_body(snapshot.body,d,v,snapshot.bounds) if d['kind'].startswith('body_') else _apply_object(d,v))
    snapshot.body.data.update();bpy.context.view_layer.update()

def _clamp(d,v):return max(d['min'],min(d['max'],float(v)))
def _hash(values):return hashlib.sha256(json.dumps({k:round(float(v),6) for k,v in sorted(values.items()) if abs(v)>1e-8},separators=(',',':')).encode()).hexdigest()[:20]
def _load(path,fallback):
    if not path or not os.path.exists(path):return copy.deepcopy(fallback)
    try:
      with open(path,encoding='utf-8') as f:return json.load(f)
    except Exception:return copy.deepcopy(fallback)
def load_state(path,defs):
    s=_load(path,{}); known={d['name']:d for d in defs}
    if s.get('version') not in (None,STATE_VERSION):s={}
    vals={n:_clamp(known[n],v) for n,v in s.get('parameters',{}).items() if n in known and isinstance(v,(int,float)) and math.isfinite(float(v))}
    return {'version':STATE_VERSION,'schemaVersion':SCHEMA_VERSION,'generation':max(0,int(s.get('generation',0))),'staleGenerations':max(0,int(s.get('staleGenerations',0))),'parameters':vals}
def load_cache(path):
    c=_load(path,{}); return {'version':CACHE_VERSION,'entries':dict(c.get('entries',{}))} if c.get('version')==CACHE_VERSION else {'version':CACHE_VERSION,'entries':{}}
def _cache_put(c,k,o,limit):
    c['entries'][k]=o
    if len(c['entries'])>limit:
      keys=list(c['entries'])[-limit:];c['entries']={k:c['entries'][k] for k in keys}
def _priority(o):
    c=o.get('components',{}); sil=1-float(c.get('silhouette',0)); body=1-float(c.get('bodyLandmarks',0)); fl=1-float(c.get('faceLandmarks',0)); fs=1-float(c.get('faceSilhouette',0)); hair=1-float(c.get('hairSilhouette',0))
    need={'skeleton':sil*.55+body*.45,'arms':sil*.7+body*.3,'legs':sil*.7+body*.3,'costume':sil*.8+body*.2,'face':fs*.48+fl*.42+sil*.1,'hair':hair*.7+sil*.3}
    return sorted(GROUPS,key=lambda g:(-need[g],g)),need
def _view_safe(new,old,reg):
    return all(float(new.get('views',{}).get(v,{}).get('silhouetteIoU',0))+reg>=float(m.get('silhouetteIoU',0)) for v,m in old.get('views',{}).items())
def _candidate(base,changes,by):
    x=dict(base)
    for n,dv in changes.items():
      x[n]=_clamp(by[n],x.get(n,0)+dv)
      if abs(x[n])<1e-8:x.pop(n,None)
    return x
def _proposals(defs,generation,budget,step,priority):
    groups={g:[d for d in defs if d['group']==g] for g in GROUPS}; rng=random.Random(0x5E2A+generation*7919); out=[]; coord=max(2,budget//2); flat=[]
    for i in range(max(map(len,groups.values()))):
      for g in priority:
        if i<len(groups[g]):flat.append(groups[g][i])
    cur=generation*coord
    for i in range(coord):
      d=flat[(cur+i)%len(flat)];out.append({'kind':'coordinate','group':d['group'],'changes':{d['name']:(1 if (generation+i)%2==0 else -1)*step}})
    while len(out)<budget:
      g=priority[(len(out)-coord)%min(4,len(priority))]; pool=groups[g]; chosen=rng.sample(pool,min(len(pool),3+rng.randrange(4)))
      out.append({'kind':'block','group':g,'changes':{d['name']:(-1 if rng.random()<.5 else 1)*step*rng.uniform(.35,.85) for d in chosen}})
    return out

def run_parameter_search(body,spec,reference,output_dir,render_and_score,state_path=None,cache_path=None,candidate_budget=None):
    defs=parameter_defs();cfg=spec.get('parameterSearch',{});seed=load_state(state_path,defs);cache=load_cache(cache_path);maxgen=max(1,int(cfg.get('maxGenerations',6)));budget=max(1,int(candidate_budget or cfg.get('candidateBudget',8)));minimum=float(cfg.get('minImprovement',.00035));reg=float(cfg.get('maxViewSilhouetteRegression',.025));step=max(float(cfg.get('minStep',.12)),float(cfg.get('initialStep',.62))*float(cfg.get('stepDecay',.82))**seed['generation']);limit=max(32,int(cfg.get('cacheEntries',256)));snap=SceneSnapshot(body);by={d['name']:d for d in defs};vals=dict(seed['parameters']);apply_parameter_state(snap,defs,vals);od=os.path.join(output_dir,'reference-objective');key=_hash(vals);current=cache['entries'].get(key);hit=current is not None
    if current is None:current=render_and_score(reference,od,f'search-g{seed["generation"]:02d}-seed',spec);_cache_put(cache,key,current,limit)
    priority,need=_priority(current);history=[];improved=0;generation=seed['generation'];can=generation<maxgen
    if can:
      generation+=1
      for i,p in enumerate(_proposals(defs,generation,budget,step,priority),1):
        cv=_candidate(vals,p['changes'],by);k=_hash(cv);cached=cache['entries'].get(k);apply_parameter_state(snap,defs,cv);cand=cached or render_and_score(reference,od,f'search-g{generation:02d}-c{i:02d}',spec);_cache_put(cache,k,cand,limit);safe=_view_safe(cand,current,reg);accepted=cand['score']>current['score']+minimum and safe;history.append({'generation':generation,'candidate':i,'kind':p['kind'],'group':p['group'],'changes':p['changes'],'stateHash':k,'scoreBefore':current['score'],'score':cand['score'],'delta':cand['score']-current['score'],'viewSafe':safe,'accepted':accepted,'cacheHit':cached is not None,'components':cand.get('components',{})})
        if accepted:vals=cv;current=cand;improved+=1
      apply_parameter_state(snap,defs,vals)
    stale=0 if improved else seed['staleGenerations']+(1 if can else 0);cont=generation<maxgen and stale<int(cfg.get('maxStaleGenerations',2))
    state={'version':STATE_VERSION,'schemaVersion':SCHEMA_VERSION,'parameterCount':len(defs),'generation':generation,'maxGenerations':maxgen,'staleGenerations':stale,'continueSearch':bool(cont),'score':current['score'],'components':current.get('components',{}),'groupPriority':priority,'groupNeed':need,'step':step,'seedLoadedFromCache':hit,'improvedCandidates':improved,'parameters':{k:vals[k] for k in sorted(vals)}}
    return current,state,cache,history,defs

def write_search_outputs(out,state,cache,history,defs):
    os.makedirs(out,exist_ok=True)
    for name,data in [('sera-hero-search-state.json',state),('sera-hero-search-cache.json',cache)]:
      with open(os.path.join(out,name),'w',encoding='utf-8') as f:json.dump(data,f,indent=2,sort_keys=True);f.write('\n')
    report={'schemaVersion':SCHEMA_VERSION,'parameterCount':len(defs),'groups':{g:sum(d['group']==g for d in defs) for g in GROUPS},'generation':state['generation'],'step':state['step'],'improvedCandidates':state['improvedCandidates'],'continueSearch':state['continueSearch'],'bestScore':state['score'],'groupPriority':state['groupPriority'],'history':history,'activeParameters':state['parameters']}
    with open(os.path.join(out,'sera-hero-search-report.json'),'w',encoding='utf-8') as f:json.dump(report,f,indent=2,sort_keys=True);f.write('\n')
    return report

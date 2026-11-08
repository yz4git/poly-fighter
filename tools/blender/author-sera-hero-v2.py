"""SERA Hero V2: art-directed, rig-compatible sci-fi fighter costume.

Source: makehuman-backed Ara GLB. Adds authored meshes with independent
materials and transferred skin weights; preserves base skin, face morphs,
textures and the complete Mixamo skeleton. Actual geometry, not a render mock.
Coordinate helpers use glTF +Y up/+Z forward; Blender uses +Z up/-Y forward.
"""
import bpy
import math
import os
import sys
from mathutils import Vector
from mathutils.kdtree import KDTree

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(args) < 2:
    raise SystemExit("blender -b --python author-sera-hero-v2.py -- input.glb output.glb [source.blend]")
source_path, output_path = os.path.abspath(args[0]), os.path.abspath(args[1])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source_path)
body = next((o for o in bpy.context.scene.objects if o.type == "MESH" and "sera" in o.name.lower()), None)
if body is None:
    body = next((o for o in bpy.context.scene.objects if o.type == "MESH"), None)
assert body, "No source skinned human found"
arm = next((m.object for m in body.modifiers if m.type == "ARMATURE" and m.object), None)
if arm is None:
    arm = next((o for o in bpy.context.scene.objects if o.type == "ARMATURE"), None)
assert arm and len(body.vertex_groups) >= 20, "Must retain original skinned Mixamo rig"
bpy.context.view_layer.update()

# A distance-based transfer is robust to source body topology changes. Every
# outfit vertex inherits the nearest human's actual joint weight envelope.
kd = KDTree(len(body.data.vertices))
for v in body.data.vertices:
    kd.insert(body.matrix_world @ v.co, v.index)
kd.balance()
bone_names = {v.name for v in body.vertex_groups}
assert {"Head", "Hips", "Spine2", "LeftForeArm", "RightForeArm"}.issubset(bone_names)

def V(x, y, z):
    return (x, -z, y)

def mat(name, rgb, rough=.52, metal=.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*rgb, 1)
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
    m.diffuse_color = (*rgb, 1)
    return m

royal = mat("SERA cobalt enamel | armor", (.014, .095, .77), .3, .24)
royal_light = mat("SERA electric edge | piping", (.06, .44, .95), .27, .34)
graphite = mat("SERA graphite | combat weave", (.014, .018, .03), .74, .06)
charcoal = mat("SERA gunmetal | guards", (.062, .071, .095), .38, .53)
silver = mat("SERA brushed alloy | forearm", (.40, .51, .67), .32, .7)
hairmat = mat("SERA blue-black hair", (.012, .014, .025), .43, .0)
hairglint = mat("SERA hair glints", (.035, .075, .16), .37, .0)
emblem = mat("SERA signature cyan crest", (.13, .66, 1.0), .24, .34)
cloth = mat("SERA indigo tabard", (.021, .055, .42), .72, .0)

# Recolor generic cloth rather than stacking opaque clothes over purple sportswear.
# Preserve the original body textures, eyes, eyebrows and 20 facial morph targets.
for m in body.data.materials:
    if not m:
        continue
    n = m.name.lower()
    color = None
    if "outfit" in n: color = (.014, .018, .03, 1)
    elif "shoes" in n: color = (.021, .033, .07, 1)
    elif "hair" in n: color = (.013, .014, .024, 1)
    if color is None:
        continue
    copy = m.copy()
    if copy.use_nodes:
        bsdf = copy.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            socket = bsdf.inputs.get("Base Color")
            if socket:
                for link in list(socket.links):
                    copy.node_tree.links.remove(link)
                socket.default_value = color
            bsdf.inputs["Roughness"].default_value = .54 if "hair" in n else .75
    copy.diffuse_color = color
    for i, slot in enumerate(body.material_slots):
        if slot.material == m:
            body.material_slots[i].material = copy

new_objects = []
stats = {}

def build_mesh(name, verts, faces, mats, mids=None, bind="TRANSFER", smooth=False):
    mesh = bpy.data.meshes.new(name + " mesh")
    mesh.from_pydata([V(*p) for p in verts], [], faces)
    mesh.update()
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)
    for m in mats:
        mesh.materials.append(m)
    if mids:
        for i, poly in enumerate(mesh.polygons):
            poly.material_index = mids[i]
            poly.use_smooth = smooth
    else:
        for poly in mesh.polygons:
            poly.use_smooth = smooth
    groups = {}
    if bind == "HEAD":
        group = ob.vertex_groups.new(name="Head")
        for i in range(len(mesh.vertices)):
            group.add([i], 1., "REPLACE")
    else:
        source_to_target = {}
        for v in mesh.vertices:
            _, index, _ = kd.find(v.co)
            sampled = body.data.vertices[index].groups
            for g in sampled:
                source_name = body.vertex_groups[g.group].name
                if source_name not in groups:
                    groups[source_name] = ob.vertex_groups.new(name=source_name)
                groups[source_name].add([v.index], g.weight, "REPLACE")
    modifier = ob.modifiers.new("SERA skinned garment", "ARMATURE")
    modifier.object = arm
    new_objects.append(ob)
    stats[name] = len(mesh.polygons)
    return ob

def loft(name, rings, materials, choose=None, segments=32, bind="TRANSFER"):
    vertices=[]
    faces=[]
    mids=[]
    for y, rx, rz, zc in rings:
        for j in range(segments):
            t=2*math.pi*j/segments
            vertices.append((math.sin(t)*rx, y, zc+math.cos(t)*rz))
    for row in range(len(rings)-1):
        for j in range(segments):
            k=(j+1)%segments
            faces.append((row*segments+j,row*segments+k,(row+1)*segments+k,(row+1)*segments+j))
            t=2*math.pi*(j+.5)/segments
            mids.append(choose(row,t) if choose else 0)
    return build_mesh(name,vertices,faces,materials,mids,bind=bind,smooth=False)

def ribbon(name, paths, width, material, bind="TRANSFER"):
    # A tapered, two-sided hand-authored fabric/hair polygon strip.
    verts=[]
    faces=[]
    for i,(x,y,z) in enumerate(paths):
        taper = .18 + .82 * math.sin(math.pi*(i+.5)/(len(paths)))
        verts.extend([(x-width*taper/2,y,z),(x+width*taper/2,y,z)])
    for i in range(len(paths)-1):
        faces.append((2*i,2*i+1,2*i+3,2*i+2))
    obj=build_mesh(name,verts,faces,[material],bind=bind)
    # Culling both sides is important for asymmetrical trailing waist cloth.
    material.use_nodes = True
    return obj

def cylinder_between(name, a, b, radius_a, radius_b, materials, segments=12, choose=None, bind="TRANSFER"):
    start,end=Vector(a),Vector(b)
    axis=(end-start).normalized()
    tangent=axis.cross(Vector((0,0,1)))
    if tangent.length < .001:
        tangent=axis.cross(Vector((1,0,0)))
    tangent.normalize()
    bitangent=axis.cross(tangent).normalized()
    verts=[]
    for origin,r in ((start,radius_a),(end,radius_b)):
        for i in range(segments):
            t=2*math.pi*i/segments
            q=origin + r*(math.cos(t)*tangent+math.sin(t)*bitangent)
            verts.append(tuple(q))
    faces=[];mids=[]
    for j in range(segments):
        k=(j+1)%segments
        faces.append((j,k,k+segments,j+segments))
        mids.append(choose(j) if choose else 0)
    # coordinates are already GLTF x,y,z; authoring functions will convert.
    return build_mesh(name,verts,faces,materials,mids,bind=bind)

# Distinctive armor silhouette based on original SERA four-view turnaround:
# cobalt asymmetric split shell, black core, upright collar, bare midriff.
torso=[
 (1.125,.155,.099,.020),
 (1.175,.170,.114,.020),
 (1.240,.188,.128,.022),
 (1.315,.203,.131,.018),
 (1.370,.195,.107,.016),
 (1.412,.143,.085,.018),
]
loft("SERA cobalt split-breastplate",torso,[royal,graphite,royal_light],
     lambda row,t: 1 if math.cos(t)>.76 else (2 if .67<math.cos(t)<=.76 else 0))
loft("SERA standing neck guard",[
 (1.392,.115,.084,.018),(1.440,.100,.082,.022),(1.472,.084,.075,.022)
 ],[royal,graphite],lambda row,t: 1 if math.cos(t)>.45 else 0, segments=24)

# High-contrast torso chevrons; diagonal edges read even from TPS camera.
ribbon("SERA chest V left",[(-.104,1.37,.135),(-.074,1.325,.153),(-.024,1.28,.16)],.020,royal_light)
ribbon("SERA chest V right",[(.104,1.37,.135),(.074,1.325,.153),(.024,1.28,.16)],.020,royal_light)
ribbon("SERA core crest",[(0.,1.325,.171),(0.,1.27,.169)],.026,emblem)

# Segmented girdle, angular independent front tabard and asymmetrical flank.
loft("SERA articulated cobalt hip belt",[
 (.97,.176,.105,.025),(1.015,.189,.108,.022),(1.055,.168,.104,.02)
 ],[royal,charcoal],lambda row,t: 1 if abs(math.sin(t))>.83 else 0)
ribbon("SERA asymmetric front combat-tabard",
       [(-.075,1.009,.141),(-.095,.915,.163),(-.105,.820,.161),(-.112,.706,.148),(-.117,.653,.143)],
       .205,cloth)
ribbon("SERA tabard cobalt seam",
       [(-.083,.998,.151),(-.094,.89,.177),(-.106,.762,.177),(-.116,.668,.16)],
       .018,royal_light)
ribbon("SERA left side battle split",
       [(-.166,1.0,.017),(-.18,.88,.008),(-.20,.78,.014),(-.223,.70,.01)],
       .125,royal)
ribbon("SERA right hip tail",
       [(.173,.998,-.005),(.198,.878,-.011),(.219,.78,-.012),(.226,.728,-.018)],
       .098,royal)

# Two-tone bracers, silver wedge on each forearm, woven glove cuff.
for side,label in [(-1,"L"),(1,"R")]:
    a=(side*.340,1.240,.037); b=(side*.443,1.137,.037)
    cylinder_between("SERA forearm gauntlet "+label,a,b,.053,.043,[graphite,royal,silver],
                     choose=lambda i: 2 if i in (0,1,11) else (1 if i in (2,3,9,10) else 0))
    cylinder_between("SERA blue glove cuff "+label,(side*.434,1.145,.038),
                     (side*.468,1.109,.037),.046,.033,[royal],segments=10)
    # Bare shoulders remain recognizable; light armor protects outer deltoids.
    cylinder_between("SERA shoulder articulation "+label,(side*.205,1.367,.030),
                     (side*.273,1.297,.039),.062,.053,[royal,charcoal],
                     choose=lambda i: 1 if i%4==0 else 0,segments=12)

# Angular shin plating; inset black boots and bright cobalt diagonal cutlines.
for side,label in [(-1,"L"),(1,"R")]:
    x=side*.123
    cylinder_between("SERA shin armor "+label,(x,.195,.054),(x,.501,.054),
                     .063,.078,[royal,charcoal],
                     choose=lambda i: 1 if i in (6,7,8,9) else 0)
    ribbon("SERA shin insignia "+label,[(x,.47,.136),(x-side*.015,.365,.132),
            (x,.259,.117)],.026,royal_light)
    cylinder_between("SERA ankle blue clasp "+label,(x,.18,.042),
                     (x,.235,.048),.078,.065,[royal],segments=12)

# Artist-shaped high ponytail and angular asymmetrical fringe. Base hair mesh
# remains underneath, but its original flat gray-purple shader is replaced.
ribbon("SERA long left side-swept fringe",
       [(-.070,1.663,.069),(-.065,1.627,.108),(-.054,1.602,.135),
        (-.038,1.581,.149),(-.024,1.570,.149)],.057,hairmat,bind="HEAD")
ribbon("SERA high swept forehead",
       [(-.048,1.667,.078),(.004,1.663,.118),(.048,1.645,.120),
        (.069,1.609,.106)],.043,hairmat,bind="HEAD")
ribbon("SERA fringe blue-black edge",
       [(-.069,1.634,.115),(-.052,1.607,.135),(-.029,1.579,.149)],
       .009,hairglint,bind="HEAD")
cylinder_between("SERA cobalt ponytail tie",(-.002,1.648,-.078),
                 (.005,1.628,-.094),.038,.033,[royal_light],segments=12,bind="HEAD")
# The base ponytail is retained, but differentiated with authored cascading tips.
for i in range(5):
    x=(-.036+i*.018)
    ribbon("SERA hair taper "+str(i),[(x,1.607,-.087),
          (x*1.30,1.529,-.108),(x*1.6,1.443,-.114),
          (x*1.8+(.006 if i%2 else -.006),1.353,-.085)],
          .020,hairmat,bind="HEAD")

# Stronger eyes without replacing the real skinned, morphable face: fine
# stylized upper-lid graphic arcs placed near the face.
for side, label in [(-1,"L"),(1,"R")]:
    x0=side*.039
    ribbon("SERA upper eye definition "+label,
           [(x0-side*.017,1.571,.149),(x0,1.575,.150),
            (x0+side*.020,1.567,.145)],.0035,graphite,bind="HEAD")

assert sum(stats.values()) < 14000, "Accessory draw budget exceeded"
os.makedirs(os.path.dirname(output_path), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
for obj in new_objects+[body,arm]:
    obj.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.export_scene.gltf(filepath=output_path,export_format="GLB",
                           export_selected=True,export_animations=False,
                           export_morph=True,export_skinning=True,
                           export_yup=True)
if len(args)>2:
    source_blend=os.path.abspath(args[2])
    os.makedirs(os.path.dirname(source_blend),exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=source_blend)
assert os.path.getsize(output_path)>1000000, "Export unexpectedly small"
print("SERA_HERO_V2_ART_READY",os.path.getsize(output_path),"new costume faces",sum(stats.values()),stats)

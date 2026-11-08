"""SERA V3 — new cohesive, skinned, art-directed 3D fighter.

NOT a continuation of V2 box/cylinder overlays. Starts from the untouched,
licensed Ara/MakeHuman skinned base; custom facial sculpt and cloth surface,
conformal armor and designed tapered hairstyle. Keeps original 20 morphs,
UV skin, eyes, bone hierarchy and hands/feet for existing combat motions.

Input: generated Ara GLB (source), output: ready-to-validate standalone GLB.
Usage: blender -b -P tools/blender/author-sera-v3.py -- base.glb sera-v3.glb v3.blend
"""
import bpy
import math
import os
import sys
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(args) < 2:
    raise SystemExit("Usage: ... -- source.glb output.glb [editable.blend]")
src, dest = map(os.path.abspath, args[:2])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

body = next((ob for ob in bpy.context.scene.objects if ob.type == "MESH" and "sera" in ob.name.lower()), None)
if not body:
    body = next((ob for ob in bpy.context.scene.objects if ob.type == "MESH"), None)
assert body and body.data.polygons, "Ara skinned human was not imported"
armature = next((mod.object for mod in body.modifiers if mod.type == "ARMATURE" and mod.object), None)
assert armature, "Imported human has no skeleton"
assert {"Hips", "Head", "Spine2", "LeftArm", "RightArm", "LeftUpLeg"}.issubset(
    {group.name for group in body.vertex_groups}
), "Character rig is not game-compatible"

# Imported Ara mesh coordinates are Blender x/-depth/up and correspond to
# glTF x/height/depth. Keep armature and its original bone inverses unchanged.
def to_blender(p):
    return Vector((p[0], -p[2], p[1]))

def to_gltf(p):
    return Vector((p.x, p.z, -p.y))

def eased(a, b, x):
    t = max(0.0, min(1.0, (x-a)/(b-a)))
    return t*t*(3.0-2.0*t)

def gauss(x, center, width):
    return math.exp(-((x-center)/width)**2)

def new_mat(name, color, rough=.6, metal=.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    shader = m.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = rough
    shader.inputs["Metallic"].default_value = metal
    return m

# Art palette: Japanese-inspired cobalt/black sci-fi martial arts uniform,
# soft conductive carbon textile rather than separate floating armor blocks.
cobalt = new_mat("SERA V3 - enamel cobalt | tailored textile",
                 (.019, .061, .31), .45, .06)
lapis = new_mat("SERA V3 - lapis shoulder seam", (.031, .14, .62), .42, .12)
shadow = new_mat("SERA V3 - matte graphite", (.010, .015, .028), .85, .02)
carbon = new_mat("SERA V3 - flexible carbon armor", (.034, .046, .070), .53, .15)
steel = new_mat("SERA V3 - graphite steel", (.11, .155, .24), .34, .56)
electric = new_mat("SERA V3 - cold blue embroidery", (.075, .31, .76), .42, .14)
cloth = new_mat("SERA V3 - asymmetric indigo cloth", (.011, .044, .20), .81, .0)
hair_black = new_mat("SERA V3 - ink black sculpted hair", (.007, .009, .015), .43, .01)
hair_sheen = new_mat("SERA V3 - blue-black hair specular", (.013, .027, .059), .39, .03)

# Fabric micro-weave is an actual embedded GLB texture, not a procedural
# Blender-only shader which would silently disappear at runtime.
def add_weave(material, base):
    image = bpy.data.images.new(material.name + " micro-weave PBR", width=256, height=256, alpha=True)
    rgba=[]
    for y in range(256):
        for x in range(256):
            warp = .085 * (1 if x%7 < 3 else -1)
            weft = .066 * (1 if y%9 < 4 else -1)
            micro = .035*math.sin(x*0.77 + y*0.91)*math.cos(y*1.1)
            strength=1.0+warp+weft+micro
            rgba.extend((min(1.,base[0]*strength),
                         min(1.,base[1]*strength),
                         min(1.,base[2]*strength),1.0))
    image.pixels.foreach_set(rgba)
    image.pack()
    image.colorspace_settings.name = "sRGB"
    image.filepath_raw="//" + material.name.replace(" ","_")+".png"
    shader=material.node_tree.nodes.get("Principled BSDF")
    texture=material.node_tree.nodes.new("ShaderNodeTexImage")
    texture.name="SERA V3 actual packed textile"
    texture.image=image
    texture.interpolation="Linear"
    texture.extension="REPEAT"
    material.node_tree.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    return image

add_weave(carbon, (.038, .050, .076))
add_weave(cobalt, (.017, .050, .29))
add_weave(cloth, (.013, .034, .18))

# Sculpt the ORIGINAL mesh and each morph basis consistently. Only a subtle
# stylized anatomical revision is safe without hand-painted identity artwork.
# More angular jawline, a firmer cheek, less round mouth/chin and level eyes.
shapes = body.data.shape_keys.key_blocks[:] if body.data.shape_keys else []
delta_by_vertex={}
for vertex in body.data.vertices:
    x,y,z = to_gltf(vertex.co)
    # Head occupies 1.44..1.67 m. Smooth masks avoid neck seams.
    head_mask=eased(1.458,1.501,y)*(1-eased(1.635,1.685,y))
    if head_mask < .00001:
        continue
    jaw = gauss(y, 1.516, .038)
    cheeks=gauss(y,1.554,.026)*gauss(abs(x),.052,.039)
    brow=gauss(y,1.578,.014)*gauss(abs(x),.042,.028)
    chin=gauss(y,1.494,.021)*gauss(abs(x),.017,.025)
    # Positive z faces the camera; avoid moving inside of skull.
    front=eased(.04,.105,z)
    dx=-x*(.092*jaw+.018*cheeks)*head_mask
    dy=(.004*cheeks-.0035*chin+.001*brow)*front*head_mask
    dz=(.0047*cheeks+.004*chin+.0015*brow)*front*head_mask
    delta=Vector((dx,-dz,dy))
    if delta.length>1e-7:
        delta_by_vertex[vertex.index]=delta
for idx,delta in delta_by_vertex.items():
    if shapes:
        for key in shapes:
            key.data[idx].co+=delta
    else:
        body.data.vertices[idx].co+=delta
body.data.update()
assert len(delta_by_vertex)>1000, "Face sculpt did not touch expected facial geometry"

# Remove purple/gray sport styling at the SOURCE MESH level. The top, seams,
# compression leggings and boots remain exactly conformal and skinned.
idx_outfit=next((i for i,m in enumerate(body.data.materials) if m and "outfit" in m.name.lower()),None)
idx_shoes=next((i for i,m in enumerate(body.data.materials) if m and "shoes" in m.name.lower()),None)
idx_hair=next((i for i,m in enumerate(body.data.materials) if m and "hair" in m.name.lower()),None)
assert idx_outfit is not None and idx_hair is not None
materials = [shadow,carbon,cobalt,lapis,electric,steel,cloth,hair_black]
slots={}
for mat in materials:
    slots[mat.name]=len(body.data.materials)
    body.data.materials.append(mat)
old_outfit_count=0
for polygon in body.data.polygons:
    if polygon.material_index==idx_outfit:
        old_outfit_count+=1
        mid=to_gltf(sum((body.data.vertices[n].co for n in polygon.vertices),Vector())/len(polygon.vertices))
        x,y,z=mid
        # Fitted sculpt with genuine source garment topology.
        if y>1.11:
            if abs(x)<.055 and z>.09:
                material=carbon
            elif y>1.32 and abs(x)>.13:
                material=lapis
            elif z<-.02:
                material=cobalt
            else:
                material=cobalt
        elif y>.94:
            material=shadow if abs(x)<.125 else cobalt
        else:
            # The original garment's own leg geometry becomes the uniform.
            if (.34<y<.58 and z>.03) or (abs(x)>.112 and .20<y<.93):
                material=carbon
            else:
                material=shadow
        polygon.material_index=slots[material.name]
    elif polygon.material_index==idx_shoes:
        polygon.material_index=slots[carbon.name]
    elif polygon.material_index==idx_hair:
        polygon.material_index=slots[hair_black.name]
assert old_outfit_count>500, "Could not find conformal Ara clothing"

# Nearest real skinning weights, not fake rigid parent attachment.
bpy.context.view_layer.update()
kd=KDTree(len(body.data.vertices))
for v in body.data.vertices:
    kd.insert(body.matrix_world @ v.co, v.index)
kd.balance()

authored=[]
stats={"face_vertices_sculpted":len(delta_by_vertex),"source_outfit_faces_restyled":old_outfit_count}

def create_skinned(name, points, polygons, mats, material_ids=None, direct_source=None, uv=None,
                   head_only=False):
    mesh=bpy.data.meshes.new(name+" · authored geometry")
    mesh.from_pydata([tuple(p) for p in points], [], polygons)
    mesh.update()
    for m in mats:mesh.materials.append(m)
    for i,p in enumerate(mesh.polygons):
        p.material_index=material_ids[i] if material_ids else 0
        p.use_smooth=True
    if uv is not None:
        atlas=mesh.uv_layers.new(name="UVMap")
        for poly in mesh.polygons:
            for loop_index in poly.loop_indices:
                atlas.data[loop_index].uv=uv[mesh.loops[loop_index].vertex_index]
    ob=bpy.data.objects.new(name,mesh)
    bpy.context.collection.objects.link(ob)
    if head_only:
        vg=ob.vertex_groups.new(name="Head")
        vg.add(list(range(len(mesh.vertices))),1.0,"REPLACE")
    else:
        cache={}
        for vert in mesh.vertices:
            if direct_source is not None:
                base=body.data.vertices[direct_source[vert.index]]
            else:
                near=kd.find(body.matrix_world @ vert.co)
                base=body.data.vertices[near[1]]
            for item in base.groups:
                bone=body.vertex_groups[item.group].name
                if bone not in cache:
                    cache[bone]=ob.vertex_groups.new(name=bone)
                cache[bone].add([vert.index],item.weight,"REPLACE")
    mod=ob.modifiers.new("Use same 65-joint game rig","ARMATURE")
    mod.object=armature
    authored.append(ob)
    stats[name]=len(mesh.polygons)
    return ob

def surface_skin(name,predicate,mat,offset=.0035):
    # Duplicate selected humanoid triangles and copy EXACT corresponding
    # weights. This prevents floating primitive cylinders and sharp scale
    # errors at elbow/knee; every garment follows source anatomy.
    indices=[]
    for poly in body.data.polygons:
        center=to_gltf(poly.center)
        if predicate(center,poly):
            indices.append(poly.index)
    if len(indices)<3:
        raise RuntimeError("Surface garment segment missing "+name+" polys="+str(len(indices)))
    origs={}
    points=[]
    faces=[]
    for pi in indices:
        poly=body.data.polygons[pi]
        result=[]
        for vi in poly.vertices:
            if vi not in origs:
                origs[vi]=len(points)
                vertex=body.data.vertices[vi]
                points.append(vertex.co+vertex.normal*offset)
            result.append(origs[vi])
        faces.append(tuple(result))
    direct=list(origs.keys())
    return create_skinned(name,points,faces,[mat],direct_source=direct)

# Visually cohesive segmented armor CUT FROM BODY SURFACES rather than
# approximate overlapping cylinders. Extremely thin, roughness-defined panels.
for sign,label in ((-1,"L"),(1,"R")):
    surface_skin("SERA V3 "+label+" fitted shoulder cap",
       lambda q,p: sign*q.x>.18 and sign*q.x<.278 and 1.313<q.y<1.405
       and q.z>-.028 and p.material_index not in (idx_hair,),steel,.004)
    surface_skin("SERA V3 "+label+" fitted forearm shell",
       lambda q,p: sign*q.x>.305 and sign*q.x<.444 and 1.105<q.y<1.269
       and q.z>.014 and p.material_index not in (idx_hair,),carbon,.004)
    surface_skin("SERA V3 "+label+" integrated shin inset",
       lambda q,p: sign*q.x>.070 and sign*q.x<.223 and .245<q.y<.546
       and q.z>.055 and p.material_index not in (idx_hair,),steel,.003)

def curved_path(name,gl_points,radii,material,head_only=False,facets=8):
    # Sample tapered spline as round woven rope/groomed hair, not flat cards.
    controls=[to_blender(p) for p in gl_points]
    centerline=[]
    nsteps=(len(controls)-1)*4+1
    for j in range(nsteps):
        t=j/(nsteps-1)*(len(controls)-1)
        seg=min(len(controls)-2,int(t))
        u=t-seg
        p0=controls[max(0,seg-1)]
        p1=controls[seg]
        p2=controls[seg+1]
        p3=controls[min(len(controls)-1,seg+2)]
        point=.5*((2*p1)+(-p0+p2)*u+(2*p0-5*p1+4*p2-p3)*u*u+
                    (-p0+3*p1-3*p2+p3)*u*u*u)
        centerline.append(point)
    vertices=[]
    faces=[]
    for j,center in enumerate(centerline):
        tangent=(centerline[min(j+1,len(centerline)-1)]-
                 centerline[max(0,j-1)])
        if tangent.length < 1e-7:tangent=Vector((0,0,1))
        tangent.normalize()
        u=tangent.cross(Vector((0,0,1)))
        if u.length<.01:u=tangent.cross(Vector((1,0,0)))
        u.normalize();v=tangent.cross(u).normalized()
        p=j/(len(centerline)-1)
        radius=(radii[0]*(1-p)+radii[1]*p)*(.97+ .03*math.cos(p*math.pi))
        for k in range(facets):
            angle=math.pi*2*k/facets
            vertices.append(center+radius*(u*math.cos(angle)+v*math.sin(angle)))
    for j in range(len(centerline)-1):
        for k in range(facets):
            nxt=(k+1)%facets
            faces.append((j*facets+k,j*facets+nxt,(j+1)*facets+nxt,(j+1)*facets+k))
    return create_skinned(name,vertices,faces,[material],head_only=head_only)

# Fine stitched surface traces; more subtle than V2 floating neon rods.
for side,label in ((-1,"left"),(1,"right")):
    curved_path("SERA V3 "+label+" shoulder welt",[
        (side*.185,1.400,.038),(side*.231,1.358,.081),
        (side*.264,1.307,.060)],(.0022,.0012),electric)
    curved_path("SERA V3 "+label+" torso contour",[
        (side*.142,1.351,.111),(side*.117,1.306,.142),
        (side*.065,1.268,.164)],(.0024,.0015),electric)
    curved_path("SERA V3 "+label+" leg stripe",[
        (side*.137,.790,.08),(side*.141,.660,.085),
        (side*.132,.520,.091),(side*.125,.394,.082)],(.002,.001),lapis)

def pleated_tabard(name,x0,depth,width,length,mat,decor):
    # Tailored textile curtain with curved cut, fold variation and curved hem.
    # Waist follows hips; lower vertices inherit the nearby leg skinning.
    rows=15;cols=12
    verts=[];uv=[];quads=[];materials=[]
    for i in range(rows):
        t=i/(rows-1)
        y=1.013-t*length
        for j in range(cols):
            u=j/(cols-1)
            flare=1+.17*t
            x=x0+(u-.5)*width*flare+depth*.16*t*t
            z=.107+.042*t + .008*math.sin(u*math.pi*2)*t + .01*(1-u)*t*t
            verts.append(to_blender((x,y,z)))
            uv.append((u,t))
    for i in range(rows-1):
        for j in range(cols-1):
            q=i*cols+j
            quads.append((q,q+1,q+cols+1,q+cols))
            materials.append(1 if j in (0,cols-2) or (j==6 and i>6) else 0)
    return create_skinned(name,verts,quads,[mat,decor],material_ids=materials,uv=uv)

pleated_tabard("SERA V3 bespoke asymmetric battle tabard",-.086,1,.158,.298,cloth,lapis)
# Angular side scarf with a much smaller, body-hugging cut than V2.
def side_tabard(side,label):
    rows=13;cols=8
    verts=[];quads=[];mids=[];uv=[]
    for i in range(rows):
        t=i/(rows-1)
        for j in range(cols):
            u=j/(cols-1)
            x=side*(.152+.022*t)
            y=1.003-.235*t
            z=.012 + .07*(u-.5) + .025*t*t
            verts.append(to_blender((x,y,z)))
            uv.append((u,t))
    for i in range(rows-1):
        for j in range(cols-1):
            k=i*cols+j
            quads.append((k,k+1,k+cols+1,k+cols))
            mids.append(1 if j==0 else 0)
    create_skinned("SERA V3 "+label+" sculpted flank split",verts,quads,
                   [cloth,lapis],material_ids=mids,uv=uv)
side_tabard(-1,"left")
side_tabard(1,"right")

# Hair mass and silhouette are original sculpted groomed bundles with actual
# round cross-sections, not V2's polygon strips.
# V3 preserves the base UV hair cap but adds specific front identity.
for i in range(11):
    u=(i-5)/5
    x=-.071+ i*.0135
    height=1.672-.009*(1-abs(u))
    # SERA's eye-brow fringe sweeps from her left to her right.
    curved_path("SERA V3 temple/groom front "+str(i),[
        (x,height,.074),
        (x+.010,1.645,.113),
        (x+.022,1.615,.133),
        (x+.023,1.599-(.019 if i<4 else .006),.139)
    ],(.0095,.0004),hair_black,head_only=True,facets=7)
# Softer physical overlap to the left temple (eye region kept visible).
for i in range(6):
    x=-.076+i*.009
    curved_path("SERA V3 side fringe "+str(i),[
        (x,1.654,.080),(x-.007,1.618,.112),
        (x-.003,1.576,.119)],(.006,.0006),hair_sheen if i==2 else hair_black,head_only=True,facets=6)
# Hair tie around the high ponytail, built from several little arcs.
for k in range(12):
    a=2*math.pi*k/12
    curved_path("SERA V3 blue pony tie "+str(k),[
        (.020*math.cos(a),1.651,-.080+.020*math.sin(a)),
        (.021*math.cos(a),1.631,-.081+.021*math.sin(a))],
        (.0021,.0021),lapis,head_only=True,facets=5)
# High ponytail groom: individual sculpted tapered locks along a soft braid.
for i in range(15):
    a=(i-7)/7
    curved_path("SERA V3 swept ponytail "+str(i),[
        (.025*a,1.644,-.099),
        (.031*a,1.579,-.136),
        (.038*a+.01*math.sin(i*2),1.485,-.148),
        (.042*a+.008*math.cos(i),1.370+(i%4)*.018,-.111)
    ],(.0065,.0003),hair_sheen if i%5==0 else hair_black,head_only=True,facets=7)

# Keep one world-space armature; independently animated head/face can still
# inherit the base's 20 blend shapes. No V2 rigid armor meshes are imported.
total_faces=sum(stats[name] for name in stats if name not in
                ("face_vertices_sculpted","source_outfit_faces_restyled"))
assert total_faces<10000, "Overbudget authored geometry "+str(total_faces)
assert len(authored)>=25, "Expected complete authored outfit/groom"
assert all(a.modifiers.get("Use same 65-joint game rig") for a in authored)
os.makedirs(os.path.dirname(dest),exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
for ob in authored+[body,armature]:ob.select_set(True)
bpy.context.view_layer.objects.active=body
bpy.ops.export_scene.gltf(
    filepath=dest,export_format="GLB",use_selection=True,
    export_animations=False,export_morph=True,export_skins=True,
    export_yup=True)
if len(args)>2:
    blend_path=os.path.abspath(args[2])
    os.makedirs(os.path.dirname(blend_path),exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
assert os.path.isfile(dest) and os.path.getsize(dest)>2_000_000
print("SERA_V3_AUTHORED_SUCCESS",{"bytes":os.path.getsize(dest),
                              "new_meshes":len(authored),"art_facing_triangles":total_faces,
                              "facial_sculpt_vertices":len(delta_by_vertex)})

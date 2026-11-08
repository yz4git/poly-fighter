"""Render actual SERA V3 GLB: four turns + face and costume detail."""
import bpy
import os
import sys
from mathutils import Vector

args=sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
if len(args)!=2:
    raise SystemExit("Usage: blender -b -P render-sera-v3-review.py -- hero-v3.glb image-dir")
source,output=args
os.makedirs(output,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(source))
objects=[o for o in bpy.context.scene.objects if o.type=="MESH"]
if not objects:raise RuntimeError("GLB contains no real render meshes")
bpy.context.view_layer.update()
lo=[min((o.matrix_world@Vector(c))[i] for o in objects for c in o.bound_box) for i in range(3)]
hi=[max((o.matrix_world@Vector(c))[i] for o in objects for c in o.bound_box) for i in range(3)]
mid=Vector([(a+b)/2 for a,b in zip(lo,hi)])
height=hi[2]-lo[2]
if height<.5:raise RuntimeError("Invalid character bounds")
scene=bpy.context.scene
for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "CYCLES"):
    try:
        scene.render.engine=engine
        break
    except TypeError:
        continue
else:
    raise RuntimeError("No available Blender studio renderer")
if scene.render.engine=="CYCLES":
    scene.cycles.samples=16
scene.render.resolution_x=780
scene.render.resolution_y=960
scene.render.resolution_percentage=100
scene.render.image_settings.file_format="PNG"
scene.render.film_transparent=False
scene.render.image_settings.color_mode="RGBA"
scene.view_settings.view_transform="AgX"
scene.view_settings.exposure=-.32
world=bpy.data.worlds.new("SERA V3 studio environment")
world.use_nodes=True
world.node_tree.nodes["Background"].inputs["Color"].default_value=(.058,.076,.115,1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value=.7
scene.world=world
def area(name,rel,power,scale,color):
    light=bpy.data.lights.new(name,"AREA")
    light.energy=power
    light.shape="DISK"
    light.size=scale
    light.color=color
    ob=bpy.data.objects.new(name,light)
    scene.collection.objects.link(ob)
    ob.location=mid+Vector(rel)*height
    ob.rotation_euler=(mid-ob.location).to_track_quat("-Z","Y").to_euler()
area("broad white key",(-.65,-.95,1.3),750,2.7,(1,.98,.95))
area("blue cool rim",(.8,.7,1.06),1150,2.3,(.70,.82,1))
area("soft fill",(.85,-.35,.6),375,3.3,(.91,.94,1))
camera_data=bpy.data.cameras.new("Orthographic asset audit")
camera=bpy.data.objects.new("Orthographic asset audit",camera_data)
scene.collection.objects.link(camera)
scene.camera=camera
camera_data.type="ORTHO"
views=[
 ("front",(0,-1,.075),mid,height*1.18),
 ("three-quarter",(.72,-.72,.075),mid,height*1.18),
 ("profile",(1,0,.075),mid,height*1.18),
 ("back",(0,1,.075),mid,height*1.18),
 ("face",(.19,-1,.08),Vector((mid.x,mid.y,lo[2]+height*.91)),height*.30),
 ("costume",(.36,-1,.08),Vector((mid.x,mid.y,lo[2]+height*.67)),height*.56),
]
for label,relative,focus,frame in views:
    camera_data.ortho_scale=frame
    camera.location=focus+Vector(relative).normalized()*height*2.6
    camera.rotation_euler=(focus-camera.location).to_track_quat("-Z","Y").to_euler()
    scene.render.filepath=os.path.abspath(os.path.join(output,"sera-v3-"+label+".png"))
    bpy.ops.render.render(write_still=True)
    if not os.path.isfile(scene.render.filepath):raise RuntimeError("Missing real image "+label)
print("SERA_V3_SIX_REAL_RENDERS_COMPLETE",output)

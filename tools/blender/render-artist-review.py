"""Six REAL evidence renders of submitted SERA candidate.glb, no mockups.
Run headless: blender -b --disable-autoexec -P render-artist-review.py -- input.glb output_dir
"""
import bpy, os, sys
from mathutils import Vector

args=sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
if len(args)!=2: raise SystemExit("Supply candidate.glb output-dir")
src,folder=args
os.makedirs(folder,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(src))
objects=[o for o in bpy.context.scene.objects if o.type=="MESH"]
if not objects: raise RuntimeError("No actual meshes were imported")
bpy.context.view_layer.update()
mins=[min((o.matrix_world @ Vector(c))[i] for o in objects for c in o.bound_box) for i in range(3)]
maxs=[max((o.matrix_world @ Vector(c))[i] for o in objects for c in o.bound_box) for i in range(3)]
center=Vector([(a+b)/2 for a,b in zip(mins,maxs)])
height=maxs[2]-mins[2]
if height<.35: raise RuntimeError("Artist GLB has invalid character scale")
scene=bpy.context.scene
engine_found=False
for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "CYCLES"):
    try:
        scene.render.engine=engine
        engine_found=True
        break
    except TypeError: pass
if not engine_found: raise RuntimeError("No available studio render engine")
if scene.render.engine=="CYCLES": scene.cycles.samples=18
scene.render.resolution_x=768
scene.render.resolution_y=960
scene.render.resolution_percentage=100
scene.render.image_settings.file_format="PNG"
scene.render.film_transparent=False
scene.view_settings.view_transform="AgX"
scene.view_settings.exposure=-.26
scene.world=bpy.data.worlds.new("Artist proof background")
scene.world.use_nodes=True
bg=scene.world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value=(.056,.072,.114,1)
bg.inputs["Strength"].default_value=.8

def area(name, direction, strength, width, color):
    dat=bpy.data.lights.new(name,"AREA")
    dat.energy=strength
    dat.size=width
    dat.color=color
    obj=bpy.data.objects.new(name,dat)
    scene.collection.objects.link(obj)
    obj.location=center+Vector(direction)*height
    obj.rotation_euler=(center-obj.location).to_track_quat("-Z","Y").to_euler()
area("neutral key",(-.55,-.9,1.22),730,2.8,(1,.99,.95))
area("blue edge",(.7,.6,1.05),770,2.5,(.77,.86,1))
area("wide fill",(.8,-.15,.65),300,3.4,(1,1,1))
camdata=bpy.data.cameras.new("Fixed art approval angles")
cam=bpy.data.objects.new("Fixed art approval angles",camdata)
scene.collection.objects.link(cam)
scene.camera=cam
camdata.type="ORTHO"
views={
    "front":((0,-1,.08),center,height*1.18),
    "three-quarter":((.70,-.72,.08),center,height*1.18),
    "profile":((1,0,.08),center,height*1.18),
    "back":((0,1,.08),center,height*1.18),
    "face":((.20,-1,.08),Vector((center.x,center.y,mins[2]+height*.90)),height*.30),
    "costume":((.38,-1,.08),Vector((center.x,center.y,mins[2]+height*.69)),height*.56),
}
for name,(direction,focus,frame) in views.items():
    camdata.ortho_scale=frame
    cam.location=focus+Vector(direction).normalized()*height*2.9
    cam.rotation_euler=(focus-cam.location).to_track_quat("-Z","Y").to_euler()
    scene.render.filepath=os.path.abspath(os.path.join(folder,"sera-artist-"+name+".png"))
    bpy.ops.render.render(write_still=True)
    if not os.path.isfile(scene.render.filepath):
        raise RuntimeError("Real image not created for "+name)
print("ARTIST_SIX_VIEW_PROOF_COMPLETE",folder)

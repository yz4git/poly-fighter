"""Render actual imported GLB from four studio-camera angles."""
import bpy
import os
import sys
from mathutils import Vector

a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(a) != 2:
    raise SystemExit("Usage: blender -b -P render-sera-hero-pbr.py -- input.glb output_folder")
source, directory = a
os.makedirs(directory, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(source))
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes:
    raise RuntimeError("No geometry in actual GLB")
bpy.context.view_layer.update()
mins = [min((o.matrix_world @ Vector(v))[k] for o in meshes for v in o.bound_box) for k in range(3)]
maxs = [max((o.matrix_world @ Vector(v))[k] for o in meshes for v in o.bound_box) for k in range(3)]
center = Vector([(m + n) / 2 for m,n in zip(mins,maxs)])
height = maxs[2] - mins[2]
if height < .1:
    raise RuntimeError("Invalid GLB bounds")
scene = bpy.context.scene
for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
    try:
        scene.render.engine = engine
        break
    except TypeError:
        pass
else:
    raise RuntimeError("No suitable Blender render engine")
if scene.render.engine == "CYCLES":
    scene.cycles.samples = 16
scene.render.resolution_x = 720
scene.render.resolution_y = 960
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.world = bpy.data.worlds.new("Studio")
scene.world.use_nodes = True
bg = scene.world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (.085, .1, .15, 1)
bg.inputs["Strength"].default_value = .72

def light(name, offset, energy, size):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy, ld.size = energy, size
    obj = bpy.data.objects.new(name, ld)
    scene.collection.objects.link(obj)
    obj.location = center + Vector(offset) * height
    obj.rotation_euler = (center - obj.location).to_track_quat("-Z", "Y").to_euler()

light("Key", (-.75,-1.1,1.2), 950, 3)
light("Fill", (.85,.2,.5), 530, 3)
light("Rim", (.35,1,1.1), 1100, 2.5)
camera_data = bpy.data.cameras.new("Review camera")
camera = bpy.data.objects.new("Review camera", camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
camera_data.type = "ORTHO"
camera_data.ortho_scale = height * 1.26
views = {
    "front": (0,-1,.1),
    "three-quarter": (.72,-.72,.1),
    "side": (1,0,.1),
    "back": (0,1,.1)
}
for name, offset in views.items():
    camera.location = center + Vector(offset).normalized() * height * 2.8
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z","Y").to_euler()
    scene.render.filepath = os.path.abspath(os.path.join(directory,"sera-" + name + ".png"))
    bpy.ops.render.render(write_still=True)
    if not os.path.isfile(scene.render.filepath):
        raise RuntimeError("Could not render " + name)
print("Four real character renders complete")

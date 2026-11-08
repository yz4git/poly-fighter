"""Export already-authored Blender character; do not synthesize body/gear.
blender -b --disable-autoexec --python tools/blender/export-artist-hero.py -- artist.blend candidate.glb
"""
import bpy, os, sys
args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(args) != 2: raise SystemExit("Input artist.blend and output candidate.glb required")
src, out = map(os.path.abspath, args)
if not src.endswith(".blend") or not os.path.isfile(src):
    raise RuntimeError("Missing actual artist-produced Blender .blend")
bpy.ops.wm.open_mainfile(filepath=src, load_ui=False)
rigs = [o for o in bpy.data.objects if o.type == "ARMATURE"]
if len(rigs) != 1: raise RuntimeError("Exactly one exported game deform armature required")
rig = rigs[0]
meshes = [o for o in bpy.data.objects if o.type == "MESH"
          and any(m.type == "ARMATURE" and m.object == rig for m in o.modifiers)]
if not meshes or sum(len(x.data.polygons) for x in meshes) < 12000:
    raise RuntimeError("Missing artist-built/skinned full character geometry")
names = {b.name.split(":")[-1] for b in rig.data.bones}
for name in ("Hips", "Head", "LeftArm", "RightArm", "LeftUpLeg", "RightUpLeg"):
    if name not in names: raise RuntimeError("Retarget deform rig to game naming: missing "+name)
images = set()
for mesh in meshes:
    if not mesh.data.uv_layers: raise RuntimeError("Missing UV map on "+mesh.name)
    for mat in mesh.data.materials:
        if not mat or not mat.use_nodes: continue
        for node in mat.node_tree.nodes:
            if node.type == "TEX_IMAGE" and node.image: images.add(node.image)
if len(images) < 2: raise RuntimeError("Expected real PBR textures for skin, hair and fabric")
for im in images:
    if im.source == "FILE" and not im.packed_file:
        if im.has_data: im.pack()
        else: raise RuntimeError("Missing unpacked texture "+im.name)
for obj in bpy.data.objects: obj.select_set(False)
for obj in meshes + [rig]:
    obj.hide_set(False)
    obj.select_set(True)
bpy.context.view_layer.objects.active = rig
os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=out, export_format="GLB", use_selection=True,
    export_animations=False, export_skins=True,
    export_morph=True, export_yup=True, export_apply=False)
if not os.path.isfile(out) or os.path.getsize(out) < 100000:
    raise RuntimeError("GLB export did not produce valid-sized model")
print("ARTIST_ASSET_EXPORTED",{
    "weighted_parts":len(meshes),
    "triangulation_source_faces":sum(len(x.data.polygons) for x in meshes),
    "embedded_images":len(images),"bytes":os.path.getsize(out)})

"""External finished model to PRIVATE BENCHMARK artifact, never SERA runtime.

Only handles professional character model import, material preservation, and
existing rig geometry. It does not invent faces, clothing, armor or hair.

Usage: blender -b --factory-startup --python import-professional-reference.py
       -- source.fbx source.png benchmark.glb metadata.json
"""
import bpy
import json
import os
import sys
from mathutils import Vector

a=sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
if len(a)!=4: raise SystemExit("source.fbx source.png output.glb metadata.json required")
source,texture,out,report=map(os.path.abspath,a)
if not os.path.isfile(source) or not os.path.isfile(texture):
    raise RuntimeError("Missing pinned CC0 comparison source/texture")
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=source)
meshes=[obj for obj in bpy.context.scene.objects if obj.type=="MESH"]
rigs=[obj for obj in bpy.context.scene.objects if obj.type=="ARMATURE"]
if not meshes or not rigs:
    raise RuntimeError("Professional source did not supply a skinned human rig")

# Preserve actual author-made geometry and deformation. No procedural edits.
skinned=[obj for obj in meshes if any(mod.type=="ARMATURE" for mod in obj.modifiers)]
if not skinned:
    raise RuntimeError("The supplied artist model has no skinned geometry")
faces=sum(len(obj.data.polygons) for obj in skinned)
if faces<20000:
    raise RuntimeError("Reference asset unexpectedly small/low detail: "+str(faces))

im=bpy.data.images.load(texture,check_existing=True)
if im.size[0]<1024:
    raise RuntimeError("Reference diffuse/atlas file damaged")
linked=0
for obj in skinned:
    if not obj.data.uv_layers:
        raise RuntimeError("Reference mesh has no UVs: "+obj.name)
    for mat in obj.data.materials:
        if mat is None:continue
        mat.use_nodes=True
        bsdf=mat.node_tree.nodes.get("Principled BSDF")
        existing=[n for n in mat.node_tree.nodes if n.type=="TEX_IMAGE" and n.image]
        if bsdf and not existing:
            node=mat.node_tree.nodes.new("ShaderNodeTexImage")
            node.image=im
            mat.node_tree.links.new(node.outputs["Color"],bsdf.inputs["Base Color"])
            linked+=1
        if bsdf: bsdf.inputs["Roughness"].default_value=.66
im.pack()

for obj in bpy.context.scene.objects:obj.select_set(False)
for obj in skinned+rigs:
    obj.select_set(True)
    obj.hide_set(False)
bpy.context.view_layer.objects.active=rigs[0]
os.makedirs(os.path.dirname(out),exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=out, export_format="GLB", use_selection=True,
    export_animations=False, export_skins=True,
    export_morph=True, export_yup=True)
if not os.path.isfile(out) or os.path.getsize(out)<1000000:
    raise RuntimeError("Failed to export genuine reference model")
names={n.name for rig in rigs for n in rig.data.bones}
blendshapes=max((len(obj.data.shape_keys.key_blocks)-1
                 if obj.data.shape_keys else 0 for obj in skinned),default=0)
stats={
  "reference":"Attractor Mechanic",
  "source":"s0ck3t/VideoIntoBlenderModel pinned c1f1fa8f01524d60197c4d65306349e266d339cb",
  "claimed_license_in_upstream_manifest":"CC0-1.0 (confirm provenance before production)",
  "role":"PROFESSIONAL_REFERENCE_NOT_SERA_NOT_PRODUCTION_APPROVED",
  "source_polygon_faces":faces,
  "skinned_meshed":len(skinned),
  "armatures":len(rigs),
  "named_bones":len(names),
  "blendshape_targets":blendshapes,
  "atlas_dimensions":list(im.size),
  "materials_reconnected_to_atlas":linked,
  "output_glb_bytes":os.path.getsize(out),
}
os.makedirs(os.path.dirname(report),exist_ok=True)
with open(report,"w",encoding="utf8") as f:json.dump(stats,f,indent=2)
print("REAL_PROFESSIONAL_CC0_REFERENCE_IMPORTED",json.dumps(stats))

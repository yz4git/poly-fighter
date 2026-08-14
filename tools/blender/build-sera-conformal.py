import argparse
import importlib.util
import json
import os
import sys

import bpy
from sera_blender_helpers import clean_scene, material, render_views, save_version, setup_scene
from sera_conformal_body import apply as apply_body
from sera_identity_parts import apply as apply_identity
from sera_identity_tuning import apply as tune_identity


def parse_args():
    av = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--source-gltf', required=True)
    return parser.parse_args(av)


def load_source_helpers():
    path = os.path.join(os.path.dirname(__file__), 'build-sera-quaternius.py')
    spec = importlib.util.spec_from_file_location('sera_source_base', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def style_face(objects):
    eye = material('SERA_Eye', 0x211A18, 0.72)
    brow = material('SERA_Brow', 0x17151A, 0.84)
    for obj in objects:
        if obj.type != 'MESH' or obj.name == 'Superhero_Female':
            continue
        obj.data.materials.clear()
        obj.data.materials.append(brow if 'brow' in obj.name.lower() else eye)
        for poly in obj.data.polygons:
            poly.use_smooth = False


def bake_runtime_colors(runtime):
    """Collapse the Blender material palette into one vertex-color primitive."""
    mesh = runtime.data
    colors = mesh.color_attributes.get('SERA_RuntimeColor')
    if colors is None:
        colors = mesh.color_attributes.new(name='SERA_RuntimeColor', type='BYTE_COLOR', domain='CORNER')

    for poly in mesh.polygons:
        source_material = mesh.materials[poly.material_index] if poly.material_index < len(mesh.materials) else None
        rgba = tuple(source_material.diffuse_color) if source_material else (1.0, 1.0, 1.0, 1.0)
        for loop_index in poly.loop_indices:
            colors.data[loop_index].color = rgba

    try:
        mesh.color_attributes.active_color = colors
    except Exception:
        pass

    mesh.materials.clear()
    mesh.materials.append(material('SERA_RuntimeWhite', 0xFFFFFF, 0.72))
    for poly in mesh.polygons:
        poly.material_index = 0
    mesh.update()


def export_runtime_mesh(output):
    """Export visible SERA geometry as a compact static GLB for browser reskinning.

    Runtime animation is supplied by POLY FIGHTER's canonical combat rig, so the
    Blender armature, finger hierarchy, audit ground and source helper meshes are
    excluded. The evaluated body plus persistent identity pieces are joined into
    one mesh. Blender material colors are baked to COLOR_0 and all materials are
    collapsed to one white slot, producing one primitive with no UVs or normals.
    """
    depsgraph = bpy.context.evaluated_depsgraph_get()
    sources = [
        obj for obj in bpy.context.scene.objects
        if obj.type == 'MESH' and (obj.name == 'Superhero_Female' or obj.name.startswith('SERA_'))
    ]
    if not sources:
        raise RuntimeError('no SERA runtime mesh sources found')

    copies = []
    for source in sources:
        evaluated = source.evaluated_get(depsgraph)
        mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=False, depsgraph=depsgraph)
        copy = bpy.data.objects.new('Runtime_' + source.name, mesh)
        copy.matrix_world = source.matrix_world.copy()
        bpy.context.collection.objects.link(copy)
        for material_slot in source.material_slots:
            if material_slot.material and material_slot.material.name not in [m.name for m in mesh.materials if m]:
                mesh.materials.append(material_slot.material)
        for poly in mesh.polygons:
            poly.use_smooth = False
        copies.append(copy)

    bpy.ops.object.select_all(action='DESELECT')
    for obj in copies:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = copies[0]
    bpy.ops.object.join()
    runtime = bpy.context.view_layer.objects.active
    runtime.name = 'SERA_RuntimeMesh'
    for group in list(runtime.vertex_groups):
        runtime.vertex_groups.remove(group)
    bake_runtime_colors(runtime)

    path = os.path.join(output, 'sera-blender-runtime.glb')
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_skins=False,
        export_normals=False,
        export_texcoords=False,
        export_colors=True,
    )
    if not os.path.exists(path) or os.path.getsize(path) <= 0:
        raise RuntimeError('SERA runtime GLB export failed')

    bpy.data.objects.remove(runtime, do_unlink=True)
    return os.path.getsize(path)


def main():
    args = parse_args()
    output = os.path.abspath(args.output_dir)
    os.makedirs(output, exist_ok=True)
    source = load_source_helpers()
    clean_scene()
    setup_scene()
    try:
        bpy.context.scene.view_settings.view_transform = 'Standard'
        bpy.context.scene.view_settings.exposure = -1.35
    except Exception:
        pass

    objects = source.imported_objects(args.source_gltf)
    source.normalize_character(objects)
    body = bpy.data.objects.get('Superhero_Female')
    armature = next((obj for obj in objects if obj.type == 'ARMATURE'), None)
    if body is None or armature is None:
        raise RuntimeError('Quaternius body or armature missing')

    mats = apply_body(body)
    style_face(objects)
    apply_identity(armature, mats)
    tune_identity()

    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(output, 'sera-blender-prototype.blend'))
    bpy.ops.export_scene.gltf(filepath=os.path.join(output, 'sera-blender-prototype.glb'), export_format='GLB', export_apply=False, export_yup=True, export_cameras=False, export_lights=False)
    runtime_bytes = export_runtime_mesh(output)
    render_views(output)
    save_version(output)
    triangles = sum(max(1, len(poly.vertices) - 2) for poly in body.data.polygons)
    metrics = {
        'prototype':'SERA_QUATERNIUS_CONFORMAL_V8',
        'source':'Quaternius Superhero Female FullBody',
        'sourceLicense':'CC0 1.0 Universal',
        'heightMeters':1.68,
        'bodyVertices':len(body.data.vertices),
        'bodyTriangles':triangles,
        'armature':armature.name,
        'runtimeAsset':'sera-blender-runtime.glb',
        'runtimeAssetBytes':runtime_bytes,
        'runtimeSwitched':True,
        'design':'coherent rigged source body with direct head shaping, narrow 3D fringe, bone-anchored boot shell, tightened costume silhouette'
    }
    with open(os.path.join(output, 'sera-blender-metrics.json'), 'w') as handle:
        json.dump(metrics, handle, indent=2)
    with open(os.path.join(output, 'README.txt'), 'w') as handle:
        handle.write('Free female base remains coherent and rigged. The compact vertex-colored sera-blender-runtime.glb is now staged into POLY FIGHTER and reskinned to the canonical combat rig at runtime.\n')
    print('SERA_CONFORMAL_V8_OK', len(body.data.vertices), triangles, 'RUNTIME_BYTES', runtime_bytes)


if __name__ == '__main__':
    main()

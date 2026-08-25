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


def export_runtime_mesh(output):
    """Export canonical SERA geometry while retaining authored part identities.

    The Hero reference objective deliberately poses the source armature to match
    the turnaround. The game supplies its own canonical combat rig, so the body
    is copied from its edited rest mesh datablock and procedural overlays are
    copied as evaluated static geometry.

    V12 deliberately does *not* join Runtime_* objects before GLB export. Object
    names such as Runtime_SERA_Guard_l survive into Three.js, allowing the game
    to rigid-skin authored guards, shin shells, boots and head pieces to their
    intended canonical bones instead of guessing from color/position alone.
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
        if source.name == 'Superhero_Female':
            mesh = source.data.copy()
        else:
            evaluated = source.evaluated_get(depsgraph)
            mesh = bpy.data.meshes.new_from_object(
                evaluated,
                preserve_all_data_layers=False,
                depsgraph=depsgraph,
            )
        copy = bpy.data.objects.new('Runtime_' + source.name, mesh)
        copy.matrix_world = source.matrix_world.copy()
        copy['seraRuntimeSourcePart'] = source.name
        bone_follow = source.get('seraBoneFollow')
        if bone_follow:
            copy['seraRuntimeBoneFollow'] = str(bone_follow)
        bpy.context.collection.objects.link(copy)
        for material_slot in source.material_slots:
            if material_slot.material and material_slot.material.name not in [m.name for m in mesh.materials if m]:
                mesh.materials.append(material_slot.material)
        for poly in mesh.polygons:
            poly.use_smooth = False
        for group in list(copy.vertex_groups):
            copy.vertex_groups.remove(group)
        copies.append(copy)

    runtime_part_count = len(copies)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in copies:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = copies[0]

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
        export_colors=False,
        export_extras=True,
    )
    if not os.path.exists(path) or os.path.getsize(path) <= 0:
        raise RuntimeError('SERA runtime GLB export failed')

    runtime_bytes = os.path.getsize(path)
    for obj in copies:
        mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    return runtime_bytes, runtime_part_count


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
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(output, 'sera-blender-prototype.glb'),
        export_format='GLB',
        export_apply=False,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
    )
    runtime_bytes, runtime_part_count = export_runtime_mesh(output)
    render_views(output)
    save_version(output)
    triangles = sum(max(1, len(poly.vertices) - 2) for poly in body.data.polygons)
    metrics = {
        'prototype': 'SERA_QUATERNIUS_CONFORMAL_V12_PART_AWARE_RUNTIME',
        'source': 'Quaternius Superhero Female FullBody',
        'sourceLicense': 'CC0 1.0 Universal',
        'heightMeters': 1.68,
        'bodyVertices': len(body.data.vertices),
        'bodyTriangles': triangles,
        'armature': armature.name,
        'runtimeAsset': 'sera-blender-runtime.glb',
        'runtimeAssetBytes': runtime_bytes,
        'runtimePartCount': runtime_part_count,
        'runtimeSwitched': True,
        'runtimePalette': 'material primitives converted to vertex colors in browser',
        'runtimeIntegration': 'BLENDER_CONFORMAL_GLB_CANONICAL_RIG_PART_AWARE',
        'runtimePartIdentity': 'Runtime_* mesh names retained for rigid authored-part skinning',
        'gameplayRig': 'POLY FIGHTER V10-compatible canonical rig and IK',
        'design': 'coherent rigged source body with direct head shaping, named authored equipment, narrow 3D fringe and canonical runtime reskinning',
    }
    with open(os.path.join(output, 'sera-blender-metrics.json'), 'w') as handle:
        json.dump(metrics, handle, indent=2)
        handle.write('\n')
    with open(os.path.join(output, 'README.txt'), 'w') as handle:
        handle.write(
            'Free female base remains coherent and rigged. The compact material-palette '
            'sera-blender-runtime.glb retains Runtime_* part identities so authored guards, '
            'shin shells, boots and head pieces can be rigidly assigned to canonical combat '
            'bones before the remaining body vertices use heuristic skinning.\n'
        )
    print(
        'SERA_CONFORMAL_V12_OK',
        len(body.data.vertices),
        triangles,
        'RUNTIME_BYTES',
        runtime_bytes,
        'PARTS',
        runtime_part_count,
    )


if __name__ == '__main__':
    main()

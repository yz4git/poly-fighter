import argparse
import importlib.util
import json
import os
import sys

import bpy
from mathutils import Matrix, Vector
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


def runtime_source_count():
    return sum(
        1 for obj in bpy.context.scene.objects
        if obj.type == 'MESH' and (obj.name == 'Superhero_Female' or obj.name.startswith('SERA_'))
    )


def rotate_pose_bone_direction(armature, bone_name, target_direction):
    """Rotate one source-rig limb around its head without moving the joint."""
    bone = armature.pose.bones.get(bone_name)
    if bone is None:
        raise RuntimeError('missing runtime-bind source bone ' + bone_name)
    current = (bone.tail - bone.head).normalized()
    target = Vector(target_direction).normalized()
    delta = current.rotation_difference(target)
    pivot = bone.head.copy()
    bone.matrix = Matrix.Translation(pivot) @ delta.to_matrix().to_4x4() @ Matrix.Translation(-pivot) @ bone.matrix


def apply_runtime_bind_pose(armature):
    """Temporarily convert the source T-pose arms to canonical arms-down bind."""
    saved = {bone.name: bone.matrix_basis.copy() for bone in armature.pose.bones}
    rotate_pose_bone_direction(armature, 'upperarm_l', (0.08, 0.0, -1.0))
    rotate_pose_bone_direction(armature, 'upperarm_r', (-0.08, 0.0, -1.0))
    bpy.context.view_layer.update()
    return saved


def restore_pose(armature, saved):
    for name, matrix_basis in saved.items():
        bone = armature.pose.bones.get(name)
        if bone is not None:
            bone.matrix_basis = matrix_basis
    bpy.context.view_layer.update()


def source_arm_region(group_name):
    """Convert a Quaternius source vertex-group name into a stable arm region."""
    name = group_name.lower()
    if name == 'clavicle_l':
        return 'Shoulder_l'
    if name == 'clavicle_r':
        return 'Shoulder_r'
    if name == 'upperarm_l':
        return 'UpperArm_l'
    if name == 'upperarm_r':
        return 'UpperArm_r'
    if name == 'lowerarm_l':
        return 'Forearm_l'
    if name == 'lowerarm_r':
        return 'Forearm_r'
    if name == 'hand_l' or (name.endswith('_l') and name.startswith(('thumb_', 'index_', 'middle_', 'ring_', 'pinky_'))):
        return 'Hand_l'
    if name == 'hand_r' or (name.endswith('_r') and name.startswith(('thumb_', 'index_', 'middle_', 'ring_', 'pinky_'))):
        return 'Hand_r'
    return 'Base'


def source_vertex_arm_scores(source, vertex_index):
    scores = {}
    vertex = source.data.vertices[vertex_index]
    for membership in vertex.groups:
        if membership.group >= len(source.vertex_groups):
            continue
        region = source_arm_region(source.vertex_groups[membership.group].name)
        if region == 'Base':
            continue
        scores[region] = scores.get(region, 0.0) + float(membership.weight)
    return scores


def split_evaluated_body(source, evaluated_mesh):
    """Partition the evaluated body using the original source-rig arm weights.

    The evaluated runtime body has the correct arms-down geometry, but once the
    source rig is discarded a coordinate-only classifier cannot distinguish a
    forearm beside the torso from a thigh at a similar x/y position. Preserve
    that information as mesh names before GLB export. Browser skinning can then
    use those names as region hints while still computing its own canonical
    smooth weights.
    """
    if len(evaluated_mesh.vertices) != len(source.data.vertices):
        raise RuntimeError(
            'SERA runtime body topology changed; cannot preserve source arm regions '
            f'({len(source.data.vertices)} -> {len(evaluated_mesh.vertices)})'
        )

    vertex_scores = [source_vertex_arm_scores(source, i) for i in range(len(source.data.vertices))]
    face_regions = {}
    for poly_index, poly in enumerate(evaluated_mesh.polygons):
        totals = {}
        for vertex_index in poly.vertices:
            for region, weight in vertex_scores[vertex_index].items():
                totals[region] = totals.get(region, 0.0) + weight
        if totals:
            region, score = max(totals.items(), key=lambda item: item[1])
            # Require meaningful source-rig ownership. Boundary faces without a
            # clear arm signal stay in Base and retain the conservative fallback.
            region = region if score >= 0.55 else 'Base'
        else:
            region = 'Base'
        face_regions.setdefault(region, []).append(poly_index)

    copies = []
    for region, polygon_indices in face_regions.items():
        used_vertices = sorted({
            vertex_index
            for polygon_index in polygon_indices
            for vertex_index in evaluated_mesh.polygons[polygon_index].vertices
        })
        remap = {old: new for new, old in enumerate(used_vertices)}
        vertices = [evaluated_mesh.vertices[index].co.copy() for index in used_vertices]
        faces = [
            [remap[index] for index in evaluated_mesh.polygons[polygon_index].vertices]
            for polygon_index in polygon_indices
        ]
        mesh = bpy.data.meshes.new('SERA_Body_' + region + 'Mesh')
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        for mat in evaluated_mesh.materials:
            if mat:
                mesh.materials.append(mat)
        for new_poly, source_poly_index in zip(mesh.polygons, polygon_indices):
            new_poly.material_index = evaluated_mesh.polygons[source_poly_index].material_index
            new_poly.use_smooth = False
        copy = bpy.data.objects.new('Runtime_SERA_Body_' + region, mesh)
        copy.matrix_world = source.matrix_world.copy()
        copy['seraRuntimeSourcePart'] = 'Superhero_Female'
        copy['seraRuntimeArmRegion'] = region
        bpy.context.collection.objects.link(copy)
        copies.append(copy)
    return copies


def export_runtime_mesh(output):
    """Export canonical SERA geometry while retaining authored part identities.

    Runtime export saves the authored pose, converts the source T-pose arms to
    the canonical arms-down bind, freezes evaluated geometry, and restores the
    authored pose. The base body is additionally partitioned by its original
    Quaternius arm weights so the browser does not need to infer arms from x/y.

    Keep the historical return contract: callers receive only the runtime byte
    size. Hero Pipeline V5 imports this function directly.
    """
    armature = next((obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE'), None)
    if armature is None:
        raise RuntimeError('runtime export armature missing')
    saved_pose = apply_runtime_bind_pose(armature)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    sources = [
        obj for obj in bpy.context.scene.objects
        if obj.type == 'MESH' and (obj.name == 'Superhero_Female' or obj.name.startswith('SERA_'))
    ]
    if not sources:
        restore_pose(armature, saved_pose)
        raise RuntimeError('no SERA runtime mesh sources found')

    copies = []
    temporary_meshes = []
    try:
        for source in sources:
            evaluated = source.evaluated_get(depsgraph)
            evaluated_mesh = bpy.data.meshes.new_from_object(
                evaluated,
                preserve_all_data_layers=False,
                depsgraph=depsgraph,
            )
            if source.name == 'Superhero_Female':
                body_copies = split_evaluated_body(source, evaluated_mesh)
                copies.extend(body_copies)
                bpy.data.meshes.remove(evaluated_mesh)
                continue

            copy = bpy.data.objects.new('Runtime_' + source.name, evaluated_mesh)
            copy.matrix_world = source.matrix_world.copy()
            copy['seraRuntimeSourcePart'] = source.name
            bone_follow = source.get('seraBoneFollow')
            if bone_follow:
                copy['seraRuntimeBoneFollow'] = str(bone_follow)
            bpy.context.collection.objects.link(copy)
            for material_slot in source.material_slots:
                if material_slot.material and material_slot.material.name not in [m.name for m in evaluated_mesh.materials if m]:
                    evaluated_mesh.materials.append(material_slot.material)
            for poly in evaluated_mesh.polygons:
                poly.use_smooth = False
            for group in list(copy.vertex_groups):
                copy.vertex_groups.remove(group)
            copies.append(copy)
    finally:
        restore_pose(armature, saved_pose)

    if not copies:
        raise RuntimeError('SERA runtime export produced no mesh copies')
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
    return runtime_bytes


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

    runtime_part_count = runtime_source_count()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(output, 'sera-blender-prototype.blend'))
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(output, 'sera-blender-prototype.glb'),
        export_format='GLB',
        export_apply=False,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
    )
    runtime_bytes = export_runtime_mesh(output)
    render_views(output)
    save_version(output)
    triangles = sum(max(1, len(poly.vertices) - 2) for poly in body.data.polygons)
    metrics = {
        'prototype': 'SERA_QUATERNIUS_CONFORMAL_V14_SOURCE_RIG_REGIONS',
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
        'runtimeBindPose': 'CANONICAL_ARMS_DOWN_V1',
        'runtimeBodyRegions': 'QUATERNIUS_SOURCE_VERTEX_GROUPS_V1',
        'runtimePalette': 'material primitives converted to vertex colors in browser',
        'runtimeIntegration': 'BLENDER_CONFORMAL_GLB_CANONICAL_RIG_PART_AWARE',
        'runtimePartIdentity': 'Runtime_* mesh names retain equipment and source-rig arm regions',
        'gameplayRig': 'POLY FIGHTER V10-compatible canonical rig and IK',
        'design': 'coherent rigged source body with runtime arms-down bind conversion, source-rig arm region preservation, direct head shaping, named authored equipment and canonical runtime reskinning',
    }
    with open(os.path.join(output, 'sera-blender-metrics.json'), 'w') as handle:
        json.dump(metrics, handle, indent=2)
        handle.write('\n')
    with open(os.path.join(output, 'README.txt'), 'w') as handle:
        handle.write(
            'Runtime export temporarily rotates the Quaternius T-pose upper arms into '
            'the POLY FIGHTER arms-down bind, then partitions the evaluated base body '
            'using the original Quaternius arm vertex groups. Runtime_* names preserve '
            'those arm-region hints plus authored guards, shin shells, boots and head '
            'pieces for canonical browser reskinning.\n'
        )
    print(
        'SERA_CONFORMAL_V14_OK',
        len(body.data.vertices),
        triangles,
        'RUNTIME_BYTES',
        runtime_bytes,
        'PARTS',
        runtime_part_count,
    )


if __name__ == '__main__':
    main()

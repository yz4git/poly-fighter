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
    render_views(output)
    save_version(output)
    triangles = sum(max(1, len(poly.vertices) - 2) for poly in body.data.polygons)
    metrics = {'prototype':'SERA_QUATERNIUS_CONFORMAL_V7','source':'Quaternius Superhero Female FullBody','sourceLicense':'CC0 1.0 Universal','heightMeters':1.68,'bodyVertices':len(body.data.vertices),'bodyTriangles':triangles,'armature':armature.name,'runtimeSwitched':False,'design':'coherent rigged body, conformal palette, tuned hair and skirt silhouette'}
    with open(os.path.join(output, 'sera-blender-metrics.json'), 'w') as handle:
        json.dump(metrics, handle, indent=2)
    with open(os.path.join(output, 'README.txt'), 'w') as handle:
        handle.write('Free female base remains coherent and rigged. Bind-pose turnaround is used while body, hair and costume silhouette are refined. Runtime unchanged.\n')
    print('SERA_CONFORMAL_V7_OK', len(body.data.vertices), triangles)


if __name__ == '__main__':
    main()

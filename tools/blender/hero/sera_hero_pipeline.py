import argparse
import importlib.util
import json
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
BLENDER_DIR = os.path.dirname(HERE)
if BLENDER_DIR not in sys.path:
    sys.path.insert(0, BLENDER_DIR)
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from sera_blender_helpers import clean_scene, point_at, render_views, save_version, setup_scene
from sera_conformal_body import apply as apply_body
from sera_identity_parts import apply as apply_identity
from sera_identity_tuning import apply as tune_identity
from sera_hero_metrics import measure_body, run_optimizer, score


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser(description='Build and audit the SERA Hero Asset')
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--source-gltf', required=True)
    parser.add_argument('--spec', default=os.path.join(HERE, 'sera_hero_spec.json'))
    parser.add_argument('--iterations', type=int, default=None)
    return parser.parse_args(argv)


def load_module(filename, name):
    path = os.path.join(BLENDER_DIR, filename)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_spec(path):
    with open(path, 'r', encoding='utf-8') as fp:
        result = json.load(fp)
    if result.get('character') != 'SERA' or 'targets' not in result:
        raise RuntimeError('invalid SERA Hero spec')
    return result


def style_existing_face(objects, material_factory):
    eye = material_factory('SERA_Eye', 0x211A18, 0.72)
    brow = material_factory('SERA_Brow', 0x17151A, 0.84)
    for obj in objects:
        if obj.type != 'MESH' or obj.name == 'Superhero_Female':
            continue
        obj.data.materials.clear()
        obj.data.materials.append(brow if 'brow' in obj.name.lower() else eye)
        for poly in obj.data.polygons:
            poly.use_smooth = False


def multiply_scale(name, factors):
    obj = bpy.data.objects.get(name)
    if not obj:
        return
    obj.scale.x *= factors[0]
    obj.scale.y *= factors[1]
    obj.scale.z *= factors[2]


def apply_style_spec(spec):
    style = spec.get('style', {})
    multiply_scale('SERA_HairCap', style.get('hairCapScale', [1.0, 1.0, 1.0]))
    for name in ('SERA_HairlineL', 'SERA_HairlineR', 'SERA_FringeRootL', 'SERA_FringeRootR',
                 'SERA_FringeCenter', 'SERA_FringeL', 'SERA_FringeR', 'SERA_FringeSideL', 'SERA_FringeSideR'):
        multiply_scale(name, style.get('fringeScale', [1.0, 1.0, 1.0]))
    for name in ('SERA_PonyRoot', 'SERA_Pony1', 'SERA_Pony2', 'SERA_Pony3'):
        multiply_scale(name, style.get('ponytailScale', [1.0, 1.0, 1.0]))

    skirt_x = float(style.get('skirtWidthScale', 1.0))
    skirt_y = float(style.get('skirtDepthScale', 1.0))
    for name in ('SERA_FrontSkirt', 'SERA_LeftSkirt', 'SERA_RightSkirt'):
        multiply_scale(name, (skirt_x, skirt_y, 1.0))

    guard = float(style.get('forearmGuardScale', 1.0))
    shin = float(style.get('shinGuardScale', 1.0))
    boot = float(style.get('bootScale', 1.0))
    for suffix in ('l', 'r'):
        multiply_scale('SERA_Guard_' + suffix, (guard, guard, guard))
        multiply_scale('SERA_Shin_' + suffix, (shin, shin, shin))
        multiply_scale('SERA_BootFoot_' + suffix, (boot, boot, boot))

    feature = float(style.get('faceFeatureScale', 1.0))
    for name in ('SERA_BrowL', 'SERA_BrowR', 'SERA_EyeL', 'SERA_EyeR', 'SERA_NosePlane', 'SERA_Lip'):
        multiply_scale(name, (feature, 1.0, feature))


def configure_audit_scene(spec):
    audit = spec.get('audit', {})
    scene = bpy.context.scene
    scene.render.resolution_x = int(audit.get('renderWidth', 720))
    scene.render.resolution_y = int(audit.get('renderHeight', 1024))
    cam = bpy.data.objects.get('AuditCamera')
    if cam:
        cam.data.lens = float(audit.get('cameraLensMm', 62))
    try:
        scene.view_settings.view_transform = 'Standard'
        scene.view_settings.look = 'Medium High Contrast'
        scene.view_settings.exposure = -1.15
    except Exception:
        pass


def render_fight_camera(output_dir):
    cam = bpy.data.objects.get('AuditCamera')
    if cam is None:
        raise RuntimeError('AuditCamera missing')
    scene = bpy.context.scene
    cam.location = (2.95, -3.15, 1.16)
    point_at(cam, (0.0, 0.0, 0.94))
    scene.render.filepath = os.path.join(output_dir, 'sera-hero-fight.png')
    bpy.ops.render.render(write_still=True)


def select_hero_meshes():
    bpy.ops.object.select_all(action='DESELECT')
    meshes = []
    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH' and (obj.name == 'Superhero_Female' or obj.name.startswith('SERA_')):
            obj.select_set(True)
            meshes.append(obj)
    if meshes:
        bpy.context.view_layer.objects.active = meshes[0]
    return meshes


def export_full_hero(output_dir):
    meshes = select_hero_meshes()
    if not meshes:
        raise RuntimeError('no SERA Hero meshes found')
    path = os.path.join(output_dir, 'sera-hero.glb')
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )
    if not os.path.exists(path) or os.path.getsize(path) <= 0:
        raise RuntimeError('SERA Hero GLB export failed')
    return os.path.getsize(path)


def count_scene_triangles():
    total = 0
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH' or not (obj.name == 'Superhero_Female' or obj.name.startswith('SERA_')):
            continue
        total += sum(max(1, len(poly.vertices) - 2) for poly in obj.data.polygons)
    return total


def main():
    args = parse_args()
    output = os.path.abspath(args.output_dir)
    os.makedirs(output, exist_ok=True)
    spec = load_spec(os.path.abspath(args.spec))

    source = load_module('build-sera-quaternius.py', 'sera_source_base')
    conformal = load_module('build-sera-conformal.py', 'sera_conformal_export')

    clean_scene()
    setup_scene()
    configure_audit_scene(spec)

    objects = source.imported_objects(os.path.abspath(args.source_gltf))
    source.normalize_character(objects)
    body = bpy.data.objects.get('Superhero_Female')
    armature = next((obj for obj in objects if obj.type == 'ARMATURE'), None)
    if body is None or armature is None:
        raise RuntimeError('Quaternius body or armature missing')

    mats = apply_body(body)
    style_existing_face(objects, conformal.material)
    apply_identity(armature, mats)
    tune_identity()

    baseline = measure_body(body)
    baseline_score, baseline_errors = score(baseline, spec)
    history = run_optimizer(body, spec, iterations=args.iterations)
    apply_style_spec(spec)
    final_measurements = measure_body(body)
    final_score, final_errors = score(final_measurements, spec)

    render_views(output)
    if spec.get('audit', {}).get('includeFightCamera', True):
        render_fight_camera(output)

    blend_path = os.path.join(output, 'sera-hero.blend')
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    hero_bytes = export_full_hero(output)
    runtime_bytes = conformal.export_runtime_mesh(output)
    save_version(output)

    threshold = float(spec.get('audit', {}).get('scoreThreshold', 0.72))
    report = {
        'pipeline': 'SERA_HERO_ASSET_AI_PIPELINE_V1',
        'specVersion': spec.get('version'),
        'source': 'Quaternius Superhero Female FullBody',
        'sourceLicense': 'CC0 1.0 Universal',
        'baselineScore': baseline_score,
        'finalScore': final_score,
        'scoreThreshold': threshold,
        'passedScoreGate': final_score >= threshold,
        'baselineMeasurements': baseline,
        'finalMeasurements': final_measurements,
        'baselineErrors': baseline_errors,
        'finalErrors': final_errors,
        'optimizerHistory': history,
        'triangles': count_scene_triangles(),
        'heroAsset': 'sera-hero.glb',
        'heroAssetBytes': hero_bytes,
        'runtimeAsset': 'sera-blender-runtime.glb',
        'runtimeAssetBytes': runtime_bytes,
        'renders': [
            'sera-blender-front.png',
            'sera-blender-three-quarter.png',
            'sera-blender-side.png',
            'sera-blender-back.png',
            'sera-hero-fight.png',
        ],
        'notes': 'Closed-loop parametric hero pass. The spec is intentionally external so future AI critique can rewrite targets without changing Blender code.'
    }
    with open(os.path.join(output, 'sera-hero-report.json'), 'w', encoding='utf-8') as fp:
        json.dump(report, fp, indent=2)
        fp.write('\n')

    with open(os.path.join(output, 'README.txt'), 'w', encoding='utf-8') as fp:
        fp.write('SERA Hero Asset AI Pipeline V1\n')
        fp.write('Reference/spec -> Blender build -> measured closed-loop proportion correction -> 5-view audit -> GLB/runtime export.\n')
        fp.write('Edit tools/blender/hero/sera_hero_spec.json to steer the next AI-generated hero pass.\n')

    print('SERA_HERO_PIPELINE_OK', 'BASE', round(baseline_score, 5), 'FINAL', round(final_score, 5), 'ITERS', len(history))
    if final_score < threshold:
        print('SERA_HERO_SCORE_GATE_WARNING', final_score, '<', threshold)


if __name__ == '__main__':
    main()

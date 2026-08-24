import argparse
import importlib.util
import json
import os
import sys

import bpy

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
from sera_hero_metrics import measure_body, optimize_iteration, score
from sera_reference_objective import load_reference, render_and_score


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser(description='Build and audit the SERA Hero Asset')
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--source-gltf', required=True)
    parser.add_argument('--spec', default=os.path.join(HERE, 'sera_hero_spec.json'))
    parser.add_argument('--feedback', default=os.path.join(HERE, 'sera_hero_feedback.json'))
    parser.add_argument('--reference-objective-dir', required=True)
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
    if result.get('character') != 'SERA' or 'targets' not in result or 'referenceObjective' not in result:
        raise RuntimeError('invalid SERA Hero spec')
    return result


def load_feedback(path):
    if not path or not os.path.exists(path):
        return {'version': 'SERA_HERO_FEEDBACK_NONE', 'revision': 0}
    with open(path, 'r', encoding='utf-8') as fp:
        feedback = json.load(fp)
    if not str(feedback.get('version', '')).startswith('SERA_HERO_FEEDBACK_'):
        raise RuntimeError('invalid SERA Hero feedback')
    return feedback


def _multiply_value(base, multiplier):
    if isinstance(base, list):
        if isinstance(multiplier, list):
            if len(base) != len(multiplier):
                raise RuntimeError('style feedback list length mismatch')
            return [float(a) * float(b) for a, b in zip(base, multiplier)]
        return [float(a) * float(multiplier) for a in base]
    return float(base) * float(multiplier)


def apply_feedback_to_spec(spec, feedback):
    for key, multiplier in feedback.get('targetMultipliers', {}).items():
        if key not in spec.get('targets', {}):
            raise RuntimeError('unknown SERA Hero target feedback key: ' + key)
        spec['targets'][key] = _multiply_value(spec['targets'][key], multiplier)
    style = spec.setdefault('style', {})
    for key, multiplier in feedback.get('styleMultipliers', {}).items():
        if key not in style:
            raise RuntimeError('unknown SERA Hero style feedback key: ' + key)
        style[key] = _multiply_value(style[key], multiplier)
    return spec


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


def apply_object_feedback(feedback):
    applied = []
    for name, adjustment in feedback.get('objectAdjustments', {}).items():
        if not name.startswith('SERA_'):
            raise RuntimeError('Hero feedback may only adjust SERA_ objects: ' + name)
        obj = bpy.data.objects.get(name)
        if obj is None:
            continue
        scale = adjustment.get('scaleMultiplier')
        if scale is not None:
            if not isinstance(scale, list) or len(scale) != 3:
                raise RuntimeError('scaleMultiplier must have 3 values for ' + name)
            obj.scale.x *= float(scale[0]); obj.scale.y *= float(scale[1]); obj.scale.z *= float(scale[2])
        location = adjustment.get('locationDelta')
        if location is not None:
            if not isinstance(location, list) or len(location) != 3:
                raise RuntimeError('locationDelta must have 3 values for ' + name)
            obj.location.x += float(location[0]); obj.location.y += float(location[1]); obj.location.z += float(location[2])
        rotation = adjustment.get('rotationDeltaRadians')
        if rotation is not None:
            if not isinstance(rotation, list) or len(rotation) != 3:
                raise RuntimeError('rotationDeltaRadians must have 3 values for ' + name)
            obj.rotation_euler.x += float(rotation[0]); obj.rotation_euler.y += float(rotation[1]); obj.rotation_euler.z += float(rotation[2])
        applied.append(name)
    return applied


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
            obj.select_set(True); meshes.append(obj)
    if meshes:
        bpy.context.view_layer.objects.active = meshes[0]
    return meshes


def export_full_hero(output_dir):
    meshes = select_hero_meshes()
    if not meshes:
        raise RuntimeError('no SERA Hero meshes found')
    path = os.path.join(output_dir, 'sera-hero.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_cameras=False, export_lights=False, export_animations=False)
    if not os.path.exists(path) or os.path.getsize(path) <= 0:
        raise RuntimeError('SERA Hero GLB export failed')
    return os.path.getsize(path)


def count_scene_triangles():
    total = 0
    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH' and (obj.name == 'Superhero_Female' or obj.name.startswith('SERA_')):
            total += sum(max(1, len(poly.vertices) - 2) for poly in obj.data.polygons)
    return total


def _body_snapshot(body):
    return [vertex.co.copy() for vertex in body.data.vertices]


def _body_restore(body, snapshot):
    for vertex, coordinate in zip(body.data.vertices, snapshot):
        vertex.co = coordinate
    body.data.update(); bpy.context.view_layer.update()


def _object_snapshot():
    result = {}
    for obj in bpy.context.scene.objects:
        if obj.name.startswith('SERA_'):
            result[obj.name] = (obj.location.copy(), obj.scale.copy(), obj.rotation_euler.copy())
    return result


def _object_restore(snapshot):
    for name, (location, scale, rotation) in snapshot.items():
        obj = bpy.data.objects.get(name)
        if obj is not None:
            obj.location = location; obj.scale = scale; obj.rotation_euler = rotation
    bpy.context.view_layer.update()


def run_reference_body_optimizer(body, spec, reference, output, iterations):
    objective_dir = os.path.join(output, 'reference-objective')
    current = render_and_score(reference, objective_dir, 'baseline', spec)
    history = []
    minimum = float(spec.get('referenceObjective', {}).get('minImprovement', 0.0005))
    count = int(iterations if iterations is not None else spec.get('optimizer', {}).get('iterations', 8))
    for index in range(max(0, count)):
        snapshot = _body_snapshot(body)
        before_measurements = measure_body(body)
        optimize_iteration(body, spec)
        candidate = render_and_score(reference, objective_dir, f'body-{index + 1:02d}', spec)
        accepted = candidate['score'] > current['score'] + minimum
        history.append({
            'iteration': index + 1,
            'objectiveBefore': current['score'],
            'objectiveScore': candidate['score'],
            'accepted': accepted,
            'objective': candidate,
            'proposalMeasurements': measure_body(body),
            'beforeMeasurements': before_measurements,
        })
        if accepted:
            current = candidate
        else:
            _body_restore(body, snapshot)
            break
    return current, history


def main():
    args = parse_args()
    output = os.path.abspath(args.output_dir)
    os.makedirs(output, exist_ok=True)
    spec = load_spec(os.path.abspath(args.spec))
    feedback = load_feedback(os.path.abspath(args.feedback) if args.feedback else None)
    apply_feedback_to_spec(spec, feedback)
    reference = load_reference(os.path.abspath(args.reference_objective_dir))

    source = load_module('build-sera-quaternius.py', 'sera_source_base')
    conformal = load_module('build-sera-conformal.py', 'sera_conformal_export')
    neutral_pose = load_module('sera_neutral_pose.py', 'sera_neutral_pose')

    clean_scene(); setup_scene(); configure_audit_scene(spec)
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
    # Reference scoring is explicitly pose-normalized. The old T-pose shoulder
    # width can still be reported as a diagnostic, but it cannot drive acceptance.
    neutral_pose.apply(armature)

    baseline_measurements = measure_body(body)
    legacy_baseline_score, baseline_errors = score(baseline_measurements, spec)
    reference_best, history = run_reference_body_optimizer(body, spec, reference, output, args.iterations)

    style_snapshot = _object_snapshot()
    apply_style_spec(spec)
    feedback_objects = apply_object_feedback(feedback)
    styled_objective = render_and_score(reference, os.path.join(output, 'reference-objective'), 'style-feedback', spec)
    style_accepted = styled_objective['score'] >= reference_best['score']
    if style_accepted:
        reference_best = styled_objective
    else:
        _object_restore(style_snapshot)

    final_objective = render_and_score(reference, os.path.join(output, 'reference-objective'), 'final', spec)
    final_measurements = measure_body(body)
    legacy_final_score, final_errors = score(final_measurements, spec)

    configure_audit_scene(spec)
    render_views(output)
    if spec.get('audit', {}).get('includeFightCamera', True):
        render_fight_camera(output)

    blend_path = os.path.join(output, 'sera-hero.blend')
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    hero_bytes = export_full_hero(output)
    runtime_bytes = conformal.export_runtime_mesh(output)
    save_version(output)

    threshold = float(spec.get('referenceObjective', {}).get('scoreThreshold', 0.78))
    baseline_reference = history[0]['objectiveBefore'] if history else final_objective['score']
    # The baseline semantic render is preserved in the objective directory. If
    # no proposal was run, the final objective is also the baseline.
    if history:
        baseline_reference = history[0]['objectiveBefore']
    report = {
        'pipeline': 'SERA_HERO_ASSET_AI_PIPELINE_V2_REFERENCE_OBJECTIVE',
        'objectiveType': 'REFERENCE_IMAGE_SILHOUETTE_LANDMARK_FACE_HAIR_V1',
        'specVersion': spec.get('version'),
        'feedbackVersion': feedback.get('version'),
        'feedbackRevision': int(feedback.get('revision', 0)),
        'feedbackObjectsApplied': feedback_objects,
        'styleFeedbackAccepted': style_accepted,
        'source': 'Quaternius Superhero Female FullBody',
        'sourceLicense': 'CC0 1.0 Universal',
        'poseNormalizedForObjective': True,
        'baselineScore': baseline_reference,
        'finalScore': final_objective['score'],
        'scoreThreshold': threshold,
        'passedScoreGate': final_objective['score'] >= threshold,
        'referenceObjective': final_objective,
        'legacyBodyDiagnostic': {
            'baselineScore': legacy_baseline_score,
            'finalScore': legacy_final_score,
            'baselineMeasurements': baseline_measurements,
            'finalMeasurements': final_measurements,
            'baselineErrors': baseline_errors,
            'finalErrors': final_errors,
            'note': 'Diagnostic/proposal guidance only. T-pose-derived dimensions never accept or reject a Hero candidate.'
        },
        'optimizerHistory': history,
        'triangles': count_scene_triangles(),
        'heroAsset': 'sera-hero.glb',
        'heroAssetBytes': hero_bytes,
        'runtimeAsset': 'sera-blender-runtime.glb',
        'runtimeAssetBytes': runtime_bytes,
        'renders': ['sera-blender-front.png', 'sera-blender-three-quarter.png', 'sera-blender-side.png', 'sera-blender-back.png', 'sera-hero-fight.png'],
        'notes': 'The acceptance objective is now the real turnaround imagery: four-view silhouette IoU, body landmarks, face landmarks, face silhouette and hair silhouette. Body dimensions only generate candidate deformations.'
    }
    with open(os.path.join(output, 'sera-hero-report.json'), 'w', encoding='utf-8') as fp:
        json.dump(report, fp, indent=2); fp.write('\n')
    with open(os.path.join(output, 'README.txt'), 'w', encoding='utf-8') as fp:
        fp.write('SERA Hero Asset AI Pipeline V2 - Reference Image Objective\n')
        fp.write('Reference JPEG -> canonical masks/landmarks -> Blender semantic renders -> image-driven accept/reject -> Hero GLB.\n')
        fp.write('T-pose body measurements are diagnostics/proposal guidance only and never the quality gate.\n')

    print('SERA_HERO_PIPELINE_OK', 'BASE', round(baseline_reference, 5), 'FINAL', round(final_objective['score'], 5),
          'ITERS', len(history), 'FEEDBACK_REV', feedback.get('revision', 0))
    print('SERA_REFERENCE_COMPONENTS', json.dumps(final_objective['components'], sort_keys=True))
    if final_objective['score'] < threshold:
        print('SERA_HERO_SCORE_GATE_WARNING', final_objective['score'], '<', threshold)


if __name__ == '__main__':
    main()

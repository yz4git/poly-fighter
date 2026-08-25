import argparse, json, os, sys
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
BLENDER_DIR = os.path.dirname(HERE)
for path in (BLENDER_DIR, HERE):
    if path not in sys.path:
        sys.path.insert(0, path)

import sera_hero_pipeline as legacy
import sera_parameter_search as parameter_search
import sera_reference_objective_v8 as reference_objective
from sera_hero_metrics import measure_body, score
from sera_hero_v4_deform import install as install_v4, V4_PARAMETER_COUNT, V4_SCHEMA_VERSION
from sera_local_objective_search import install as install_local_objective_search, LOCAL_ACCEPTANCE_VERSION

install_v4(parameter_search)
install_local_objective_search(parameter_search)
run_parameter_search = parameter_search.run_parameter_search
write_search_outputs = parameter_search.write_search_outputs
load_reference = reference_objective.load_reference
render_and_score = reference_objective.render_and_score


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser(description='SERA Hero V5 independent high-resolution face/hair local objective search')
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--source-gltf', required=True)
    parser.add_argument('--spec', default=os.path.join(HERE, 'sera_hero_spec_v5.json'))
    parser.add_argument('--feedback', default=os.path.join(HERE, 'sera_hero_feedback.json'))
    parser.add_argument('--reference-objective-dir', required=True)
    parser.add_argument('--search-state', default=os.path.join(HERE, 'sera_hero_search_state_v5.json'))
    parser.add_argument('--search-cache', default=os.path.join(HERE, 'sera_hero_search_cache_v5.json'))
    parser.add_argument('--candidate-budget', type=int, default=None)
    return parser.parse_args(argv)


def _local_score(result, name):
    return float(result.get('localObjectives', {}).get(name, {}).get('score', 0.0))


def main():
    args = parse_args()
    output = os.path.abspath(args.output_dir)
    os.makedirs(output, exist_ok=True)
    spec = legacy.load_spec(os.path.abspath(args.spec))
    if not spec.get('parameterSearch', {}).get('enabled', False):
        raise RuntimeError('SERA Hero V5 requires parameterSearch.enabled')
    if not spec.get('localReferenceObjective', {}).get('enabled', False):
        raise RuntimeError('SERA Hero V5 requires localReferenceObjective.enabled')
    if int(spec.get('parameterSearch', {}).get('parameterCount', 0)) != V4_PARAMETER_COUNT:
        raise RuntimeError('SERA Hero V5 must retain the validated 128D parameter space')
    feedback = legacy.load_feedback(os.path.abspath(args.feedback) if args.feedback else None)
    legacy.apply_feedback_to_spec(spec, feedback)
    reference = load_reference(os.path.abspath(args.reference_objective_dir))
    state_path = os.path.abspath(args.search_state)
    cache_path = os.path.abspath(args.search_cache)

    source = legacy.load_module('build-sera-quaternius.py', 'sera_source_base')
    conformal = legacy.load_module('build-sera-conformal.py', 'sera_conformal_export')
    neutral_pose = legacy.load_module('sera_neutral_pose.py', 'sera_neutral_pose')
    legacy.clean_scene()
    legacy.setup_scene()
    legacy.configure_audit_scene(spec)
    objects = source.imported_objects(os.path.abspath(args.source_gltf))
    source.normalize_character(objects)
    body = bpy.data.objects.get('Superhero_Female')
    armature = next((obj for obj in objects if obj.type == 'ARMATURE'), None)
    if body is None or armature is None:
        raise RuntimeError('Quaternius body or armature missing')
    materials = legacy.apply_body(body)
    legacy.style_existing_face(objects, conformal.material)
    legacy.apply_identity(armature, materials)
    legacy.tune_identity()
    neutral_pose.apply(armature)

    baseline_measurements = measure_body(body)
    legacy_baseline_score, baseline_errors = score(baseline_measurements, spec)
    best, state, cache, history, definitions = run_parameter_search(
        body, spec, reference, output, render_and_score, state_path, cache_path, args.candidate_budget
    )
    search_report = write_search_outputs(output, state, cache, history, definitions)

    if history:
        baseline_global = float(history[0]['globalScoreBefore'])
        baseline_face_local = float(history[0]['faceLocalBefore'])
        baseline_hair_local = float(history[0]['hairLocalBefore'])
    else:
        baseline_global = float(state.get('globalScore', state.get('score', 0.0)))
        baseline_face_local = float(state.get('faceLocalScore', 0.0))
        baseline_hair_local = float(state.get('hairLocalScore', 0.0))

    style_snapshot = legacy._object_snapshot()
    legacy.apply_style_spec(spec)
    feedback_objects = legacy.apply_object_feedback(feedback)
    styled = render_and_score(reference, os.path.join(output, 'reference-objective'), 'style-feedback', spec)
    style_accepted = (
        float(styled.get('score', 0.0)) >= float(best.get('score', 0.0))
        and _local_score(styled, 'face') >= _local_score(best, 'face')
        and _local_score(styled, 'hair') >= _local_score(best, 'hair')
    )
    if style_accepted:
        best = styled
    else:
        legacy._object_restore(style_snapshot)

    final = render_and_score(reference, os.path.join(output, 'reference-objective'), 'final', spec)
    final_measurements = measure_body(body)
    legacy_final_score, final_errors = score(final_measurements, spec)

    legacy.configure_audit_scene(spec)
    legacy.render_views(output)
    if spec.get('audit', {}).get('includeFightCamera', True):
        legacy.render_fight_camera(output)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(output, 'sera-hero.blend'))
    hero_bytes = legacy.export_full_hero(output)
    runtime_bytes = conformal.export_runtime_mesh(output)
    legacy.save_version(output)

    threshold = float(spec.get('referenceObjective', {}).get('scoreThreshold', .78))
    attachments = {obj.name: str(obj.get('seraBoneFollow')) for obj in bpy.context.scene.objects if obj.get('seraBoneFollow')}
    report = {
        'pipeline': 'SERA_HERO_ASSET_AI_PIPELINE_V5_INDEPENDENT_LOCAL_REFERENCE',
        'objectiveType': 'REFERENCE_CROP_INDEPENDENT_FACE_HAIR_V2',
        'parameterSpaceVersion': V4_SCHEMA_VERSION,
        'parameterCount': len(definitions),
        'acceptanceVersion': LOCAL_ACCEPTANCE_VERSION,
        'specVersion': spec.get('version'),
        'feedbackVersion': feedback.get('version'),
        'feedbackRevision': int(feedback.get('revision', 0)),
        'feedbackObjectsApplied': feedback_objects,
        'styleFeedbackAccepted': style_accepted,
        'source': 'Quaternius Superhero Female FullBody',
        'sourceLicense': 'CC0 1.0 Universal',
        'poseNormalizedForObjective': True,
        'boneFollowAttachments': attachments,
        'boneFollowAttachmentCount': len(attachments),
        'baselineScore': baseline_global,
        'finalScore': float(final.get('score', 0.0)),
        'baselineObjectives': {
            'global': baseline_global,
            'faceLocal': baseline_face_local,
            'hairLocal': baseline_hair_local,
        },
        'finalObjectives': {
            'global': float(final.get('score', 0.0)),
            'faceLocal': _local_score(final, 'face'),
            'hairLocal': _local_score(final, 'hair'),
        },
        'scoreThreshold': threshold,
        'passedScoreGate': float(final.get('score', 0.0)) >= threshold,
        'referenceObjective': final,
        'parameterSearch': search_report,
        'searchState': state,
        'legacyBodyDiagnostic': {
            'baselineScore': legacy_baseline_score,
            'finalScore': legacy_final_score,
            'baselineMeasurements': baseline_measurements,
            'finalMeasurements': final_measurements,
            'baselineErrors': baseline_errors,
            'finalErrors': final_errors,
            'note': 'Diagnostic guidance only. T-pose-derived dimensions never accept or reject a Hero candidate.',
        },
        'triangles': legacy.count_scene_triangles(),
        'heroAsset': 'sera-hero.glb',
        'heroAssetBytes': hero_bytes,
        'runtimeAsset': 'sera-blender-runtime.glb',
        'runtimeAssetBytes': runtime_bytes,
        'renders': ['sera-blender-front.png', 'sera-blender-three-quarter.png', 'sera-blender-side.png', 'sera-blender-back.png', 'sera-hero-fight.png'],
        'notes': 'V8 keeps the validated V4 128D deformation space and the independent face/hair acceptance rules. Local Reference and Generated windows now use the same 2D semantic-mask landmark detector, eliminating 3D object-origin and camera-projection drift from local crop selection.',
    }
    with open(os.path.join(output, 'sera-hero-report.json'), 'w', encoding='utf-8') as fp:
        json.dump(report, fp, indent=2)
        fp.write('\n')
    with open(os.path.join(output, 'README.txt'), 'w', encoding='utf-8') as fp:
        fp.write('SERA Hero Asset AI Pipeline V8 - Symmetric Semantic-Mask Local Reference Objectives\n')
        fp.write('Global Reference objective remains independent from 512x512 high-resolution face and hair crop objectives.\n')
        fp.write('Face/hair local windows use the same 2D semantic-mask landmark detector for Reference and Generated.\n')
        fp.write('Face group accepts by face-local improvement; hair group accepts by hair-local improvement; global/per-view silhouette are regression guards.\n')

    print('SERA_HERO_PIPELINE_V5_OK', 'GLOBAL', round(final['score'], 5), 'FACE_LOCAL', round(_local_score(final, 'face'), 5), 'HAIR_LOCAL', round(_local_score(final, 'hair'), 5), 'GEN', state['generation'], 'PARAMS', len(definitions), 'IMPROVED', state['improvedCandidates'])
    print('SERA_REFERENCE_GLOBAL_COMPONENTS', json.dumps(final['components'], sort_keys=True))
    print('SERA_REFERENCE_LOCAL_OBJECTIVES', json.dumps(final['localObjectives'], sort_keys=True))
    print('SERA_PARAMETER_SEARCH', json.dumps({'generation': state['generation'], 'continueSearch': state['continueSearch'], 'step': state['step'], 'activeParameters': len(state['parameters']), 'groupPriority': state['groupPriority']}, sort_keys=True))


if __name__ == '__main__':
    main()

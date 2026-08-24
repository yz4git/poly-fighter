import argparse, json, os, sys
import bpy

HERE=os.path.dirname(os.path.abspath(__file__))
BLENDER_DIR=os.path.dirname(HERE)
for p in (BLENDER_DIR,HERE):
    if p not in sys.path:sys.path.insert(0,p)

import sera_hero_pipeline as legacy
import sera_parameter_search as parameter_search
from sera_hero_metrics import measure_body, score
from sera_hero_v4_deform import install as install_v4, V4_PARAMETER_COUNT, V4_SCHEMA_VERSION
from sera_reference_objective import load_reference, render_and_score

install_v4(parameter_search)
run_parameter_search=parameter_search.run_parameter_search
write_search_outputs=parameter_search.write_search_outputs


def parse_args():
    argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    p=argparse.ArgumentParser(description='SERA Hero V4 128D local face / strand hair parameter search')
    p.add_argument('--output-dir',required=True);p.add_argument('--source-gltf',required=True)
    p.add_argument('--spec',default=os.path.join(HERE,'sera_hero_spec_v4.json'));p.add_argument('--feedback',default=os.path.join(HERE,'sera_hero_feedback.json'))
    p.add_argument('--reference-objective-dir',required=True);p.add_argument('--search-state',default=os.path.join(HERE,'sera_hero_search_state_v4.json'));p.add_argument('--search-cache',default=os.path.join(HERE,'sera_hero_search_cache_v4.json'));p.add_argument('--candidate-budget',type=int,default=None)
    return p.parse_args(argv)


def main():
    args=parse_args();output=os.path.abspath(args.output_dir);os.makedirs(output,exist_ok=True)
    spec=legacy.load_spec(os.path.abspath(args.spec))
    if not spec.get('parameterSearch',{}).get('enabled',False):raise RuntimeError('SERA Hero V4 requires parameterSearch.enabled')
    if int(spec.get('parameterSearch',{}).get('parameterCount',0))!=V4_PARAMETER_COUNT:raise RuntimeError('SERA Hero V4 spec must expose 128 parameters')
    feedback=legacy.load_feedback(os.path.abspath(args.feedback) if args.feedback else None);legacy.apply_feedback_to_spec(spec,feedback)
    reference=load_reference(os.path.abspath(args.reference_objective_dir))
    state_path=os.path.abspath(args.search_state);cache_path=os.path.abspath(args.search_cache);budget=args.candidate_budget

    source=legacy.load_module('build-sera-quaternius.py','sera_source_base')
    conformal=legacy.load_module('build-sera-conformal.py','sera_conformal_export')
    neutral_pose=legacy.load_module('sera_neutral_pose.py','sera_neutral_pose')
    legacy.clean_scene();legacy.setup_scene();legacy.configure_audit_scene(spec)
    objects=source.imported_objects(os.path.abspath(args.source_gltf));source.normalize_character(objects)
    body=bpy.data.objects.get('Superhero_Female');armature=next((o for o in objects if o.type=='ARMATURE'),None)
    if body is None or armature is None:raise RuntimeError('Quaternius body or armature missing')
    mats=legacy.apply_body(body);legacy.style_existing_face(objects,conformal.material);legacy.apply_identity(armature,mats);legacy.tune_identity();neutral_pose.apply(armature)

    baseline_measurements=measure_body(body);legacy_baseline_score,baseline_errors=score(baseline_measurements,spec)
    best,state,cache,history,defs=run_parameter_search(body,spec,reference,output,render_and_score,state_path,cache_path,budget)
    search_report=write_search_outputs(output,state,cache,history,defs)

    style_snapshot=legacy._object_snapshot();legacy.apply_style_spec(spec);feedback_objects=legacy.apply_object_feedback(feedback)
    styled=render_and_score(reference,os.path.join(output,'reference-objective'),'style-feedback',spec)
    min_imp=float(spec.get('referenceObjective',{}).get('minImprovement',.0005));style_accepted=styled['score']>best['score']+min_imp
    if style_accepted:best=styled
    else:legacy._object_restore(style_snapshot)
    final=render_and_score(reference,os.path.join(output,'reference-objective'),'final',spec)
    final_measurements=measure_body(body);legacy_final_score,final_errors=score(final_measurements,spec)

    legacy.configure_audit_scene(spec);legacy.render_views(output)
    if spec.get('audit',{}).get('includeFightCamera',True):legacy.render_fight_camera(output)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(output,'sera-hero.blend'))
    hero_bytes=legacy.export_full_hero(output);runtime_bytes=conformal.export_runtime_mesh(output);legacy.save_version(output)
    threshold=float(spec.get('referenceObjective',{}).get('scoreThreshold',.78));baseline=float(history[0]['scoreBefore'] if history else state['score'])
    attachments={o.name:str(o.get('seraBoneFollow')) for o in bpy.context.scene.objects if o.get('seraBoneFollow')}
    report={
      'pipeline':'SERA_HERO_ASSET_AI_PIPELINE_V4_128D_LOCAL_FACE_STRAND_HAIR','objectiveType':'REFERENCE_IMAGE_SILHOUETTE_LANDMARK_FACE_HAIR_V1',
      'parameterSpaceVersion':V4_SCHEMA_VERSION,'parameterCount':len(defs),'specVersion':spec.get('version'),'feedbackVersion':feedback.get('version'),'feedbackRevision':int(feedback.get('revision',0)),
      'feedbackObjectsApplied':feedback_objects,'styleFeedbackAccepted':style_accepted,'source':'Quaternius Superhero Female FullBody','sourceLicense':'CC0 1.0 Universal','poseNormalizedForObjective':True,
      'boneFollowAttachments':attachments,'boneFollowAttachmentCount':len(attachments),
      'baselineScore':baseline,'finalScore':final['score'],'scoreThreshold':threshold,'passedScoreGate':final['score']>=threshold,'referenceObjective':final,'parameterSearch':search_report,'searchState':state,
      'legacyBodyDiagnostic':{'baselineScore':legacy_baseline_score,'finalScore':legacy_final_score,'baselineMeasurements':baseline_measurements,'finalMeasurements':final_measurements,'baselineErrors':baseline_errors,'finalErrors':final_errors,'note':'Diagnostic guidance only. T-pose-derived dimensions never accept or reject a Hero candidate.'},
      'triangles':legacy.count_scene_triangles(),'heroAsset':'sera-hero.glb','heroAssetBytes':hero_bytes,'runtimeAsset':'sera-blender-runtime.glb','runtimeAssetBytes':runtime_bytes,
      'renders':['sera-blender-front.png','sera-blender-three-quarter.png','sera-blender-side.png','sera-blender-back.png','sera-hero-fight.png'],
      'notes':'V4 keeps the validated V3 best seed, bone-parents limb armor, adds 16 front-surface local face deformation fields and 16 strand/back-hair/ponytail controls. Candidate acceptance remains the real four-view Reference objective.'}
    with open(os.path.join(output,'sera-hero-report.json'),'w',encoding='utf-8') as f:json.dump(report,f,indent=2);f.write('\n')
    with open(os.path.join(output,'README.txt'),'w',encoding='utf-8') as f:
        f.write('SERA Hero Asset AI Pipeline V4 - 128D Local Deformation\nV3 best seed -> bone-follow armor -> local source-face fields -> strand-level hair -> Reference objective.\nGroups: skeleton 20, face 36, hair 36, arms 12, legs 12, costume 12.\n')
    print('SERA_HERO_PIPELINE_V4_OK','BASE',round(baseline,5),'FINAL',round(final['score'],5),'GEN',state['generation'],'PARAMS',len(defs),'IMPROVED',state['improvedCandidates'],'BONE_FOLLOW',len(attachments))
    print('SERA_REFERENCE_COMPONENTS',json.dumps(final['components'],sort_keys=True));print('SERA_PARAMETER_SEARCH',json.dumps({'generation':state['generation'],'continueSearch':state['continueSearch'],'step':state['step'],'activeParameters':len(state['parameters']),'groupPriority':state['groupPriority']},sort_keys=True))
    if final['score']<threshold:print('SERA_HERO_SCORE_GATE_WARNING',final['score'],'<',threshold)

if __name__=='__main__':main()

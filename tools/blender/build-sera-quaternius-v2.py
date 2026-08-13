import argparse
import importlib.util
import json
import os
import sys

import bpy
from mathutils import Vector

from sera_blender_helpers import add_segment, material, render_views, save_version, setup_scene, clean_scene


def parse_args():
    av=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    p=argparse.ArgumentParser(); p.add_argument('--output-dir',required=True); p.add_argument('--source-gltf',required=True)
    return p.parse_args(av)


def load_base_builder():
    path=os.path.join(os.path.dirname(__file__),'build-sera-quaternius.py')
    spec=importlib.util.spec_from_file_location('sera_quaternius_base',path)
    mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); return mod


def target(name,loc):
    obj=bpy.data.objects.new(name,None); bpy.context.collection.objects.link(obj); obj.location=loc; return obj


def ik(armature,bone_name,goal,pole):
    pb=armature.pose.bones.get(bone_name)
    if pb is None: raise RuntimeError('missing bone '+bone_name)
    c=pb.constraints.new('IK'); c.target=target('IK_'+bone_name,goal); c.pole_target=target('POLE_'+bone_name,pole); c.chain_count=2; c.use_tail=True


def pose_signature_a(armature):
    ik(armature,'lowerarm_l',(-0.18,0.10,1.43),(-0.34,-0.10,1.35))
    ik(armature,'lowerarm_r',(0.27,0.15,1.13),(0.35,-0.08,1.26))
    ik(armature,'calf_l',(-0.18,0.04,0.055),(-0.20,0.23,0.58))
    ik(armature,'calf_r',(0.19,-0.05,0.055),(0.20,0.22,0.58))
    bpy.context.scene.frame_set(1); bpy.context.view_layer.update()


def bone_points(armature,name):
    pb=armature.pose.bones[name]
    return armature.matrix_world@pb.head,armature.matrix_world@pb.tail


def replace_fixed_limb_armor(armature):
    for obj in list(bpy.data.objects):
        if obj.name.startswith('SERA_Forearm') or obj.name.startswith('SERA_Shin'):
            bpy.data.objects.remove(obj,do_unlink=True)
    black=material('SERA_PoseBlack',0x0D0E16,0.80); silver=material('SERA_PoseSilver',0xA6B2C6,0.52,0.30); blue=material('SERA_PoseBlue',0x387AD3,0.72)
    for side in ('l','r'):
        a,b=bone_points(armature,'lowerarm_'+side)
        add_segment('SERA_Forearm_'+side,a,b,0.043,0.034,black,(0.78,1.0),7)
        add_segment('SERA_Guard_'+side,a.lerp(b,0.54),a.lerp(b,0.91),0.045,0.029,silver,(0.68,1.0),6)
        a,b=bone_points(armature,'calf_'+side)
        add_segment('SERA_Shin_'+side,a.lerp(b,0.18),a.lerp(b,0.91),0.050,0.031,blue,(0.70,1.0),7)


def slim_overlay_masses():
    scales={
        'SERA_CropTop':(0.82,0.82,0.82),'SERA_ChestBlack':(0.82,0.72,0.82),'SERA_HighCollar':(0.82,0.78,0.82),
        'SERA_WaistBand':(0.80,0.80,0.76),'SERA_FrontPanel':(0.78,0.70,0.82),'SERA_LeftPanel':(0.78,0.70,0.82),'SERA_RightPanel':(0.78,0.70,0.82),
    }
    for name,scale in scales.items():
        obj=bpy.data.objects.get(name)
        if obj: obj.scale=scale


def main():
    a=parse_args(); out=os.path.abspath(a.output_dir); os.makedirs(out,exist_ok=True); base=load_base_builder()
    clean_scene(); setup_scene(); objects=base.imported_objects(a.source_gltf); base.normalize_character(objects)
    skin=material('SERA_Skin',0xD8A287,0.80); mesh_count,tris=base.style_base(objects,skin); base.add_sera_identity()
    armature=next((o for o in objects if o.type=='ARMATURE'),None)
    if armature is None: raise RuntimeError('Quaternius armature missing')
    pose_signature_a(armature); slim_overlay_masses(); replace_fixed_limb_armor(armature)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out,'sera-blender-prototype.blend'))
    bpy.ops.export_scene.gltf(filepath=os.path.join(out,'sera-blender-prototype.glb'),export_format='GLB',export_apply=False,export_yup=True,export_cameras=False,export_lights=False)
    render_views(out); save_version(out)
    metrics={'prototype':'SERA_QUATERNIUS_SIGNATURE_A_V4','sourceLicense':'CC0 1.0 Universal','heightMeters':1.68,'meshObjects':mesh_count,'sourceTriangles':tris,'armature':armature.name,'bones':sorted(b.name for b in armature.pose.bones),'runtimeSwitched':False}
    with open(os.path.join(out,'sera-blender-metrics.json'),'w') as f: json.dump(metrics,f,indent=2)
    with open(os.path.join(out,'README.txt'),'w') as f: f.write('Quaternius CC0 Superhero Female base, posed via its humanoid rig toward SERA Signature Stance A. Runtime unchanged.\n')


if __name__=='__main__': main()

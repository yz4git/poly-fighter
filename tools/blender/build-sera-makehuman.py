import argparse
import importlib.util
import json
import os
import sys

import bpy
from mathutils import Vector

from makehuman_body import create_body


def args():
    av=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    p=argparse.ArgumentParser()
    p.add_argument('--output-dir',required=True)
    p.add_argument('--makehuman-base',required=True)
    p.add_argument('--makehuman-target',required=True)
    return p.parse_args(av)


def load_legacy():
    path=os.path.join(os.path.dirname(__file__),'build-sera-prototype.py')
    spec=importlib.util.spec_from_file_location('sera_legacy_builder',path)
    mod=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def point_at(obj,target):
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()


def delete_old_character_meshes():
    for obj in list(bpy.data.objects):
        if obj.type=='MESH' and obj.name!='Ground':
            bpy.data.objects.remove(obj,do_unlink=True)


def build_costume(m):
    blue,black,silver,hair=m['blue'],m['black'],m['silver'],m['hair']
    m.add_cone('MH_SERA_CropTop',(0,0.0,1.24),0.145,0.205,0.25,(1.0,0.58),blue,10)
    m.add_box('MH_SERA_ChestInset',(0,0.108,1.245),(0.10,0.022,0.09),black,bevel=0.010)
    m.add_box('MH_SERA_Collar',(0,-0.005,1.405),(0.15,0.065,0.055),blue,bevel=0.010)
    m.add_cone('MH_SERA_Waist',(0,0,0.91),0.18,0.16,0.10,(1.0,0.64),blue,10)
    m.add_box('MH_SERA_FrontPanel',(0,0.06,0.73),(0.09,0.035,0.20),blue)
    m.add_box('MH_SERA_LeftPanel',(-0.15,-0.005,0.74),(0.05,0.025,0.17),blue)
    m.add_box('MH_SERA_RightPanel',(0.15,-0.005,0.76),(0.045,0.025,0.14),black)

    m.add_ico('MH_SERA_HairCap',(0,-0.01,1.58),(0.115,0.10,0.125),hair,2)
    m.add_box('MH_SERA_FringeL',(-0.035,0.085,1.59),(0.045,0.018,0.080),hair,bevel=0.006)
    m.add_box('MH_SERA_FringeR',(0.035,0.085,1.595),(0.045,0.018,0.075),hair,bevel=0.006)
    m.add_box('MH_SERA_HairTie',(0,-0.095,1.665),(0.065,0.025,0.018),blue,bevel=0.004)
    m.add_segment('MH_SERA_Pony1',(0,-0.10,1.67),(0.025,-0.18,1.48),0.070,0.055,hair,(0.72,1.0),7)
    m.add_segment('MH_SERA_Pony2',(0.025,-0.18,1.48),(0.045,-0.20,1.23),0.055,0.035,hair,(0.70,1.0),7)
    m.add_segment('MH_SERA_Pony3',(0.045,-0.20,1.23),(0.03,-0.17,1.05),0.035,0.012,hair,(0.68,1.0),7)

    for s in (-1,1):
        m.add_segment(f'MH_SERA_Sleeve_{s}',(s*0.20,0,1.33),(s*0.43,0,1.33),0.052,0.041,black,(0.82,1.0),7)
        m.add_segment(f'MH_SERA_Bracer_{s}',(s*0.43,0,1.33),(s*0.62,0,1.33),0.050,0.034,silver,(0.74,1.0),6)
        m.add_segment(f'MH_SERA_Shin_{s}',(s*0.10,0,0.47),(s*0.105,0.02,0.14),0.058,0.036,blue,(0.72,1.0),7)


def main():
    a=args(); out=os.path.abspath(a.output_dir); os.makedirs(out,exist_ok=True)
    legacy=load_legacy()
    old=sys.argv[:]
    sys.argv=[old[0],'--','--output-dir',out]
    legacy.main()
    sys.argv=old

    delete_old_character_meshes()
    skin=legacy.material('MH_SERA_Skin',0xD8A287,0.78)
    body=create_body(a.makehuman_base,a.makehuman_target,skin)
    mats={
        'blue':legacy.material('MH_SERA_Blue',0x387AD3,0.70),
        'black':legacy.material('MH_SERA_Black',0x0D0E16,0.78),
        'silver':legacy.material('MH_SERA_Silver',0xA6B2C6,0.52,0.28),
        'hair':legacy.material('MH_SERA_Hair',0x17151A,0.82),
    }
    build_costume(legacy.__class__(**{}) if False else type('H',(),{})())

    # Bind legacy geometry helpers to the new palette without duplicating code.
    h=type('Helpers',(),{})()
    for name in ('add_cone','add_box','add_ico','add_segment'):
        setattr(h,name,getattr(legacy,name))
    h.blue=mats['blue']; h.black=mats['black']; h.silver=mats['silver']; h.hair=mats['hair']

    # Re-run the small costume using a shim with the materials expected above.
    def costume_with_palette():
        blue,black,silver,hair=mats['blue'],mats['black'],mats['silver'],mats['hair']
        legacy.add_cone('MH_SERA_CropTop',(0,0.0,1.24),0.145,0.205,0.25,(1.0,0.58),blue,10)
        legacy.add_box('MH_SERA_ChestInset',(0,0.108,1.245),(0.10,0.022,0.09),black,bevel=0.010)
        legacy.add_box('MH_SERA_Collar',(0,-0.005,1.405),(0.15,0.065,0.055),blue,bevel=0.010)
        legacy.add_cone('MH_SERA_Waist',(0,0,0.91),0.18,0.16,0.10,(1.0,0.64),blue,10)
        legacy.add_box('MH_SERA_FrontPanel',(0,0.06,0.73),(0.09,0.035,0.20),blue)
        legacy.add_ico('MH_SERA_HairCap',(0,-0.01,1.58),(0.115,0.10,0.125),hair,2)
        legacy.add_box('MH_SERA_HairTie',(0,-0.095,1.665),(0.065,0.025,0.018),blue,bevel=0.004)
        legacy.add_segment('MH_SERA_Pony1',(0,-0.10,1.67),(0.025,-0.18,1.48),0.070,0.055,hair,(0.72,1.0),7)
        legacy.add_segment('MH_SERA_Pony2',(0.025,-0.18,1.48),(0.04,-0.19,1.18),0.055,0.015,hair,(0.70,1.0),7)
        for s in (-1,1):
            legacy.add_segment(f'MH_SERA_Sleeve_{s}',(s*0.20,0,1.33),(s*0.43,0,1.33),0.052,0.041,black,(0.82,1.0),7)
            legacy.add_segment(f'MH_SERA_Bracer_{s}',(s*0.43,0,1.33),(s*0.62,0,1.33),0.050,0.034,silver,(0.74,1.0),6)
            legacy.add_segment(f'MH_SERA_Shin_{s}',(s*0.10,0,0.47),(s*0.105,0.02,0.14),0.058,0.036,blue,(0.72,1.0),7)
    costume_with_palette()

    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out,'sera-blender-prototype.blend'))
    bpy.ops.export_scene.gltf(filepath=os.path.join(out,'sera-blender-prototype.glb'),export_format='GLB',export_apply=True,export_yup=True,export_cameras=False,export_lights=False)
    cam=bpy.data.objects.get('AuditCamera')
    legacy.render_views(out,cam,point_at)
    tris=sum(max(1,len(p.vertices)-2) for p in body.data.polygons)
    with open(os.path.join(out,'sera-blender-metrics.json'),'w') as fp:
        json.dump({'prototype':'SERA_MAKEHUMAN_CC0_BASE_V2','sourceLicense':'CC0','bodyVertices':len(body.data.vertices),'bodyTriangles':tris,'heightMeters':1.68,'runtimeSwitched':False},fp,indent=2)
    with open(os.path.join(out,'README.txt'),'w') as fp:
        fp.write('SERA prototype now uses the CC0 MakeHuman hm08 BODY mesh plus asian-female-young target as its anatomical base. Runtime remains unchanged.\n')
    print('SERA_MAKEHUMAN_PROTOTYPE_OK',len(body.data.vertices),tris)


if __name__=='__main__':
    main()

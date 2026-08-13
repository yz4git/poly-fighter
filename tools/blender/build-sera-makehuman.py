import argparse
import importlib.util
import json
import os
import sys
import urllib.request

import bpy
from mathutils import Vector

from makehuman_body import create_body

MAKEHUMAN_REV = 'a8bc2d54ff0ac92e78ff71431b1023eda42bf482'
MAKEHUMAN_BASE_URL = f'https://raw.githubusercontent.com/makehumancommunity/makehuman/{MAKEHUMAN_REV}/makehuman/data/3dobjs/base.obj'
MAKEHUMAN_TARGET_URL = f'https://raw.githubusercontent.com/makehumancommunity/makehuman/{MAKEHUMAN_REV}/makehuman/data/targets/macrodetails/asian-female-young.target'


def args():
    av = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument('--output-dir', required=True)
    p.add_argument('--makehuman-base')
    p.add_argument('--makehuman-target')
    return p.parse_args(av)


def load_legacy():
    path = os.path.join(os.path.dirname(__file__), 'build-sera-prototype.py')
    spec = importlib.util.spec_from_file_location('sera_legacy_builder', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def point_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def delete_old_character_meshes():
    for obj in list(bpy.data.objects):
        if obj.type == 'MESH' and obj.name != 'Ground':
            bpy.data.objects.remove(obj, do_unlink=True)


def download_source(url, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    request = urllib.request.Request(url, headers={'User-Agent': 'poly-fighter-blender-audit'})
    with urllib.request.urlopen(request, timeout=60) as response, open(path, 'wb') as handle:
        handle.write(response.read())
    if not os.path.isfile(path) or os.path.getsize(path) < 1000:
        raise RuntimeError(f'Failed to obtain MakeHuman source: {url}')


def resolve_makehuman_sources(a, out):
    source_dir = os.path.join(out, 'source-cache')
    base = os.path.abspath(a.makehuman_base) if a.makehuman_base else os.path.join(source_dir, 'base.obj')
    target = os.path.abspath(a.makehuman_target) if a.makehuman_target else os.path.join(source_dir, 'asian-female-young.target')
    if not os.path.isfile(base):
        download_source(MAKEHUMAN_BASE_URL, base)
    if not os.path.isfile(target):
        download_source(MAKEHUMAN_TARGET_URL, target)
    return base, target


def main():
    a = args()
    out = os.path.abspath(a.output_dir)
    os.makedirs(out, exist_ok=True)
    base_path, target_path = resolve_makehuman_sources(a, out)
    legacy = load_legacy()

    # Reuse the already-proven Blender audit lighting/camera setup, then replace
    # the primitive prototype character with a coherent human base.
    old = sys.argv[:]
    sys.argv = [old[0], '--', '--output-dir', out]
    legacy.main()
    sys.argv = old
    delete_old_character_meshes()

    skin = legacy.material('MH_SERA_Skin', 0xD8A287, 0.78)
    body = create_body(base_path, target_path, skin)
    blue = legacy.material('MH_SERA_Blue', 0x387AD3, 0.70)
    black = legacy.material('MH_SERA_Black', 0x0D0E16, 0.78)
    silver = legacy.material('MH_SERA_Silver', 0xA6B2C6, 0.52, 0.28)
    hair = legacy.material('MH_SERA_Hair', 0x17151A, 0.82)

    # First pass costume: keep large readable reference color masses around the
    # anatomical body. These are intentionally simple until body proportions
    # and camera-space silhouette are accepted from real Blender renders.
    legacy.add_cone('MH_SERA_CropTop', (0, 0.0, 1.24), 0.145, 0.205, 0.25, (1.0, 0.58), blue, 10)
    legacy.add_box('MH_SERA_ChestInset', (0, 0.108, 1.245), (0.10, 0.022, 0.09), black, bevel=0.010)
    legacy.add_box('MH_SERA_Collar', (0, -0.005, 1.405), (0.15, 0.065, 0.055), blue, bevel=0.010)
    legacy.add_cone('MH_SERA_Waist', (0, 0, 0.91), 0.18, 0.16, 0.10, (1.0, 0.64), blue, 10)
    legacy.add_box('MH_SERA_FrontPanel', (0, 0.06, 0.73), (0.09, 0.035, 0.20), blue)
    legacy.add_box('MH_SERA_LeftPanel', (-0.15, -0.005, 0.74), (0.05, 0.025, 0.17), blue)
    legacy.add_box('MH_SERA_RightPanel', (0.15, -0.005, 0.76), (0.045, 0.025, 0.14), black)

    legacy.add_ico('MH_SERA_HairCap', (0, -0.01, 1.58), (0.115, 0.10, 0.125), hair, 2)
    legacy.add_box('MH_SERA_FringeL', (-0.035, 0.085, 1.59), (0.045, 0.018, 0.080), hair, bevel=0.006)
    legacy.add_box('MH_SERA_FringeR', (0.035, 0.085, 1.595), (0.045, 0.018, 0.075), hair, bevel=0.006)
    legacy.add_box('MH_SERA_HairTie', (0, -0.095, 1.665), (0.065, 0.025, 0.018), blue, bevel=0.004)
    legacy.add_segment('MH_SERA_Pony1', (0, -0.10, 1.67), (0.025, -0.18, 1.48), 0.070, 0.055, hair, (0.72, 1.0), 7)
    legacy.add_segment('MH_SERA_Pony2', (0.025, -0.18, 1.48), (0.04, -0.19, 1.18), 0.055, 0.015, hair, (0.70, 1.0), 7)
    for s in (-1, 1):
        legacy.add_segment(f'MH_SERA_Sleeve_{s}', (s * 0.20, 0, 1.33), (s * 0.43, 0, 1.33), 0.052, 0.041, black, (0.82, 1.0), 7)
        legacy.add_segment(f'MH_SERA_Bracer_{s}', (s * 0.43, 0, 1.33), (s * 0.62, 0, 1.33), 0.050, 0.034, silver, (0.74, 1.0), 6)
        legacy.add_segment(f'MH_SERA_Shin_{s}', (s * 0.10, 0, 0.47), (s * 0.105, 0.02, 0.14), 0.058, 0.036, blue, (0.72, 1.0), 7)

    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, 'sera-blender-prototype.blend'))
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(out, 'sera-blender-prototype.glb'),
        export_format='GLB',
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
    )
    cam = bpy.data.objects.get('AuditCamera')
    legacy.render_views(out, cam, point_at)

    tris = sum(max(1, len(p.vertices) - 2) for p in body.data.polygons)
    metrics = {
        'prototype': 'SERA_MAKEHUMAN_CC0_BASE_V2',
        'sourceRepository': 'makehumancommunity/makehuman',
        'sourceRevision': MAKEHUMAN_REV,
        'sourceBase': 'makehuman/data/3dobjs/base.obj',
        'sourceTarget': 'makehuman/data/targets/macrodetails/asian-female-young.target',
        'sourceLicense': 'CC0',
        'bodyVertices': len(body.data.vertices),
        'bodyTriangles': tris,
        'heightMeters': 1.68,
        'runtimeSwitched': False,
    }
    with open(os.path.join(out, 'sera-blender-metrics.json'), 'w', encoding='utf-8') as fp:
        json.dump(metrics, fp, indent=2)
    with open(os.path.join(out, 'README.txt'), 'w', encoding='utf-8') as fp:
        fp.write('SERA Blender prototype uses the pinned MakeHuman hm08 BODY mesh plus asian-female-young target as its free anatomical base. Runtime remains unchanged.\n')
    print('SERA_MAKEHUMAN_PROTOTYPE_OK', len(body.data.vertices), tris)


if __name__ == '__main__':
    main()

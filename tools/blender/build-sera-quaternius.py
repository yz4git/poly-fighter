import argparse
import json
import os
import sys

import bpy
from mathutils import Vector

from sera_blender_helpers import (
    add_box,
    add_cone,
    add_ico,
    add_segment,
    clean_scene,
    material,
    render_views,
    save_version,
    setup_scene,
)

SOURCE_REV = '57c0855a6622d4654fe32e9208efb820051164e3'
SOURCE_REL = 'first/assets/3d/characters/player/Superhero_Female_FullBody.gltf'


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--source-gltf', required=True)
    return parser.parse_args(argv)


def imported_objects(source_gltf):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(source_gltf))
    return [obj for obj in bpy.data.objects if obj not in before]


def mesh_bounds(objects):
    points = []
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in objects:
        if obj.type != 'MESH':
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            for vertex in mesh.vertices:
                points.append(evaluated.matrix_world @ vertex.co)
        finally:
            evaluated.to_mesh_clear()
    if not points:
        raise RuntimeError('Quaternius import contains no renderable mesh')
    minimum = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    maximum = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return minimum, maximum


def normalize_character(objects):
    minimum, maximum = mesh_bounds(objects)
    height = maximum.z - minimum.z
    if height <= 1e-5:
        raise RuntimeError('Quaternius base has invalid height')
    factor = 1.68 / height
    center_x = (minimum.x + maximum.x) * 0.5
    center_y = (minimum.y + maximum.y) * 0.5

    root = bpy.data.objects.new('SERA_SourceNormalize', None)
    bpy.context.collection.objects.link(root)
    top_level = [obj for obj in objects if obj.parent not in objects]
    for obj in top_level:
        world = obj.matrix_world.copy()
        obj.parent = root
        obj.matrix_world = world
    root.scale = (factor, factor, factor)
    root.location = (-center_x * factor, -center_y * factor, -minimum.z * factor)
    bpy.context.view_layer.update()
    return root


def style_base(objects, skin):
    mesh_count = 0
    source_triangles = 0
    for obj in objects:
        if obj.type != 'MESH':
            continue
        mesh_count += 1
        source_triangles += sum(max(1, len(poly.vertices) - 2) for poly in obj.data.polygons)
        obj.data.materials.clear()
        obj.data.materials.append(skin)
        for poly in obj.data.polygons:
            poly.use_smooth = False
        # Keep the source topology and rig for this checkpoint. Faceting comes
        # from flat shading; topology reduction comes only after the silhouette
        # is accepted against the SERA turnaround.
    return mesh_count, source_triangles


def add_sera_identity():
    blue = material('SERA_Blue', 0x387AD3, 0.72)
    black = material('SERA_Black', 0x0D0E16, 0.80)
    silver = material('SERA_Silver', 0xA6B2C6, 0.52, 0.30)
    hair = material('SERA_Hair', 0x17151A, 0.84)

    # The free Superhero Female supplies coherent anatomy and a humanoid rig.
    # These authored overlays establish SERA's recognizable large color masses
    # while we judge the base body proportions in real Blender renders.
    add_cone('SERA_CropTop', (0, 0.005, 1.235), 0.145, 0.205, 0.255, (1.0, 0.60), blue, 10)
    add_box('SERA_ChestBlack', (0, 0.105, 1.245), (0.105, 0.025, 0.095), black, bevel=0.008)
    add_box('SERA_HighCollar', (0, -0.005, 1.405), (0.150, 0.065, 0.055), blue, bevel=0.009)
    add_cone('SERA_WaistBand', (0, 0, 0.910), 0.178, 0.160, 0.105, (1.0, 0.66), blue, 10)

    # Asymmetric skirt panels; deliberately thin in depth so they read as cloth,
    # not the boxy solid masses from the first Blender prototype.
    add_box('SERA_FrontPanel', (-0.020, 0.055, 0.730), (0.082, 0.018, 0.205), blue, rotation=(0.0, 0.0, -0.05))
    add_box('SERA_LeftPanel', (-0.145, -0.005, 0.745), (0.050, 0.016, 0.175), blue, rotation=(0.0, 0.0, 0.10))
    add_box('SERA_RightPanel', (0.145, -0.008, 0.765), (0.043, 0.015, 0.145), black, rotation=(0.0, 0.0, -0.08))

    # Head reference: compact cap, center-split V fringe, high ponytail.
    add_ico('SERA_HairCap', (0, -0.010, 1.575), (0.112, 0.100, 0.120), hair, 2)
    add_box('SERA_FringeLeft', (-0.037, 0.083, 1.590), (0.043, 0.016, 0.078), hair, rotation=(-0.12, 0.04, -0.18), bevel=0.005)
    add_box('SERA_FringeRight', (0.037, 0.083, 1.593), (0.043, 0.016, 0.074), hair, rotation=(-0.12, -0.04, 0.18), bevel=0.005)
    add_box('SERA_HairTie', (0, -0.092, 1.665), (0.060, 0.022, 0.017), blue, bevel=0.004)
    add_segment('SERA_PonytailUpper', (0, -0.100, 1.675), (0.025, -0.175, 1.500), 0.067, 0.056, hair, (0.72, 1.0), 7)
    add_segment('SERA_PonytailMid', (0.025, -0.175, 1.500), (0.040, -0.205, 1.260), 0.056, 0.035, hair, (0.70, 1.0), 7)
    add_segment('SERA_PonytailTip', (0.040, -0.205, 1.260), (0.030, -0.175, 1.075), 0.035, 0.011, hair, (0.68, 1.0), 7)

    # Reference armor color cues. These will be conformed/skinned in a later
    # checkpoint after the imported base pose and bone coordinates are verified.
    for side in (-1, 1):
        add_segment(f'SERA_ForearmBlack_{side}', (side * 0.310, 0, 1.315), (side * 0.505, 0, 1.315), 0.046, 0.038, black, (0.82, 1.0), 7)
        add_segment(f'SERA_ForearmSilver_{side}', (side * 0.420, 0.005, 1.315), (side * 0.545, 0.010, 1.315), 0.048, 0.032, silver, (0.70, 1.0), 6)
        add_segment(f'SERA_ShinBlue_{side}', (side * 0.095, 0.005, 0.455), (side * 0.100, 0.020, 0.135), 0.055, 0.034, blue, (0.72, 1.0), 7)


def main():
    args = parse_args()
    output_dir = os.path.abspath(args.output_dir)
    os.makedirs(output_dir, exist_ok=True)

    clean_scene()
    setup_scene()
    objects = imported_objects(args.source_gltf)
    normalize_character(objects)
    skin = material('SERA_Skin', 0xD8A287, 0.80)
    mesh_count, source_triangles = style_base(objects, skin)
    add_sera_identity()

    blend_path = os.path.join(output_dir, 'sera-blender-prototype.blend')
    glb_path = os.path.join(output_dir, 'sera-blender-prototype.glb')
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        export_format='GLB',
        export_apply=False,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
    )
    render_views(output_dir)
    save_version(output_dir)

    armatures = [obj.name for obj in objects if obj.type == 'ARMATURE']
    metrics = {
        'prototype': 'SERA_QUATERNIUS_SUPERHERO_FEMALE_V3',
        'source': 'Quaternius Universal Base Characters / Superhero Female FullBody',
        'sourceMirror': 'aaroohhiiii/ggj',
        'sourceRevision': SOURCE_REV,
        'sourcePath': SOURCE_REL,
        'sourceLicense': 'CC0 1.0 Universal',
        'heightMeters': 1.68,
        'meshObjects': mesh_count,
        'sourceTriangles': source_triangles,
        'armatures': armatures,
        'runtimeSwitched': False,
    }
    with open(os.path.join(output_dir, 'sera-blender-metrics.json'), 'w', encoding='utf-8') as handle:
        json.dump(metrics, handle, indent=2)
    with open(os.path.join(output_dir, 'README.txt'), 'w', encoding='utf-8') as handle:
        handle.write('SERA prototype uses Quaternius Universal Base Characters Superhero Female FullBody (CC0) as a coherent anatomical/rigged base. Gameplay runtime remains unchanged.\n')
    print('SERA_QUATERNIUS_PROTOTYPE_OK', mesh_count, source_triangles, armatures)


if __name__ == '__main__':
    main()

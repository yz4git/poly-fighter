import math
import os

import bpy
from mathutils import Vector


def rgba(value):
    return (((value >> 16) & 255) / 255.0, ((value >> 8) & 255) / 255.0, (value & 255) / 255.0, 1.0)


def material(name, color, roughness=0.72, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = rgba(color)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = rgba(color)
        bsdf.inputs['Roughness'].default_value = roughness
        bsdf.inputs['Metallic'].default_value = metallic
    return mat


def add_material(obj, mat):
    obj.data.materials.append(mat)
    if hasattr(obj.data, 'polygons'):
        for poly in obj.data.polygons:
            poly.use_smooth = False
    return obj


def add_ico(name, loc, scale, mat, subdivisions=2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1.0, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return add_material(obj, mat)


def add_cone(name, loc, radius1, radius2, depth, scale_xy, mat, vertices=8, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius1, radius2=radius2, depth=depth, end_fill_type='NGON', location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale.x = scale_xy[0]
    obj.scale.y = scale_xy[1]
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return add_material(obj, mat)


def add_segment(name, a, b, radius_a, radius_b, mat, squash=(1.0, 1.0), vertices=7):
    a = Vector(a)
    b = Vector(b)
    delta = b - a
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius_a, radius2=radius_b, depth=delta.length, end_fill_type='NGON', location=(a + b) * 0.5)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = delta.to_track_quat('Z', 'Y')
    obj.scale.x = squash[0]
    obj.scale.y = squash[1]
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return add_material(obj, mat)


def add_box(name, loc, scale, mat, rotation=(0.0, 0.0, 0.0), bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        mod = obj.modifiers.new(name='FacetBevel', type='BEVEL')
        mod.width = bevel
        mod.segments = 1
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return add_material(obj, mat)


def add_wedge(name, verts, faces, mat):
    mesh = bpy.data.meshes.new(name + 'Mesh')
    mesh.from_pydata(verts, [], faces)
    mesh.update(calc_edges=True)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return add_material(obj, mat)


def clean_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for blocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(blocks):
            if getattr(block, 'users', 0) == 0:
                blocks.remove(block)


def point_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def setup_scene():
    scene = bpy.context.scene
    try:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except Exception:
        scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 640
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.film_transparent = False
    scene.world.color = (0.012, 0.014, 0.020)

    floor_mat = material('AuditFloorMat', 0x151820, 0.88)
    bpy.ops.mesh.primitive_plane_add(size=7.0, location=(0, 0, -0.005))
    floor = bpy.context.object
    floor.name = 'Ground'
    floor.data.materials.append(floor_mat)

    lights = [
        ('Key', (2.3, 3.0, 3.2), 900, 4.0),
        ('Fill', (-2.4, 1.8, 2.5), 500, 3.5),
        ('Rim', (0.0, -3.0, 2.8), 650, 3.0),
    ]
    for name, loc, energy, size in lights:
        bpy.ops.object.light_add(type='AREA', location=loc)
        light = bpy.context.object
        light.name = name
        light.data.energy = energy
        light.data.size = size
        point_at(light, (0, 0, 0.95))

    bpy.ops.object.camera_add(location=(0, 3.65, 1.02))
    cam = bpy.context.object
    cam.name = 'AuditCamera'
    cam.data.lens = 58
    point_at(cam, (0, 0, 0.88))
    scene.camera = cam
    return cam


def render_views(output_dir, cam=None):
    cam = cam or bpy.data.objects.get('AuditCamera')
    if cam is None:
        raise RuntimeError('AuditCamera missing')
    scene = bpy.context.scene
    views = {
        'front': ((0.0, 3.65, 1.02), (0.0, 0.0, 0.88)),
        'three-quarter': ((2.55, 2.85, 1.08), (0.0, 0.0, 0.88)),
        'side': ((3.70, 0.0, 1.02), (0.0, 0.0, 0.88)),
        'back': ((0.0, -3.65, 1.02), (0.0, 0.0, 0.88)),
    }
    for name, (loc, target) in views.items():
        cam.location = loc
        point_at(cam, target)
        scene.render.filepath = os.path.join(output_dir, f'sera-blender-{name}.png')
        bpy.ops.render.render(write_still=True)


def save_version(output_dir):
    with open(os.path.join(output_dir, 'blender-version.txt'), 'w', encoding='utf-8') as fp:
        fp.write(bpy.app.version_string + '\n')

"""Fit SERA's authored head pieces to the actual imported surface in world space."""
import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from sera_blender_helpers import SERA_FRONT_Y


def _center(obj):
    return sum((obj.matrix_world @ Vector(corner) for corner in obj.bound_box), Vector()) / 8


def _translate(obj, delta):
    obj.matrix_world = Matrix.Translation(delta) @ obj.matrix_world
    bpy.context.view_layer.update()


def fit_identity_to_source_head(body):
    if body is None or body.type != 'MESH':
        return
    bpy.context.view_layer.update()
    evaluated = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    try:
        points = [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
        faces = [list(poly.vertices) for poly in mesh.polygons]
        surface = BVHTree.FromPolygons(points, faces)
    finally:
        evaluated.to_mesh_clear()
    top = max(point.z for point in points)
    # T-pose hands can reach the neck's height. Use source head ownership so
    # those distant vertices never inflate the width used to place the eyes.
    head_groups = {group.index for group in body.vertex_groups if group.name.lower() == 'head'}
    head_indices = [vertex.index for vertex in body.data.vertices
                    if any(item.group in head_groups and item.weight > 0.35 for item in vertex.groups)]
    head = [points[index] for index in head_indices if index < len(points) and points[index].z > top - 0.18]
    if len(head) < 16:
        head = [point for point in points if point.z > top - 0.13 and abs(point.x) < 0.12]
    width = max(point.x for point in head) - min(point.x for point in head)
    center_x = (max(point.x for point in head) + min(point.x for point in head)) * 0.5
    center_y = (max(point.y for point in head) + min(point.y for point in head)) * 0.5

    def front_at(x, z):
        origin = Vector((x, SERA_FRONT_Y * 2.0, z))
        hit, _, _, _ = surface.ray_cast(origin, Vector((0, -SERA_FRONT_Y, 0)), 4.0)
        return hit

    # A closed ellipsoid covered the cheeks and eyes. Retain a faceted crown
    # and back, with an open face below the forehead instead of a solid helmet.
    cap = bpy.data.objects.get('SERA_HairCap')
    if cap:
        old = _center(cap)
        corners = [cap.matrix_world @ Vector(corner) for corner in cap.bound_box]
        half = Vector(tuple((max(p[axis] for p in corners) - min(p[axis] for p in corners)) * 0.5 for axis in range(3)))
        target = Vector((center_x, center_y - SERA_FRONT_Y * 0.004, top - 0.045))
        radius = Vector((width * 0.62, width * 0.65, 0.075))
        inverse = cap.matrix_world.inverted()
        for vertex in cap.data.vertices:
            relative = cap.matrix_world @ vertex.co - old
            point = Vector(tuple(target[i] + relative[i] / max(half[i], 1e-6) * radius[i] for i in range(3)))
            vertex.co = inverse @ point
        cap.data.update()
        bm = bmesh.new()
        bm.from_mesh(cap.data)
        remove = []
        for face in bm.faces:
            point = cap.matrix_world @ face.calc_center_median()
            if point.z < top - 0.041 and (point.y - center_y) * SERA_FRONT_Y > -0.010:
                remove.append(face)
        bmesh.ops.delete(bm, geom=remove, context='FACES')
        bm.to_mesh(cap.data)
        bm.free()
        cap.data.update()
        cap['seraHeadFit'] = 'SOURCE_SURFACE_OPEN_FACE_V1'

    width_scale = max(0.58, min(0.86, width / 0.15))
    hair_prefixes = ('SERA_Hairline', 'SERA_Fringe', 'SERA_SideHair', 'SERA_NapeHair',
                     'SERA_BackHair', 'SERA_TempleLock', 'SERA_Pony', 'SERA_HairTie')
    for obj in list(bpy.context.scene.objects):
        if obj.type != 'MESH' or not obj.name.startswith(hair_prefixes):
            continue
        inverse = obj.matrix_world.inverted()
        for vertex in obj.data.vertices:
            point = obj.matrix_world @ vertex.co
            point.x = center_x + (point.x - center_x) * width_scale
            vertex.co = inverse @ point
        obj.data.update()
        bpy.context.view_layer.update()
        if obj.name.startswith(('SERA_Hairline', 'SERA_Fringe', 'SERA_TempleLock')):
            center = _center(obj)
            hit = front_at(center.x, center.z)
            if hit is not None:
                corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
                half_depth = (max(p.y for p in corners) - min(p.y for p in corners)) * 0.5
                delta = Vector((0, hit.y + SERA_FRONT_Y * (half_depth + 0.001) - center.y, 0))
                _translate(obj, delta)

    features = {
        'SERA_BrowL': (-0.22, 0.050), 'SERA_BrowR': (0.22, 0.050),
        'SERA_EyeL': (-0.21, 0.062), 'SERA_EyeR': (0.21, 0.062),
        'SERA_NosePlane': (0.0, 0.085), 'SERA_Lip': (0.0, 0.107),
    }
    for name, (side, below_top) in features.items():
        obj = bpy.data.objects.get(name)
        if obj is None:
            continue
        center = _center(obj)
        hit = front_at(center_x + width * side, top - below_top)
        if hit is None:
            raise RuntimeError(f'SERA facial surface fit missed: {name} (width={width}, top={top})')
        corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
        half_depth = (max(p.y for p in corners) - min(p.y for p in corners)) * 0.5
        target = hit + Vector((0, SERA_FRONT_Y * (half_depth + 0.0008), 0))
        _translate(obj, target - center)
        obj['seraHeadFit'] = 'SOURCE_SURFACE_OPEN_FACE_V1'
    body['seraHeadFit'] = 'SOURCE_SURFACE_OPEN_FACE_V1'

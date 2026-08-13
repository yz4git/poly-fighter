import bpy
from mathutils import Vector
from sera_blender_helpers import material


def apply(body):
    inv = body.matrix_world.inverted()
    for vertex in body.data.vertices:
        p = body.matrix_world @ vertex.co
        z = p.z
        if z < 0.94:
            z2 = z * 1.037
        else:
            z2 = 0.975 + (z - 0.94) * (0.705 / 0.74)
        if z2 < 0.70:
            sx, sy = 0.89, 0.88
        elif z2 < 0.94:
            sx, sy = 0.92, 0.88
        elif z2 < 1.10:
            sx, sy = 0.82, 0.82
        elif z2 < 1.42:
            sx, sy = 0.90, 0.86
        else:
            sx, sy = 0.93, 0.92
        vertex.co = inv @ Vector((p.x * sx, p.y * sy, z2))
    body.data.update()
    bpy.context.view_layer.update()

    mats = [
        material('SERA_Skin', 0xD7A38A, 0.82),
        material('SERA_Blue', 0x2059C1, 0.74),
        material('SERA_BlueHi', 0x387AD3, 0.72),
        material('SERA_Black', 0x0D0E16, 0.82),
    ]
    body.data.materials.clear()
    for mat in mats:
        body.data.materials.append(mat)

    world = [body.matrix_world @ vertex.co for vertex in body.data.vertices]
    for poly in body.data.polygons:
        center = Vector((0, 0, 0))
        for index in poly.vertices:
            center += world[index]
        center /= len(poly.vertices)
        x, y, z = center.x, center.y, center.z
        ax = abs(x)
        slot = 0
        if z < 0.69:
            slot = 3
        elif 0.84 <= z < 0.955 and ax < 0.24:
            slot = 1
        elif 1.105 <= z < 1.405:
            if ax > 0.49:
                slot = 0
            elif ax > 0.29:
                slot = 3
            elif ax > 0.19:
                slot = 0
            elif y > 0.015 and ax < 0.075:
                slot = 3
            elif ax > 0.115:
                slot = 2
            else:
                slot = 1
        poly.material_index = slot
        poly.use_smooth = False
    return mats

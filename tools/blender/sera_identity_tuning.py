import bpy
from sera_blender_helpers import SERA_FRONT_Y


def apply():
    cap = bpy.data.objects.get('SERA_HairCap')
    if cap:
        # The ico sphere is only a crown/back-hair volume. Keep its front edge
        # safely behind the source face; explicit hairline/fringe geometry covers
        # the forehead. This prevents the cap from swallowing the face in front.
        cap.location.y = -0.040 * SERA_FRONT_Y
        cap.location.z = 1.602
        cap.scale.x = 0.98
        cap.scale.y = 0.78
        cap.scale.z = 1.05

    for name in ('SERA_HairlineL', 'SERA_HairlineR'):
        obj = bpy.data.objects.get(name)
        if obj:
            obj.scale.x *= 1.02
            obj.scale.y *= 1.04
            obj.scale.z *= 1.02
    for name in ('SERA_FringeRootL', 'SERA_FringeRootR'):
        obj = bpy.data.objects.get(name)
        if obj:
            obj.scale.x *= 1.06
            obj.scale.y *= 0.94
            obj.scale.z *= 0.96

    for name in ('SERA_FrontSkirt', 'SERA_LeftSkirt', 'SERA_RightSkirt'):
        obj = bpy.data.objects.get(name)
        if not obj:
            continue
        top = max(vertex.co.z for vertex in obj.data.vertices)
        for vertex in obj.data.vertices:
            if vertex.co.z < top:
                vertex.co.z = top - (top - vertex.co.z) * 0.42
            vertex.co.x *= 0.68
            vertex.co.y *= 0.58
        obj.data.update()

    for name in ('SERA_Guard_l', 'SERA_Guard_r'):
        obj = bpy.data.objects.get(name)
        if obj:
            obj.scale.x *= 0.88
            obj.scale.y *= 0.88
            obj.scale.z *= 0.90

    for name in ('SERA_Shin_l', 'SERA_Shin_r'):
        obj = bpy.data.objects.get(name)
        if obj:
            obj.scale.x *= 0.66
            obj.scale.y *= 0.62
            obj.scale.z *= 0.82

    for name in ('SERA_BootFoot_l', 'SERA_BootFoot_r'):
        obj = bpy.data.objects.get(name)
        if obj:
            obj.scale.x *= 0.82
            obj.scale.y *= 0.84
            obj.scale.z *= 0.90

    for name in ('SERA_SideHairL', 'SERA_SideHairR', 'SERA_NapeHairL', 'SERA_NapeHairR'):
        obj = bpy.data.objects.get(name)
        if obj:
            obj.scale.x *= 0.92
            obj.scale.y *= 0.90

    tie = bpy.data.objects.get('SERA_HairTie')
    if tie:
        tie.location.z += 0.010
        tie.scale.x *= 1.08
        tie.scale.y *= 0.92
    root = bpy.data.objects.get('SERA_PonyRoot')
    if root:
        root.location.z += 0.008
        root.scale.x *= 1.06
        root.scale.y *= 1.02
        root.scale.z *= 0.96
    pony1 = bpy.data.objects.get('SERA_Pony1')
    if pony1:
        pony1.scale.x *= 0.92
        pony1.scale.y *= 0.90
        pony1.scale.z *= 0.94
    pony2 = bpy.data.objects.get('SERA_Pony2')
    if pony2:
        pony2.scale.x *= 0.82
        pony2.scale.y *= 0.82
        pony2.scale.z *= 0.90
    pony3 = bpy.data.objects.get('SERA_Pony3')
    if pony3:
        pony3.scale.x *= 0.74
        pony3.scale.y *= 0.74
        pony3.scale.z *= 0.84

import bpy
from sera_blender_helpers import SERA_FRONT_Y


def apply():
    cap = bpy.data.objects.get('SERA_HairCap')
    if cap:
        # Keep the crown fully covered without inflating into a spherical helmet.
        # Slightly taller/deeper than wide matches SERA's high ponytail head shape.
        cap.location.y = 0.004 * SERA_FRONT_Y
        cap.location.z = 1.596
        cap.scale.x = 1.02
        cap.scale.y = 1.07
        cap.scale.z = 1.10

    # Blend the new hairline/fringe root wedges into one coherent forehead mass.
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

    # Keep the waist panels as short, thin graphic shapes around the upper thigh.
    # They should frame the hips without reading as knee-length armor.
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

    # The silver guards stay readable, but should hug the source forearms.
    for name in ('SERA_Guard_l', 'SERA_Guard_r'):
        obj = bpy.data.objects.get(name)
        if obj:
            obj.scale.x *= 0.88
            obj.scale.y *= 0.88
            obj.scale.z *= 0.90

    # Shin accents are deliberately slimmer than the earlier armor-like shells.
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

    # Keep the side masses close to the skull so they read as layered hair, not
    # separate armor-like flaps.
    for name in ('SERA_SideHairL', 'SERA_SideHairR', 'SERA_NapeHairL', 'SERA_NapeHairR'):
        obj = bpy.data.objects.get(name)
        if obj:
            obj.scale.x *= 0.92
            obj.scale.y *= 0.90

    # Taper the ponytail while preserving its high, broad root.
    root = bpy.data.objects.get('SERA_PonyRoot')
    if root:
        root.scale.x *= 0.98
        root.scale.y *= 0.96
    for name in ('SERA_Pony1', 'SERA_Pony2', 'SERA_Pony3'):
        obj = bpy.data.objects.get(name)
        if obj:
            obj.scale.x *= 0.86
            obj.scale.y *= 0.86

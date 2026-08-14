import bpy
from sera_blender_helpers import SERA_FRONT_Y


def apply():
    cap = bpy.data.objects.get('SERA_HairCap')
    if cap:
        # Keep the coherent cap centered over the skull and bias it slightly
        # toward the face side. The previous pass still left too much scalp
        # exposed at the crown/forehead transition in the front audit view.
        cap.location.y = 0.010 * SERA_FRONT_Y
        cap.location.z = 1.598
        cap.scale.x = 1.06
        cap.scale.y = 1.08
        cap.scale.z = 1.04

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

    # Taper the ponytail mass without shortening the recognizable high-tail arc.
    for name in ('SERA_Pony1', 'SERA_Pony2', 'SERA_Pony3'):
        obj = bpy.data.objects.get(name)
        if obj:
            obj.scale.x *= 0.88
            obj.scale.y *= 0.88

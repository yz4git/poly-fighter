import bpy


def apply():
    cap = bpy.data.objects.get('SERA_HairCap')
    if cap:
        cap.location.y -= 0.035
        cap.location.z += 0.020
        cap.scale.y = 0.68
        cap.scale.z = 0.84

    # Keep the waist panels as short, thin graphic shapes around the upper thigh.
    # The previous pass read as knee-length armor in the turnaround renders.
    for name in ('SERA_FrontSkirt', 'SERA_LeftSkirt', 'SERA_RightSkirt'):
        obj = bpy.data.objects.get(name)
        if not obj:
            continue
        top = max(vertex.co.z for vertex in obj.data.vertices)
        for vertex in obj.data.vertices:
            if vertex.co.z < top:
                vertex.co.z = top - (top - vertex.co.z) * 0.52
            vertex.co.x *= 0.76
            vertex.co.y *= 0.68
        obj.data.update()

    # The guards should follow the limbs instead of dominating their silhouette.
    for name in ('SERA_Guard_l', 'SERA_Guard_r'):
        obj = bpy.data.objects.get(name)
        if obj:
            obj.scale.x *= 0.78
            obj.scale.y *= 0.78
            obj.scale.z *= 0.82

    for name in ('SERA_Shin_l', 'SERA_Shin_r'):
        obj = bpy.data.objects.get(name)
        if obj:
            obj.scale.x *= 0.76
            obj.scale.y *= 0.76
            obj.scale.z *= 0.86

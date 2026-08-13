import bpy


def apply():
    cap = bpy.data.objects.get('SERA_HairCap')
    if cap:
        cap.location.y -= 0.035
        cap.location.z += 0.020
        cap.scale.y = 0.72
        cap.scale.z = 0.82

    for name in ('SERA_FrontSkirt', 'SERA_LeftSkirt', 'SERA_RightSkirt'):
        obj = bpy.data.objects.get(name)
        if not obj:
            continue
        top = max(vertex.co.z for vertex in obj.data.vertices)
        for vertex in obj.data.vertices:
            if vertex.co.z < top:
                vertex.co.z = top - (top - vertex.co.z) * 0.68
            vertex.co.x *= 0.88
            vertex.co.y *= 0.82
        obj.data.update()

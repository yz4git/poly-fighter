import bpy
from sera_blender_helpers import SERA_FRONT_Y


def _scale(name, x=1.0, y=1.0, z=1.0):
    obj = bpy.data.objects.get(name)
    if not obj:
        return None
    obj.scale.x *= x
    obj.scale.y *= y
    obj.scale.z *= z
    return obj


def _move_depth(obj, amount):
    if obj:
        obj.location.y += amount * SERA_FRONT_Y


def apply():
    # Model Quality Reconstruction Pass V1
    # ------------------------------------
    # The crown is a backing volume only. Pull it farther behind the face and
    # reduce its lateral/depth mass so the forehead, eyes and jaw remain readable
    # in front and 3/4 views instead of being swallowed by a helmet-like shell.
    cap = bpy.data.objects.get('SERA_HairCap')
    if cap:
        cap.location.y = -0.052 * SERA_FRONT_Y
        cap.location.z = 1.598
        cap.scale.x = 0.91
        cap.scale.y = 0.68
        cap.scale.z = 1.00

    for name in ('SERA_HairlineL', 'SERA_HairlineR'):
        obj = _scale(name, 0.95, 0.82, 0.94)
        _move_depth(obj, -0.002)
    for name in ('SERA_FringeRootL', 'SERA_FringeRootR'):
        obj = _scale(name, 0.92, 0.78, 0.90)
        _move_depth(obj, -0.0025)

    # Keep the fringe as separate readable tufts, but make every blade thinner
    # in depth and a little shorter. The previous broad blades merged into a dark
    # wall over the face in MODEL VIEW.
    for name in (
        'SERA_FringeCenter', 'SERA_FringeInnerL', 'SERA_FringeInnerR',
        'SERA_FringeL', 'SERA_FringeR', 'SERA_FringeSideL', 'SERA_FringeSideR',
        'SERA_FringeOuterL', 'SERA_FringeOuterR',
    ):
        obj = _scale(name, 0.88, 0.72, 0.90)
        _move_depth(obj, -0.002)

    for name in ('SERA_TempleLockL', 'SERA_TempleLockR'):
        obj = _scale(name, 0.82, 0.80, 0.94)
        _move_depth(obj, -0.001)

    for name in ('SERA_SideHairL', 'SERA_SideHairR', 'SERA_NapeHairL', 'SERA_NapeHairR'):
        obj = _scale(name, 0.84, 0.86, 0.96)
        _move_depth(obj, -0.002)

    for name in ('SERA_BackHairCenter', 'SERA_BackHairL', 'SERA_BackHairR'):
        _scale(name, 0.90, 0.92, 0.96)

    # Ponytail: reduce the two fan plates and let the three main masses carry the
    # silhouette. This reads as root -> body -> tip rather than disconnected fins.
    tie = _scale('SERA_HairTie', 1.02, 0.88, 0.96)
    if tie:
        tie.location.z += 0.008
    root = _scale('SERA_PonyRoot', 0.94, 1.08, 0.92)
    if root:
        root.location.z += 0.006
    _scale('SERA_PonyFanL', 0.58, 0.78, 0.94)
    _scale('SERA_PonyFanR', 0.58, 0.78, 0.94)
    _scale('SERA_Pony1', 0.88, 1.05, 0.92)
    _scale('SERA_Pony2', 0.84, 1.08, 0.90)
    _scale('SERA_Pony3', 0.80, 1.05, 0.86)

    # Face readability pass. Reduce flat overlay noise, while giving the nose a
    # little more depth so the 3/4 and side silhouettes have a readable bridge.
    for name in ('SERA_BrowL', 'SERA_BrowR', 'SERA_EyeL', 'SERA_EyeR'):
        obj = _scale(name, 0.88, 0.75, 0.86)
        _move_depth(obj, 0.002)
    nose = _scale('SERA_NosePlane', 1.12, 1.65, 0.90)
    _move_depth(nose, 0.003)
    lip = _scale('SERA_Lip', 0.88, 0.78, 0.86)
    _move_depth(lip, 0.0015)

    # Compress skirt panels toward the pelvis so their roots read as one costume
    # system rather than three unrelated hanging cards.
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

    # Armor cohesion: make guards less plate-like by retaining more depth than
    # width. They remain rigid bone-follow pieces, but visually wrap the limb.
    for name in ('SERA_Guard_l', 'SERA_Guard_r'):
        _scale(name, 0.80, 0.95, 0.88)

    for name in ('SERA_Shin_l', 'SERA_Shin_r'):
        _scale(name, 0.72, 0.92, 0.86)

    for name in ('SERA_BootFoot_l', 'SERA_BootFoot_r'):
        _scale(name, 0.82, 0.94, 0.90)

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


def _hand_group_side(name):
    lower = name.lower()
    for side in ('l', 'r'):
        if lower == 'hand_' + side:
            return side
        if lower.endswith('_' + side) and lower.startswith(('thumb_', 'index_', 'middle_', 'ring_', 'pinky_')):
            return side
    return None


def _compact_source_hands():
    """Pre-form the T-pose fingers into one broad compact fighting fist mass.

    The previous V16 pass was intentionally conservative and barely changed the
    real WebGL silhouette. V17 keeps the wrist/proximal palm intact but shortens
    and clusters the distal finger vertices much more strongly before the later
    runtime hand compaction. The two-stage fold is still topology-preserving and
    leaves enough transverse width for a readable knuckle block instead of a
    needle-like claw.
    """
    body = bpy.data.objects.get('Superhero_Female')
    if not body or body.type != 'MESH':
        return

    groups_by_side = {'l': set(), 'r': set()}
    for group in body.vertex_groups:
        side = _hand_group_side(group.name)
        if side:
            groups_by_side[side].add(group.index)

    changed_sides = []
    for side, group_indices in groups_by_side.items():
        if not group_indices:
            continue
        selected = []
        for vertex in body.data.vertices:
            weight = sum(membership.weight for membership in vertex.groups if membership.group in group_indices)
            if weight >= 0.15:
                selected.append((vertex, min(1.0, weight)))
        if len(selected) < 8:
            continue

        root_abs = min(abs(vertex.co.x) for vertex, _ in selected)
        tip_abs = max(abs(vertex.co.x) for vertex, _ in selected)
        span = tip_abs - root_abs
        if span <= 1e-6:
            continue

        proximal = [
            (vertex, weight)
            for vertex, weight in selected
            if (abs(vertex.co.x) - root_abs) / span <= 0.50
        ] or selected
        total_weight = sum(weight for _, weight in proximal)
        center_y = sum(vertex.co.y * weight for vertex, weight in proximal) / max(1e-6, total_weight)
        center_z = sum(vertex.co.z * weight for vertex, weight in proximal) / max(1e-6, total_weight)

        sign = -1.0 if sum(vertex.co.x for vertex, _ in selected) < 0.0 else 1.0
        for vertex, ownership in selected:
            t = max(0.0, min(1.0, (abs(vertex.co.x) - root_abs) / span))
            # Protect the wrist and palm root, then rapidly fold the distal half
            # inward. Cubic falloff keeps the boundary smooth while producing a
            # visibly shorter finger envelope at the actual gameplay scale.
            distal = max(0.0, (t - 0.14) / 0.86)
            distal = distal * distal * (0.55 + 0.45 * distal) * ownership
            length_retain = 1.0 - 0.58 * distal
            radial_retain = 1.0 - 0.42 * distal
            distance = abs(vertex.co.x) - root_abs
            vertex.co.x = sign * (root_abs + distance * length_retain)
            vertex.co.y = center_y + (vertex.co.y - center_y) * radial_retain
            vertex.co.z = center_z + (vertex.co.z - center_z) * radial_retain
        changed_sides.append(side)

    if changed_sides:
        body.data.update()
        body['seraSourceHandPose'] = 'PRECOMPACT_KNUCKLE_MASS_V17'
        body['seraSourceHandPoseSides'] = ','.join(sorted(changed_sides))


def apply():
    # Model Quality Reconstruction Pass V2 + V17 fist pre-form
    # Geometry now carries the main silhouette. Tuning is intentionally modest:
    # it should polish the authored forms, not squash them into corrective cards.
    cap = bpy.data.objects.get('SERA_HairCap')
    if cap:
        cap.location.y = -0.020 * SERA_FRONT_Y
        cap.location.z = 1.603
        cap.scale.x = 0.98
        cap.scale.y = 0.94
        cap.scale.z = 0.98

    for name in ('SERA_HairlineL', 'SERA_HairlineR'):
        obj = _scale(name, 0.98, 0.94, 0.98)
        _move_depth(obj, -0.001)
    for name in ('SERA_FringeRootL', 'SERA_FringeRootR'):
        obj = _scale(name, 0.97, 0.92, 0.97)
        _move_depth(obj, -0.001)

    for name in (
        'SERA_FringeCenter', 'SERA_FringeInnerL', 'SERA_FringeInnerR',
        'SERA_FringeL', 'SERA_FringeR', 'SERA_FringeSideL', 'SERA_FringeSideR',
        'SERA_FringeOuterL', 'SERA_FringeOuterR',
    ):
        obj = _scale(name, 0.96, 0.90, 0.96)
        _move_depth(obj, -0.001)

    for name in ('SERA_TempleLockL', 'SERA_TempleLockR'):
        _scale(name, 0.96, 0.92, 0.98)

    for name in ('SERA_SideHairL', 'SERA_SideHairR', 'SERA_NapeHairL', 'SERA_NapeHairR'):
        obj = _scale(name, 0.96, 0.94, 0.98)
        _move_depth(obj, -0.001)

    for name in ('SERA_BackHairCenter', 'SERA_BackHairL', 'SERA_BackHairR'):
        _scale(name, 0.96, 0.96, 0.98)

    # The V2 ponytail is already narrow and curved; preserve those authored
    # proportions and only slightly reduce the decorative side wisps.
    _scale('SERA_HairTie', 0.98, 0.96, 0.98)
    _scale('SERA_PonyRoot', 0.98, 1.00, 0.98)
    _scale('SERA_PonyFanL', 0.86, 0.92, 0.94)
    _scale('SERA_PonyFanR', 0.86, 0.92, 0.94)
    _scale('SERA_Pony1', 0.98, 1.00, 0.98)
    _scale('SERA_Pony2', 0.96, 1.00, 0.96)
    _scale('SERA_Pony3', 0.94, 0.98, 0.94)

    # Face accents should be readable without becoming separate floating plates.
    for name in ('SERA_BrowL', 'SERA_BrowR', 'SERA_EyeL', 'SERA_EyeR'):
        obj = _scale(name, 0.96, 0.90, 0.94)
        _move_depth(obj, 0.001)
    nose = _scale('SERA_NosePlane', 1.02, 1.10, 0.98)
    _move_depth(nose, 0.0015)
    lip = _scale('SERA_Lip', 0.96, 0.92, 0.94)
    _move_depth(lip, 0.001)

    # Keep the new short skirt panels connected to the pelvis. Only a mild taper
    # remains; the previous 42% length collapse made them read as clipped cards.
    for name in ('SERA_FrontSkirt', 'SERA_LeftSkirt', 'SERA_RightSkirt'):
        obj = bpy.data.objects.get(name)
        if not obj:
            continue
        top = max(vertex.co.z for vertex in obj.data.vertices)
        for vertex in obj.data.vertices:
            if vertex.co.z < top:
                vertex.co.z = top - (top - vertex.co.z) * 0.88
            vertex.co.x *= 0.92
            vertex.co.y *= 0.88
        obj.data.update()

    # The V2 authored guards are already short, centered tubes around the limb.
    # Retain their depth so they read as wrapped armor rather than flat plates.
    for name in ('SERA_Guard_l', 'SERA_Guard_r'):
        _scale(name, 0.96, 1.00, 0.98)

    for name in ('SERA_Shin_l', 'SERA_Shin_r'):
        _scale(name, 0.94, 1.00, 0.96)

    for name in ('SERA_BootFoot_l', 'SERA_BootFoot_r'):
        _scale(name, 0.96, 0.98, 0.98)

    _compact_source_hands()

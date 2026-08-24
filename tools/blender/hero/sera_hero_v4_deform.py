import math

from sera_blender_helpers import SERA_FRONT_Y

V4_SCHEMA_VERSION = 'SERA_HERO_PARAMETER_SPACE_V2_128D_LOCAL_DEFORM'
V4_PARAMETER_COUNT = 128


def _face_defs(search):
    D = search.D
    # The source head is no longer treated as four broad scale bands only.
    # These radial front-surface fields act directly on source-face vertices.
    # center_x/radius_x are normalized by character height; bilateral fields
    # use abs(x) so left/right cheek and jaw regions stay symmetric.
    return [
        D('face_local_forehead_width', 'face', 'body_face_local_scale', .16, axis='x', center_x=0.0, center_z=.962, radius_x=.075, radius_z=.050, front_min=.43),
        D('face_local_forehead_depth', 'face', 'body_face_local_shift', .016, axis='y', center_x=0.0, center_z=.962, radius_x=.074, radius_z=.052, front_min=.48),
        D('face_local_brow_ridge_depth', 'face', 'body_face_local_shift', .014, axis='y', center_x=0.0, center_z=.936, radius_x=.060, radius_z=.032, front_min=.55),
        D('face_local_cheekbone_width', 'face', 'body_face_local_scale', .18, axis='x', center_x=.040, center_z=.910, radius_x=.040, radius_z=.044, bilateral=True, front_min=.50),
        D('face_local_cheekbone_depth', 'face', 'body_face_local_shift', .016, axis='y', center_x=.040, center_z=.910, radius_x=.040, radius_z=.044, bilateral=True, front_min=.52),
        D('face_local_cheek_hollow', 'face', 'body_face_local_shift', .013, axis='y', center_x=.046, center_z=.887, radius_x=.040, radius_z=.035, bilateral=True, front_min=.52),
        D('face_local_jaw_angle_width', 'face', 'body_face_local_scale', .20, axis='x', center_x=.047, center_z=.865, radius_x=.042, radius_z=.040, bilateral=True, front_min=.40),
        D('face_local_jaw_angle_depth', 'face', 'body_face_local_shift', .016, axis='y', center_x=.045, center_z=.865, radius_x=.044, radius_z=.040, bilateral=True, front_min=.44),
        D('face_local_chin_width', 'face', 'body_face_local_scale', .20, axis='x', center_x=0.0, center_z=.850, radius_x=.038, radius_z=.032, front_min=.50),
        D('face_local_chin_projection', 'face', 'body_face_local_shift', .018, axis='y', center_x=0.0, center_z=.850, radius_x=.035, radius_z=.034, front_min=.58),
        D('face_local_chin_height', 'face', 'body_face_local_shift', .014, axis='z', center_x=0.0, center_z=.848, radius_x=.040, radius_z=.035, front_min=.48),
        D('face_local_nose_bridge_projection', 'face', 'body_face_local_shift', .014, axis='y', center_x=0.0, center_z=.912, radius_x=.021, radius_z=.048, front_min=.66),
        D('face_local_nose_tip_projection', 'face', 'body_face_local_shift', .018, axis='y', center_x=0.0, center_z=.887, radius_x=.024, radius_z=.027, front_min=.70),
        D('face_local_nose_tip_width', 'face', 'body_face_local_scale', .22, axis='x', center_x=0.0, center_z=.887, radius_x=.026, radius_z=.028, front_min=.66),
        D('face_local_muzzle_projection', 'face', 'body_face_local_shift', .014, axis='y', center_x=0.0, center_z=.870, radius_x=.045, radius_z=.030, front_min=.60),
        D('face_local_mouth_chin_transition', 'face', 'body_face_local_shift', .012, axis='y', center_x=0.0, center_z=.858, radius_x=.042, radius_z=.027, front_min=.55),
    ]


def _hair_defs(search):
    D = search.D
    # Existing V3 controls still provide broad cap/fringe/side/ponytail moves.
    # V4 adds strand and rear-volume controls so the optimizer can change the
    # hairstyle silhouette without scaling every fringe or pony segment alike.
    return [
        D('hair_strand_center_length', 'hair', 'object_scale', .30, names=('SERA_FringeCenter',), axis='z'),
        D('hair_strand_center_forward', 'hair', 'object_shift', .016, names=('SERA_FringeCenter',), axis='y'),
        D('hair_strand_inner_l_length', 'hair', 'object_scale', .30, names=('SERA_FringeInnerL',), axis='z'),
        D('hair_strand_inner_r_length', 'hair', 'object_scale', .30, names=('SERA_FringeInnerR',), axis='z'),
        D('hair_strand_outer_l_length', 'hair', 'object_scale', .30, names=('SERA_FringeOuterL',), axis='z'),
        D('hair_strand_outer_r_length', 'hair', 'object_scale', .30, names=('SERA_FringeOuterR',), axis='z'),
        D('hair_side_l_length_independent', 'hair', 'object_scale', .30, names=('SERA_SideHairL',), axis='z'),
        D('hair_side_r_length_independent', 'hair', 'object_scale', .30, names=('SERA_SideHairR',), axis='z'),
        D('hair_side_l_spread_independent', 'hair', 'object_shift', .018, names=('SERA_SideHairL', 'SERA_TempleLockL'), axis='x'),
        D('hair_side_r_spread_independent', 'hair', 'object_shift', .018, names=('SERA_SideHairR', 'SERA_TempleLockR'), axis='x'),
        D('hair_back_center_length', 'hair', 'object_scale', .30, names=('SERA_BackHairCenter',), axis='z'),
        D('hair_back_side_length', 'hair', 'object_scale', .30, names=('SERA_BackHairL', 'SERA_BackHairR'), axis='z'),
        D('hair_back_depth', 'hair', 'object_shift', .018, names=('SERA_BackHairCenter', 'SERA_BackHairL', 'SERA_BackHairR'), axis='y'),
        D('hair_pony_fan_width', 'hair', 'object_scale', .28, names=('SERA_PonyFanL', 'SERA_PonyFanR'), axis='x'),
        D('hair_pony_mid_sweep', 'hair', 'object_shift', .022, names=('SERA_PonyFanL', 'SERA_PonyFanR', 'SERA_Pony2', 'SERA_Pony3'), axis='x'),
        D('hair_pony_tip_length_independent', 'hair', 'object_scale', .32, names=('SERA_Pony3',), axis='z'),
    ]


def _smooth01(x):
    x = max(0.0, min(1.0, float(x)))
    return x * x * (3.0 - 2.0 * x)


def _face_weight(vertex, definition, bounds):
    h = max(1e-6, bounds['maxZ'] - bounds['minZ'])
    cx = (bounds['minX'] + bounds['maxX']) * .5
    xn = (vertex.co.x - cx) / h
    zn = (vertex.co.z - bounds['minZ']) / h
    center_x = float(definition.get('center_x', 0.0))
    if definition.get('bilateral'):
        dx = (abs(xn) - center_x) / max(1e-6, float(definition.get('radius_x', .05)))
    else:
        dx = (xn - center_x) / max(1e-6, float(definition.get('radius_x', .05)))
    dz = (zn - float(definition.get('center_z', .90))) / max(1e-6, float(definition.get('radius_z', .05)))
    r2 = dx * dx + dz * dz
    if r2 >= 1.0:
        return 0.0
    radial = _smooth01(1.0 - math.sqrt(max(0.0, r2)))

    # Only touch the facial shell, never the back of the skull. SERA_FRONT_Y
    # converts the imported -Y facing convention into increasing front depth.
    f0 = bounds['minY'] * SERA_FRONT_Y
    f1 = bounds['maxY'] * SERA_FRONT_Y
    back, front = min(f0, f1), max(f0, f1)
    frontness = (vertex.co.y * SERA_FRONT_Y - back) / max(1e-6, front - back)
    front_gate = _smooth01((frontness - float(definition.get('front_min', .48))) / max(1e-6, 1.0 - float(definition.get('front_min', .48))))
    return radial * front_gate


def _apply_face_local(body, definition, value, bounds):
    h = max(1e-6, bounds['maxZ'] - bounds['minZ'])
    cx = (bounds['minX'] + bounds['maxX']) * .5
    kind = definition['kind']
    axis = definition.get('axis', 'y')
    amount = float(definition['amount'])
    for vertex in body.data.vertices:
        weight = _face_weight(vertex, definition, bounds)
        if weight <= 1e-8:
            continue
        if kind == 'body_face_local_scale':
            if axis != 'x':
                raise RuntimeError('V4 local face scale currently supports x only')
            factor = max(.70, 1.0 + float(value) * amount * weight)
            vertex.co.x = cx + (vertex.co.x - cx) * factor
        elif kind == 'body_face_local_shift':
            delta = float(value) * amount * h * weight
            if axis == 'y':
                vertex.co.y += SERA_FRONT_Y * delta
            elif axis == 'z':
                vertex.co.z += delta
            elif axis == 'x':
                vertex.co.x += delta
            else:
                raise RuntimeError('unsupported V4 local face shift axis ' + str(axis))
        else:
            raise RuntimeError('unsupported V4 local face kind ' + str(kind))


def _world_shift(obj, axis, amount):
    matrix = obj.matrix_world.copy()
    index = {'x': 0, 'y': 1, 'z': 2}[axis]
    matrix.translation[index] += amount
    obj.matrix_world = matrix


def install(search):
    """Patch the stable V3 search engine with V4 geometry semantics.

    Keeping the search loop itself untouched makes the new representation easy
    to compare/rollback while all candidate acceptance still goes through the
    same real four-view Reference objective and regression guard.
    """
    if getattr(search, '_sera_v4_local_deform_installed', False):
        return search

    base_parameter_defs = search.parameter_defs
    base_apply_body = search._apply_body
    base_apply_object = search._apply_object

    def parameter_defs():
        parameters = list(base_parameter_defs())
        parameters.extend(_face_defs(search))
        parameters.extend(_hair_defs(search))
        if len(parameters) != V4_PARAMETER_COUNT:
            raise RuntimeError(f'SERA V4 parameter schema drifted: expected {V4_PARAMETER_COUNT}, got {len(parameters)}')
        return parameters

    def apply_body(body, definition, value, bounds):
        if definition['kind'].startswith('body_face_local_'):
            return _apply_face_local(body, definition, value, bounds)
        return base_apply_body(body, definition, value, bounds)

    def apply_object(definition, value):
        # Bone-parented overlays must retain world-axis search semantics. Blender
        # object.location becomes bone-local after parenting, so shifts are
        # applied through matrix_world instead of silently changing direction.
        kind = definition['kind']
        if kind in ('object_shift', 'object_pair_spread'):
            import bpy
            objects = [bpy.data.objects.get(name) for name in definition.get('names', ()) if bpy.data.objects.get(name)]
            axis = definition.get('axis', 'x')
            amount = float(value) * float(definition['amount'])
            for obj in objects:
                delta = amount
                if kind == 'object_pair_spread':
                    delta *= -1.0 if obj.matrix_world.translation.x < 0 else 1.0
                _world_shift(obj, axis, delta)
            return
        return base_apply_object(definition, value)

    search.parameter_defs = parameter_defs
    search._apply_body = apply_body
    search._apply_object = apply_object
    search.SCHEMA_VERSION = V4_SCHEMA_VERSION
    search._sera_v4_local_deform_installed = True
    return search

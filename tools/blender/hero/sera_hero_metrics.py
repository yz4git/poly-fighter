import math


def _local_bounds(vertices):
    xs = [v.co.x for v in vertices]
    ys = [v.co.y for v in vertices]
    zs = [v.co.z for v in vertices]
    return {
        'minX': min(xs), 'maxX': max(xs),
        'minY': min(ys), 'maxY': max(ys),
        'minZ': min(zs), 'maxZ': max(zs),
    }


def _world_points(body):
    matrix = body.matrix_world
    return [matrix @ vertex.co for vertex in body.data.vertices]


def _world_bounds(points):
    xs = [p.x for p in points]
    ys = [p.y for p in points]
    zs = [p.z for p in points]
    return {
        'minX': min(xs), 'maxX': max(xs),
        'minY': min(ys), 'maxY': max(ys),
        'minZ': min(zs), 'maxZ': max(zs),
    }


def _band_points(points, z0, z1, bounds):
    span = max(1e-6, bounds['maxZ'] - bounds['minZ'])
    lo = bounds['minZ'] + span * z0
    hi = bounds['minZ'] + span * z1
    selected = [p for p in points if lo <= p.z <= hi]
    return selected if selected else list(points)


def _percentile(values, fraction):
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, int(round((len(ordered) - 1) * fraction))))
    return ordered[index]


def _extent(points, axis, trim=0.0):
    values = [getattr(p, axis) for p in points]
    if not values:
        return 0.0
    if trim <= 0:
        return max(values) - min(values)
    return _percentile(values, 1.0 - trim) - _percentile(values, trim)


def measure_body(body):
    """Measure the normalized character in world-space meters.

    `normalize_character()` scales a parent Empty rather than rewriting mesh
    coordinates, so world-space measurement is mandatory. Using local vertex
    values here would silently compare source-file units with meter targets.
    """
    points = _world_points(body)
    b = _world_bounds(points)
    height = max(1e-6, b['maxZ'] - b['minZ'])

    shoulder = _band_points(points, 0.68, 0.79, b)
    waist = _band_points(points, 0.53, 0.61, b)
    hips = _band_points(points, 0.44, 0.53, b)
    torso = _band_points(points, 0.55, 0.76, b)
    head = _band_points(points, 0.845, 1.0, b)

    return {
        'height': height,
        'shoulderWidth': _extent(shoulder, 'x', 0.12),
        'waistWidth': _extent(waist, 'x', 0.10),
        'hipWidth': _extent(hips, 'x', 0.10),
        'torsoDepth': _extent(torso, 'y', 0.08),
        'headWidth': _extent(head, 'x', 0.05),
        'headDepth': _extent(head, 'y', 0.05),
        'headHeightRatio': _extent(head, 'z') / height,
    }


def score(measurements, spec):
    targets = spec['targets']
    weights = spec.get('weights', {})
    errors = {}
    weighted_error = 0.0
    total_weight = 0.0
    for key, target in targets.items():
        actual = measurements.get(key)
        if actual is None or target == 0:
            continue
        relative = abs(actual - target) / abs(target)
        weight = float(weights.get(key, 1.0))
        errors[key] = {
            'actual': actual,
            'target': target,
            'relativeError': relative,
        }
        weighted_error += relative * weight
        total_weight += weight
    mean_error = weighted_error / max(total_weight, 1e-6)
    quality = max(0.0, 1.0 - mean_error)
    return quality, errors


def _smoothstep(edge0, edge1, x):
    if edge0 == edge1:
        return 1.0
    t = max(0.0, min(1.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def _band_weight(t, lo, hi, feather=0.035):
    return _smoothstep(lo - feather, lo + feather, t) * (1.0 - _smoothstep(hi - feather, hi + feather, t))


def _scale_region(body, z0, z1, sx=1.0, sy=1.0, sz=1.0, center_z=None, feather=0.035):
    """Apply a soft local-space deformation.

    The source normalization is uniform, so scale ratios derived from
    world-space meter measurements are valid for local-space vertex edits.
    """
    vertices = body.data.vertices
    b = _local_bounds(vertices)
    span = max(1e-6, b['maxZ'] - b['minZ'])
    cx = (b['minX'] + b['maxX']) * 0.5
    cy = (b['minY'] + b['maxY']) * 0.5
    cz = b['minZ'] + span * ((z0 + z1) * 0.5 if center_z is None else center_z)
    for vertex in vertices:
        t = (vertex.co.z - b['minZ']) / span
        w = _band_weight(t, z0, z1, feather)
        if w <= 0:
            continue
        vertex.co.x = cx + (vertex.co.x - cx) * (1.0 + (sx - 1.0) * w)
        vertex.co.y = cy + (vertex.co.y - cy) * (1.0 + (sy - 1.0) * w)
        vertex.co.z = cz + (vertex.co.z - cz) * (1.0 + (sz - 1.0) * w)
    body.data.update()


def _step_scale(target, actual, gain, max_step):
    if actual <= 1e-6 or target <= 1e-6:
        return 1.0
    raw = math.pow(target / actual, gain)
    return max(1.0 - max_step, min(1.0 + max_step, raw))


def optimize_iteration(body, spec):
    measurements = measure_body(body)
    opt = spec.get('optimizer', {})
    gain = float(opt.get('gain', 0.5))
    max_step = float(opt.get('maxScaleStep', 0.075))
    targets = spec['targets']

    _scale_region(
        body, 0.68, 0.79,
        sx=_step_scale(targets['shoulderWidth'], measurements['shoulderWidth'], gain, max_step),
    )
    measurements = measure_body(body)
    _scale_region(
        body, 0.53, 0.61,
        sx=_step_scale(targets['waistWidth'], measurements['waistWidth'], gain, max_step),
    )
    measurements = measure_body(body)
    _scale_region(
        body, 0.44, 0.53,
        sx=_step_scale(targets['hipWidth'], measurements['hipWidth'], gain, max_step),
    )
    measurements = measure_body(body)
    _scale_region(
        body, 0.55, 0.76,
        sy=_step_scale(targets['torsoDepth'], measurements['torsoDepth'], gain, max_step),
    )
    measurements = measure_body(body)
    _scale_region(
        body, 0.845, 1.0,
        sx=_step_scale(targets['headWidth'], measurements['headWidth'], gain, max_step),
        sy=_step_scale(targets['headDepth'], measurements['headDepth'], gain, max_step),
        sz=_step_scale(targets['headHeightRatio'], measurements['headHeightRatio'], gain, max_step),
        center_z=0.90,
        feather=0.02,
    )
    return measure_body(body)


def _snapshot(body):
    return [vertex.co.copy() for vertex in body.data.vertices]


def _restore(body, coordinates):
    for vertex, coordinate in zip(body.data.vertices, coordinates):
        vertex.co = coordinate
    body.data.update()


def run_optimizer(body, spec, iterations=None):
    opt = spec.get('optimizer', {})
    iterations = int(iterations if iterations is not None else opt.get('iterations', 8))
    min_improvement = float(opt.get('minImprovement', 0.0005))
    history = []

    initial = measure_body(body)
    best_score, _ = score(initial, spec)
    best_coordinates = _snapshot(body)

    for index in range(max(0, iterations)):
        before = measure_body(body)
        before_score, _ = score(before, spec)
        after = optimize_iteration(body, spec)
        after_score, errors = score(after, spec)
        improved = after_score > best_score + min_improvement
        history.append({
            'iteration': index + 1,
            'beforeScore': before_score,
            'score': after_score,
            'accepted': improved,
            'measurements': after,
            'errors': errors,
        })
        if improved:
            best_score = after_score
            best_coordinates = _snapshot(body)
        else:
            _restore(body, best_coordinates)
            break

    _restore(body, best_coordinates)
    return history

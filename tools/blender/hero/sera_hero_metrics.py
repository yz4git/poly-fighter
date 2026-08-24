import math


def _bounds(vertices):
    xs = [v.co.x for v in vertices]
    ys = [v.co.y for v in vertices]
    zs = [v.co.z for v in vertices]
    return {
        'minX': min(xs), 'maxX': max(xs),
        'minY': min(ys), 'maxY': max(ys),
        'minZ': min(zs), 'maxZ': max(zs),
    }


def _band_vertices(vertices, z0, z1, bounds):
    span = max(1e-6, bounds['maxZ'] - bounds['minZ'])
    lo = bounds['minZ'] + span * z0
    hi = bounds['minZ'] + span * z1
    selected = [v for v in vertices if lo <= v.co.z <= hi]
    return selected if selected else list(vertices)


def _extent(vertices, axis):
    values = [getattr(v.co, axis) for v in vertices]
    return max(values) - min(values) if values else 0.0


def measure_body(body):
    vertices = body.data.vertices
    b = _bounds(vertices)
    height = max(1e-6, b['maxZ'] - b['minZ'])

    shoulder = _band_vertices(vertices, 0.68, 0.79, b)
    waist = _band_vertices(vertices, 0.53, 0.61, b)
    hips = _band_vertices(vertices, 0.44, 0.53, b)
    torso = _band_vertices(vertices, 0.55, 0.76, b)
    head = _band_vertices(vertices, 0.845, 1.0, b)

    return {
        'height': height,
        'shoulderWidth': _extent(shoulder, 'x'),
        'waistWidth': _extent(waist, 'x'),
        'hipWidth': _extent(hips, 'x'),
        'torsoDepth': _extent(torso, 'y'),
        'headWidth': _extent(head, 'x'),
        'headDepth': _extent(head, 'y'),
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
    vertices = body.data.vertices
    b = _bounds(vertices)
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
    t = spec['targets']

    _scale_region(
        body, 0.68, 0.79,
        sx=_step_scale(t['shoulderWidth'], measurements['shoulderWidth'], gain, max_step),
    )
    measurements = measure_body(body)
    _scale_region(
        body, 0.53, 0.61,
        sx=_step_scale(t['waistWidth'], measurements['waistWidth'], gain, max_step),
    )
    measurements = measure_body(body)
    _scale_region(
        body, 0.44, 0.53,
        sx=_step_scale(t['hipWidth'], measurements['hipWidth'], gain, max_step),
    )
    measurements = measure_body(body)
    _scale_region(
        body, 0.55, 0.76,
        sy=_step_scale(t['torsoDepth'], measurements['torsoDepth'], gain, max_step),
    )
    measurements = measure_body(body)
    _scale_region(
        body, 0.845, 1.0,
        sx=_step_scale(t['headWidth'], measurements['headWidth'], gain, max_step),
        sy=_step_scale(t['headDepth'], measurements['headDepth'], gain, max_step),
        sz=_step_scale(t['headHeightRatio'], measurements['headHeightRatio'], gain, max_step),
        center_z=0.90,
        feather=0.02,
    )
    return measure_body(body)


def run_optimizer(body, spec, iterations=None):
    opt = spec.get('optimizer', {})
    iterations = int(iterations if iterations is not None else opt.get('iterations', 8))
    min_improvement = float(opt.get('minImprovement', 0.0005))
    history = []
    previous_score = None

    for index in range(max(0, iterations)):
        before = measure_body(body)
        before_score, _ = score(before, spec)
        after = optimize_iteration(body, spec)
        after_score, errors = score(after, spec)
        history.append({
            'iteration': index + 1,
            'beforeScore': before_score,
            'score': after_score,
            'measurements': after,
            'errors': errors,
        })
        if previous_score is not None and after_score - previous_score < min_improvement:
            break
        previous_score = after_score
    return history

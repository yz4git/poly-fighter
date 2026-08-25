"""Shared 2D head-local semantic detector for SERA Reference objectives.

The detector is intentionally Blender-independent and SciPy-independent. Both
Reference preparation and generated semantic renders use this exact code so a
body/shoulder mismatch cannot move the face objective. The top-most head band
establishes the head, then face skin is component-filtered and hair is clipped
to a head-cap window before landmarks/crops are derived.
"""
from __future__ import annotations

import math
from collections import deque
import numpy as np

HEAD_SEMANTIC_VERSION = "SERA_HEAD_SEMANTIC_V1_TOP_HAIR_FACE_SKIN"
FACE_SIGNAL_BOTTOM = 0.82
HAIR_SIGNAL_BOTTOM = {
    "front": 0.78,
    "three-quarter": 0.80,
    "side": 0.82,
    "back": 0.86,
}


def bbox(mask):
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return None
    return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]


def _clip(box, shape):
    h, w = int(shape[0]), int(shape[1])
    x0, y0, x1, y1 = box
    x0 = max(0, min(w - 1, int(round(x0))))
    x1 = max(0, min(w - 1, int(round(x1))))
    y0 = max(0, min(h - 1, int(round(y0))))
    y1 = max(0, min(h - 1, int(round(y1))))
    if x1 < x0:
        x0, x1 = x1, x0
    if y1 < y0:
        y0, y1 = y1, y0
    return [x0, y0, x1, y1]


def _components(mask):
    """Return 8-connected components without SciPy (safe inside Blender Python)."""
    mask = np.asarray(mask, dtype=bool)
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    out = []
    for sy, sx in np.argwhere(mask):
        sy, sx = int(sy), int(sx)
        if seen[sy, sx]:
            continue
        queue = deque([(sy, sx)])
        seen[sy, sx] = True
        points = []
        min_x = max_x = sx
        min_y = max_y = sy
        sum_x = sum_y = 0.0
        while queue:
            y, x = queue.popleft()
            points.append((y, x))
            sum_x += x
            sum_y += y
            min_x, max_x = min(min_x, x), max(max_x, x)
            min_y, max_y = min(min_y, y), max(max_y, y)
            for dy in (-1, 0, 1):
                ny = y + dy
                if ny < 0 or ny >= h:
                    continue
                for dx in (-1, 0, 1):
                    if not dx and not dy:
                        continue
                    nx = x + dx
                    if nx < 0 or nx >= w or seen[ny, nx] or not mask[ny, nx]:
                        continue
                    seen[ny, nx] = True
                    queue.append((ny, nx))
        area = len(points)
        out.append({
            "points": points,
            "area": area,
            "box": [min_x, min_y, max_x, max_y],
            "center": [sum_x / area, sum_y / area],
        })
    return out


def _component_mask(shape, components):
    result = np.zeros(shape, dtype=bool)
    for component in components:
        for y, x in component["points"]:
            result[y, x] = True
    return result


def _near_mask(mask, radius):
    """Small square dilation implemented with NumPy shifts only."""
    radius = max(0, int(radius))
    result = np.asarray(mask, dtype=bool).copy()
    if radius == 0:
        return result
    source = result.copy()
    h, w = source.shape
    for dy in range(-radius, radius + 1):
        ys0, yd0 = max(0, -dy), max(0, dy)
        ly = h - abs(dy)
        if ly <= 0:
            continue
        for dx in range(-radius, radius + 1):
            xs0, xd0 = max(0, -dx), max(0, dx)
            lx = w - abs(dx)
            if lx <= 0:
                continue
            result[yd0:yd0 + ly, xd0:xd0 + lx] |= source[ys0:ys0 + ly, xs0:xs0 + lx]
    return result


def _head_band_center(silhouette, body_box):
    bx0, by0, bx1, by1 = body_box
    body_h = max(1.0, by1 - by0 + 1.0)
    y0 = max(0, int(round(by0 + body_h * .04)))
    y1 = min(silhouette.shape[0] - 1, int(round(by0 + body_h * .16)))
    _, xs = np.nonzero(silhouette[y0:y1 + 1])
    return float(np.median(xs)) if len(xs) else (bx0 + bx1) * .5


def _select_head_hair(silhouette, hair, body_box):
    """Select only top-hair seed components; dark clothing cannot anchor the head."""
    bx0, by0, bx1, by1 = body_box
    body_h = max(1.0, by1 - by0 + 1.0)
    body_w = max(1.0, bx1 - bx0 + 1.0)
    head_cx = _head_band_center(silhouette, body_box)
    search = np.zeros_like(hair, dtype=bool)
    y1 = min(hair.shape[0] - 1, int(round(by0 + body_h * .24)))
    half = max(body_h * .15, body_w * .24)
    x0 = max(0, int(round(head_cx - half)))
    x1 = min(hair.shape[1] - 1, int(round(head_cx + half)))
    search[by0:y1 + 1, x0:x1 + 1] = (
        hair[by0:y1 + 1, x0:x1 + 1] & silhouette[by0:y1 + 1, x0:x1 + 1]
    )
    components = [c for c in _components(search) if c["area"] >= 3]
    if not components:
        return np.zeros_like(hair, dtype=bool), None, []

    def score(c):
        cx, cy = c["center"]
        _, top, _, bottom = c["box"]
        height = bottom - top + 1
        center_penalty = abs(cx - head_cx) / max(body_h * .18, 1.0)
        vertical_penalty = max(0.0, (cy - (by0 + body_h * .13)) / max(body_h * .13, 1.0))
        top_bonus = max(0.0, 1.0 - (top - by0) / max(body_h * .15, 1.0))
        return (
            math.log1p(c["area"]) * 2.0
            + height / body_h * 7.0
            + top_bonus * 5.0
            - center_penalty * 3.0
            - vertical_penalty * 4.0
        )

    primary = max(components, key=score)
    px0, py0, px1, py1 = primary["box"]
    pcx, pcy = primary["center"]
    selected = []
    for c in components:
        x0, y0, x1, _ = c["box"]
        cx, cy = c["center"]
        near_primary = (
            x1 >= px0 - body_h * .045
            and x0 <= px1 + body_h * .045
            and y0 <= py1 + body_h * .045
        )
        near_center = abs(cx - pcx) <= body_h * .11 and abs(cy - pcy) <= body_h * .13
        if c is primary or near_primary or near_center:
            selected.append(c)
    return _component_mask(hair.shape, selected), primary, selected


def _select_face_skin(skin, region, center_x, head_top, head_height, view):
    """Keep face/ear skin components and reject neck/shoulder/chest components."""
    candidate = np.asarray(skin, dtype=bool) & np.asarray(region, dtype=bool)
    signal_bottom = min(
        candidate.shape[0] - 1,
        int(round(head_top + head_height * FACE_SIGNAL_BOTTOM)),
    )
    candidate[signal_bottom + 1:] = False
    components = [c for c in _components(candidate) if c["area"] >= 2]
    if not components:
        return candidate

    target_y = head_top + head_height * (.47 if view == "side" else .50)
    max_center_dx = head_height * (.58 if view == "side" else .48)

    def score(c):
        cx, cy = c["center"]
        x0, y0, x1, y1 = c["box"]
        width, height = x1 - x0 + 1, y1 - y0 + 1
        center_penalty = abs(cx - center_x) / max(max_center_dx, 1.0)
        vertical_penalty = abs(cy - target_y) / max(head_height * .42, 1.0)
        low_penalty = max(0.0, (cy - (head_top + head_height * .68)) / max(head_height * .14, 1.0))
        return (
            math.log1p(c["area"]) * 2.5
            + min(1.0, height / max(head_height * .58, 1.0)) * 3.0
            + min(1.0, width / max(head_height * .35, 1.0)) * 1.5
            - center_penalty * 3.0
            - vertical_penalty * 2.5
            - low_penalty * 8.0
        )

    plausible = [
        c for c in components
        if abs(c["center"][0] - center_x) <= max_center_dx * 1.35
        and c["center"][1] <= head_top + head_height * .76
    ]
    primary = max(plausible or components, key=score)
    px0, py0, px1, py1 = primary["box"]
    pcx, _ = primary["center"]
    selected = [primary]
    for c in components:
        if c is primary:
            continue
        cx, cy = c["center"]
        x0, y0, x1, y1 = c["box"]
        near = (
            x1 >= px0 - head_height * .16
            and x0 <= px1 + head_height * .16
            and y1 >= py0 - head_height * .10
            and y0 <= py1 + head_height * .18
        )
        upper = cy <= head_top + head_height * .72
        centered = abs(cx - pcx) <= head_height * (.45 if view == "side" else .34)
        small_enough = c["area"] <= max(primary["area"] * .42, 80)
        if near and upper and centered and small_enough:
            selected.append(c)
    return _component_mask(candidate.shape, selected)


def _row_dark_centroid(mask, y0, y1, fallback):
    y0 = max(0, int(round(y0)))
    y1 = min(mask.shape[0] - 1, int(round(y1)))
    if y1 < y0:
        return list(fallback)
    ys, xs = np.nonzero(mask[y0:y1 + 1])
    if not len(xs):
        return list(fallback)
    return [float(xs.mean()), float(ys.mean() + y0)]


def detect_head_semantics(silhouette, skin, hair, view):
    """Derive head masks, local windows and face landmarks from semantic pixels."""
    silhouette = np.asarray(silhouette, dtype=bool)
    skin = np.asarray(skin, dtype=bool) & silhouette
    hair = np.asarray(hair, dtype=bool) & silhouette
    body_box = bbox(silhouette)
    if body_box is None:
        return None
    _, by0, _, by1 = body_box
    body_h = max(1.0, by1 - by0 + 1.0)
    silhouette_head_cx = _head_band_center(silhouette, body_box)

    head_hair_seed, primary, selected = _select_head_hair(silhouette, hair, body_box)
    primary_box = None if primary is None else primary["box"]
    if primary_box is not None:
        _, hy0, _, _ = primary_box
        hair_cx = primary["center"][0]
        head_top = max(float(by0), float(hy0))
        center_x = hair_cx * .46 + silhouette_head_cx * .54
        cap_width = max(1.0, primary_box[2] - primary_box[0] + 1.0)
    else:
        head_top = float(by0)
        center_x = silhouette_head_cx
        cap_width = body_h * (.11 if view == "side" else .13)

    head_height = body_h * (0.205 if view == "side" else 0.185)
    cap_width = min(max(cap_width, head_height * .46), head_height * 1.02)

    head_half = max(cap_width * .55, head_height * (.50 if view == "side" else .45))
    face_region_box = _clip([
        center_x - head_half,
        head_top + head_height * .03,
        center_x + head_half,
        head_top + head_height * .98,
    ], silhouette.shape)
    fx0, fy0, fx1, fy1 = face_region_box
    face_region = np.zeros_like(silhouette, dtype=bool)
    face_region[fy0:fy1 + 1, fx0:fx1 + 1] = True

    # face skin can never extend into the shoulder/chest band.
    face_skin = _select_face_skin(
        skin, face_region, center_x, head_top, head_height, view
    )
    face_signal_region = face_region.copy()
    face_signal_bottom = min(
        silhouette.shape[0] - 1,
        int(round(head_top + head_height * FACE_SIGNAL_BOTTOM)),
    )
    face_signal_region[face_signal_bottom + 1:] = False
    head_silhouette = silhouette & face_signal_region

    face_box = _clip([
        center_x - head_height * (.52 if view == "side" else .45),
        head_top + head_height * .02,
        center_x + head_height * (.52 if view == "side" else .45),
        head_top + head_height * .98,
    ], silhouette.shape)

    hair_bottom = HAIR_SIGNAL_BOTTOM.get(view, .84)
    hair_box = _clip([
        center_x - head_height * (.78 if view == "side" else .70),
        head_top - head_height * .08,
        center_x + head_height * (.78 if view == "side" else .70),
        head_top + head_height * hair_bottom,
    ], silhouette.shape)
    hx0, hy0, hx1, hy1 = hair_box
    hair_region = np.zeros_like(silhouette, dtype=bool)
    hair_region[hy0:hy1 + 1, hx0:hx1 + 1] = True

    # The raw Reference dark mask is noisy. Use it only inside the head-local
    # window, erase confirmed face skin, and retain components connected to the
    # top-hair seed. Detached upper strands are allowed only when they are large
    # and spatially adjacent to the primary head-hair mass.
    hair_candidate = hair & hair_region
    if np.any(face_skin):
        hair_candidate &= ~_near_mask(face_skin, 2)
    hair_components = [c for c in _components(hair_candidate) if c["area"] >= 2]
    seed = _near_mask(head_hair_seed, 2) if np.any(head_hair_seed) else None
    chosen_hair = []
    for c in hair_components:
        cmask = _component_mask(hair_candidate.shape, [c])
        touches_seed = seed is not None and np.any(cmask & seed)
        detached_strand = False
        if primary is not None:
            detached_strand = (
                c["area"] >= max(5, int(primary["area"] * .04))
                and c["box"][1] <= primary["box"][3] + body_h * .03
                and abs(c["center"][0] - primary["center"][0]) <= head_height * .65
            )
        if touches_seed or detached_strand:
            chosen_hair.append(c)
    if chosen_hair:
        local_hair = _component_mask(hair_candidate.shape, chosen_hair)
    elif np.any(head_hair_seed):
        local_hair = head_hair_seed & hair_region
    else:
        local_hair = hair_candidate

    landmarks = {}
    if view != "back":
        dark_face = head_silhouette & ~face_skin & ~local_hair
        top = float(face_box[1])
        height = max(1.0, face_box[3] - face_box[1] + 1.0)
        cx = center_x
        split = max(0, min(dark_face.shape[1], int(round(cx))))
        left_mask = dark_face.copy()
        left_mask[:, split:] = False
        right_mask = dark_face.copy()
        right_mask[:, :split] = False
        landmarks = {
            "eyeL": _row_dark_centroid(
                left_mask, top + height * .24, top + height * .48,
                [cx - height * .13, top + height * .36],
            ),
            "eyeR": _row_dark_centroid(
                right_mask, top + height * .24, top + height * .48,
                [cx + height * .13, top + height * .36],
            ),
            "nose": _row_dark_centroid(
                face_skin, top + height * .40, top + height * .62,
                [cx, top + height * .52],
            ),
            "mouth": _row_dark_centroid(
                dark_face, top + height * .54, top + height * .74,
                [cx, top + height * .64],
            ),
        }

    return {
        "version": HEAD_SEMANTIC_VERSION,
        "bodyBox": body_box,
        "primaryHairBox": primary_box,
        "selectedHairComponents": len(selected),
        "headTop": head_top,
        "centerX": center_x,
        "headHeight": head_height,
        "faceRegionBox": face_region_box,
        "faceBox": face_box,
        "hairBox": hair_box,
        "headSilhouette": head_silhouette,
        "faceSkin": face_skin,
        "headHair": local_hair,
        "landmarks": landmarks,
    }

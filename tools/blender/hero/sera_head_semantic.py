"""Shared 2D head-local semantic detector for SERA Reference objectives.

The detector is intentionally Blender-independent and SciPy-independent.  Both
Reference preparation and generated semantic renders use this exact code so a
body/shoulder mismatch cannot move the face objective.  The top-most central
hair component establishes the head.  Face skin is then restricted to a tight
head window before landmarks/crops are derived.
"""
from __future__ import annotations

import math
from collections import deque

import numpy as np

HEAD_SEMANTIC_VERSION = "SERA_HEAD_SEMANTIC_V1_TOP_HAIR_FACE_SKIN"


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
    components = []
    for sy, sx in np.argwhere(mask):
        sy, sx = int(sy), int(sx)
        if seen[sy, sx]:
            continue
        queue = deque([(sy, sx)])
        seen[sy, sx] = True
        points = []
        min_x = max_x = sx
        min_y = max_y = sy
        while queue:
            y, x = queue.popleft()
            points.append((y, x))
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
        components.append({
            "points": points,
            "area": len(points),
            "box": [min_x, min_y, max_x, max_y],
            "center": [(min_x + max_x) * .5, (min_y + max_y) * .5],
        })
    return components


def _component_mask(shape, components):
    result = np.zeros(shape, dtype=bool)
    for component in components:
        for y, x in component["points"]:
            result[y, x] = True
    return result


def _select_head_hair(silhouette, hair, body_box):
    bx0, by0, bx1, by1 = body_box
    body_h = max(1.0, by1 - by0 + 1.0)
    body_w = max(1.0, bx1 - bx0 + 1.0)
    body_cx = (bx0 + bx1) * .5
    search = np.zeros_like(hair, dtype=bool)
    y1 = min(hair.shape[0] - 1, int(round(by0 + body_h * .43)))
    margin = body_w * .14
    x0 = max(0, int(round(bx0 - margin)))
    x1 = min(hair.shape[1] - 1, int(round(bx1 + margin)))
    search[by0:y1 + 1, x0:x1 + 1] = hair[by0:y1 + 1, x0:x1 + 1] & silhouette[by0:y1 + 1, x0:x1 + 1]
    components = [component for component in _components(search) if component["area"] >= 3]
    if not components:
        return np.zeros_like(hair, dtype=bool), None, []

    def score(component):
        cx, _ = component["center"]
        _, top, _, bottom = component["box"]
        height = bottom - top + 1
        center_penalty = abs(cx - body_cx) / max(body_w, 1.0)
        top_bonus = max(0.0, 1.0 - (top - by0) / max(body_h * .20, 1.0))
        return math.log1p(component["area"]) * 2.2 + height / body_h * 9.0 + top_bonus * 5.0 - center_penalty * 8.0

    primary = max(components, key=score)
    px0, py0, px1, py1 = primary["box"]
    pcx = primary["center"][0]
    selected = []
    for component in components:
        x0, y0, x1, y1 = component["box"]
        cx = component["center"][0]
        overlaps_x = x1 >= px0 - body_h * .055 and x0 <= px1 + body_h * .055
        near_center = abs(cx - pcx) <= body_h * .16
        near_top = y0 <= py1 + body_h * .08
        if component is primary or (near_top and (overlaps_x or near_center)):
            selected.append(component)
    return _component_mask(hair.shape, selected), primary, selected


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
    bx0, by0, bx1, by1 = body_box
    body_h = max(1.0, by1 - by0 + 1.0)
    body_cx = (bx0 + bx1) * .5

    head_hair, primary, selected = _select_head_hair(silhouette, hair, body_box)
    primary_box = None if primary is None else primary["box"]
    if primary_box is not None:
        hx0, hy0, hx1, hy1 = primary_box
        hair_cx = (hx0 + hx1) * .5
        cap_width = max(1.0, hx1 - hx0 + 1.0)
        head_top = max(float(by0), float(hy0))
        center_x = hair_cx
    else:
        cap_width = body_h * (.11 if view == "side" else .13)
        head_top = float(by0)
        center_x = body_cx

    # A face is ~17-20% of body height in this turnaround.  This vertical cap
    # is the key shoulder rejection rule: face skin can never extend into the
    # shoulder/chest band even if those pixels are connected through the neck.
    head_height = body_h * (0.205 if view == "side" else 0.185)
    head_half = max(cap_width * .68, head_height * (.48 if view == "side" else .43))
    face_region_box = _clip([
        center_x - head_half,
        head_top + head_height * .04,
        center_x + head_half,
        head_top + head_height * .98,
    ], silhouette.shape)
    fx0, fy0, fx1, fy1 = face_region_box
    face_region = np.zeros_like(silhouette, dtype=bool)
    face_region[fy0:fy1 + 1, fx0:fx1 + 1] = True
    face_skin = skin & face_region
    head_silhouette = silhouette & face_region

    # Tight face crop uses only the head-local semantic system.  Hair crop may
    # extend further down to preserve nape/ponytail, but remains centered on the
    # same top-hair component and never derives its center from shoulders.
    face_box = _clip([
        center_x - head_height * (.50 if view == "side" else .43),
        head_top + head_height * .03,
        center_x + head_height * (.50 if view == "side" else .43),
        head_top + head_height * .98,
    ], silhouette.shape)
    hair_box = _clip([
        center_x - head_height * (.82 if view == "side" else .68),
        head_top - head_height * .08,
        center_x + head_height * (.82 if view == "side" else .68),
        head_top + head_height * (1.62 if view == "back" else 1.48),
    ], silhouette.shape)
    hx0, hy0, hx1, hy1 = hair_box
    hair_region = np.zeros_like(silhouette, dtype=bool)
    hair_region[hy0:hy1 + 1, hx0:hx1 + 1] = True
    local_hair = hair & hair_region
    # Prefer head-connected/top-selected hair, but retain nearby hair pixels
    # inside the bounded window so separated fringe/ponytail pieces survive.
    if np.any(head_hair):
        local_hair &= (head_hair | _near_mask(head_hair, 3))
        # The expansion above is deliberately small; also retain components in
        # the crop whose top sits close to the selected head mass.
        for component in _components(hair & hair_region):
            if primary_box is None:
                break
            if component["box"][1] <= primary_box[3] + body_h * .16 and abs(component["center"][0] - center_x) <= head_height * .85:
                for y, x in component["points"]:
                    local_hair[y, x] = True

    landmarks = {}
    if view != "back":
        dark_face = head_silhouette & ~face_skin & ~local_hair
        top = float(face_box[1])
        height = max(1.0, face_box[3] - face_box[1] + 1.0)
        cx = center_x
        left_mask = dark_face.copy(); left_mask[:, int(round(cx)):] = False
        right_mask = dark_face.copy(); right_mask[:, :int(round(cx))] = False
        landmarks = {
            "eyeL": _row_dark_centroid(left_mask, top + height * .28, top + height * .50, [cx - height * .13, top + height * .39]),
            "eyeR": _row_dark_centroid(right_mask, top + height * .28, top + height * .50, [cx + height * .13, top + height * .39]),
            "nose": _row_dark_centroid(face_skin, top + height * .45, top + height * .66, [cx, top + height * .56]),
            "mouth": _row_dark_centroid(dark_face, top + height * .58, top + height * .80, [cx, top + height * .69]),
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


def _near_mask(mask, radius):
    """Small square dilation implemented with NumPy shifts only."""
    radius = max(0, int(radius))
    result = np.asarray(mask, dtype=bool).copy()
    if radius == 0:
        return result
    h, w = result.shape
    source = result.copy()
    for dy in range(-radius, radius + 1):
        ys0, yd0 = max(0, -dy), max(0, dy)
        length_y = h - abs(dy)
        if length_y <= 0:
            continue
        for dx in range(-radius, radius + 1):
            xs0, xd0 = max(0, -dx), max(0, dx)
            length_x = w - abs(dx)
            if length_x <= 0:
                continue
            result[yd0:yd0 + length_y, xd0:xd0 + length_x] |= source[ys0:ys0 + length_y, xs0:xs0 + length_x]
    return result

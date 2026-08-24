"""Landmark-anchored local crop mapping for SERA Hero V5.

Global evaluation stays body-aligned. Face/hair local evaluation deliberately
uses the projected eye/nose/mouth landmarks as its own coordinate system so a
body-proportion mismatch cannot drag shoulders or torso into the local crop.
"""
from __future__ import annotations

import numpy as np
import bpy


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
    return (x0, y0, x1, y1)


def landmark_window(landmarks, shape, kind):
    usable = [p for p in landmarks.values() if p is not None]
    if not usable:
        return None
    eyes = [p for key, p in landmarks.items() if key.startswith('eye') and p is not None]
    mouth = landmarks.get('mouth')
    nose = landmarks.get('nose')
    xs = [float(p[0]) for p in usable]
    center_x = float(np.median(xs))
    eye_top = min(float(p[1]) for p in eyes) if eyes else min(float(p[1]) for p in usable)
    mouth_y = float(mouth[1]) if mouth is not None else max(float(p[1]) for p in usable)
    feature_h = max(6.0, mouth_y - eye_top)
    if len(eyes) >= 2:
        eye_span = abs(float(eyes[-1][0]) - float(eyes[0][0]))
    else:
        eye_span = feature_h * .62
    if nose is not None:
        center_x = (center_x * 2.0 + float(nose[0])) / 3.0

    if kind == 'face':
        half = max(eye_span * 1.25, feature_h * .72)
        box = [
            center_x - half,
            eye_top - feature_h * .82,
            center_x + half,
            mouth_y + feature_h * .34,
        ]
    elif kind == 'hair':
        half = max(eye_span * 2.15, feature_h * 1.32)
        box = [
            center_x - half,
            eye_top - feature_h * 1.92,
            center_x + half,
            mouth_y + feature_h * .42,
        ]
    else:
        raise ValueError('unknown SERA local crop kind ' + str(kind))
    return _clip(box, shape)


def install(reference_objective):
    if getattr(reference_objective, '_sera_landmark_crop_installed', False):
        return reference_objective
    base_map = reference_objective._map_normalized_box

    def map_local_box(spec, generated_body_box, shape):
        if isinstance(spec, dict) and spec.get('anchorMode') == 'faceLandmarks':
            scene = bpy.context.scene
            cam = bpy.data.objects.get('AuditCamera')
            if cam is None:
                return None
            height, width = int(shape[0]), int(shape[1])
            landmarks = reference_objective._project_face_landmarks_raw(scene, cam, width, height)
            return landmark_window(landmarks, shape, spec.get('kind', 'face'))
        return base_map(spec, generated_body_box, shape)

    reference_objective._map_normalized_box = map_local_box
    reference_objective._sera_landmark_crop_installed = True
    return reference_objective

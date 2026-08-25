"""Head-local semantic crop mapping for SERA Hero V5.

Global evaluation remains body-aligned.  The independent face/hair objectives
load the just-rendered semantic frame and run the same 2D head detector used by
Reference preparation.  The top central hair component establishes the head;
face skin is then capped to that head region, so shoulders/chest cannot enter
the local face objective.
"""
from __future__ import annotations

import os

import bpy
import numpy as np
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

from sera_head_semantic import HEAD_SEMANTIC_VERSION, detect_head_semantics

LOCAL_ANCHOR_MODE = "headSemanticV1"


def _world_geometry_centroid(obj):
    """Return visible mesh centroid for the legacy/global face landmark path."""
    if obj is not None and obj.type == "MESH" and len(obj.data.vertices):
        total = Vector((0.0, 0.0, 0.0))
        matrix = obj.matrix_world
        for vertex in obj.data.vertices:
            total += matrix @ vertex.co
        return total / len(obj.data.vertices)
    return None if obj is None else obj.matrix_world.translation.copy()


def _geometry_face_landmarks(reference_objective, scene, cam, width, height):
    result = {}
    for key, name in reference_objective.FACE_OBJECTS.items():
        obj = bpy.data.objects.get(name)
        co = _world_geometry_centroid(obj)
        if co is None:
            continue
        ndc = world_to_camera_view(scene, cam, co)
        result[key] = [
            float(ndc.x * (width - 1)),
            float((1.0 - ndc.y) * (height - 1)),
        ]
    return result


def _semantic_masks(reference_objective):
    scene = bpy.context.scene
    path = os.path.abspath(scene.render.filepath)
    rgba = reference_objective._load_image(path)
    alpha = rgba[..., 3]
    silhouette = alpha > .20
    red, green, blue = rgba[..., 0], rgba[..., 1], rgba[..., 2]
    hair = silhouette & (green > red * 1.35) & (green > blue * 1.35)
    skin = silhouette & (red > .45) & (green > .45) & (blue > .45) & (
        (np.maximum.reduce([red, green, blue]) - np.minimum.reduce([red, green, blue])) < .22
    )
    return silhouette, skin, hair


def _head_from_current_render(reference_objective, view):
    silhouette, skin, hair = _semantic_masks(reference_objective)
    result = detect_head_semantics(silhouette, skin, hair, view)
    if result is None:
        raise RuntimeError(f"SERA head semantic detector found no body for {view}")
    return result


def install(reference_objective):
    if getattr(reference_objective, "_sera_head_semantic_crop_installed", False):
        return reference_objective

    base_project_raw = reference_objective._project_face_landmarks_raw
    base_map = reference_objective._map_normalized_box
    base_render_and_score = reference_objective.render_and_score
    current_view = {"name": "front"}

    # Keep the existing geometry-centroid path for the low-resolution global
    # objective.  High-resolution local landmark calls use the same head-local
    # semantic detector as Reference preparation.
    def project_face_landmarks_raw(scene, cam, width, height):
        if int(width) == int(scene.render.resolution_x) and int(height) == int(scene.render.resolution_y):
            head = _head_from_current_render(reference_objective, current_view["name"])
            return head["landmarks"]
        try:
            return _geometry_face_landmarks(reference_objective, scene, cam, width, height)
        except Exception:
            return base_project_raw(scene, cam, width, height)

    reference_objective._project_face_landmarks_raw = project_face_landmarks_raw

    def map_local_box(spec, generated_body_box, shape):
        if isinstance(spec, dict) and spec.get("anchorMode") in {
            LOCAL_ANCHOR_MODE,
            "semanticMaskLandmarks",
            "faceLandmarks",
        }:
            head = _head_from_current_render(reference_objective, current_view["name"])
            kind = spec.get("kind", "face")
            if kind == "face":
                return tuple(head["faceBox"])
            if kind == "hair":
                return tuple(head["hairBox"])
            raise ValueError("unknown SERA head-local crop kind " + str(kind))
        return base_map(spec, generated_body_box, shape)

    reference_objective._map_normalized_box = map_local_box

    # render_and_score owns the view loop, so expose the active view to the
    # patched mapping functions without editing the stable objective engine.
    # We infer it from the output path immediately before each map/landmark call.
    original_load_image = reference_objective._load_image

    def tracking_load_image(path):
        name = os.path.basename(str(path))
        for view in reference_objective.VIEW_NAMES:
            if f"-{view}.png" in name:
                current_view["name"] = view
                break
        return original_load_image(path)

    reference_objective._load_image = tracking_load_image

    def render_and_score(reference, output_dir, tag, spec):
        result = base_render_and_score(reference, output_dir, tag, spec)
        result["localAnchorMode"] = LOCAL_ANCHOR_MODE
        result["headSemanticVersion"] = HEAD_SEMANTIC_VERSION
        return result

    reference_objective.render_and_score = render_and_score
    reference_objective._sera_head_semantic_crop_installed = True
    return reference_objective

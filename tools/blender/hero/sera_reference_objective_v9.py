"""V9 SERA Reference objective: symmetric head-local 2D semantics.

Global scoring is retained from V8/V5. Independent local face and hair scoring
uses sera_head_semantic for both Reference and Generated. The top central hair
component establishes the head, then face skin is clipped to a tight head band
before the 512x512 local crop is produced. Shoulders/chest therefore cannot be
part of the face-local objective by construction.
"""
from __future__ import annotations

import math
import os

import bpy
import numpy as np

import sera_reference_objective as base
from sera_blender_helpers import point_at
from sera_head_semantic import HEAD_SEMANTIC_VERSION, detect_head_semantics

VIEW_NAMES = base.VIEW_NAMES
VIEW_CAMERA = base.VIEW_CAMERA
load_reference = base.load_reference
LOCAL_ANCHOR_MODE = "headSemanticV1"


def render_and_score(reference, output_dir, tag, spec):
    scene = bpy.context.scene
    cam = bpy.data.objects.get("AuditCamera")
    if cam is None:
        raise RuntimeError("AuditCamera missing for SERA reference objective")
    objective = spec.get("referenceObjective", {})
    local_cfg = spec.get("localReferenceObjective", {})
    weights = objective.get("weights", {})
    width, height = reference["metadata"]["canonicalSize"]
    local_size = reference["metadata"].get("localCropSize", local_cfg.get("cropSize", [512, 512]))
    render_scale = max(1, int(local_cfg.get("renderScale", 1 if not local_cfg.get("enabled") else 3)))
    render_width, render_height = int(width) * render_scale, int(height) * render_scale
    state = base._save_state(scene)
    stored = base._semantic_swap()
    scene.render.resolution_x = render_width
    scene.render.resolution_y = render_height
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = 0.0
    os.makedirs(output_dir, exist_ok=True)
    per_view = {}
    local_face_views = {}
    local_hair_views = {}
    head_diagnostics = {}
    try:
        for view in VIEW_NAMES:
            loc, target = VIEW_CAMERA[view]
            cam.location = loc
            point_at(cam, target)
            path = os.path.join(output_dir, f"objective-{tag}-{view}.png")
            scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            rgba = base._load_image(path)
            alpha = rgba[..., 3]
            generated_silhouette_hi = alpha > .20
            red, green, blue = rgba[..., 0], rgba[..., 1], rgba[..., 2]
            generated_hair_hi = generated_silhouette_hi & (green > red * 1.35) & (green > blue * 1.35)
            generated_skin_hi = generated_silhouette_hi & (red > .45) & (green > .45) & (blue > .45) & (
                (np.maximum.reduce([red, green, blue]) - np.minimum.reduce([red, green, blue])) < .22
            )

            generated_silhouette = base._resize_bool(generated_silhouette_hi, (height, width))
            generated_hair = base._resize_bool(generated_hair_hi, (height, width))
            generated_skin = base._resize_bool(generated_skin_hi, (height, width))
            ref = reference["views"][view]
            ref_box = base.bbox(ref["silhouette"])
            gen_box = base.bbox(generated_silhouette)
            aligned_silhouette = base._aligned(generated_silhouette, gen_box, ref_box, ref["silhouette"].shape)
            aligned_hair = base._aligned(generated_hair, gen_box, ref_box, ref["hair"].shape)
            aligned_skin = base._aligned(generated_skin, gen_box, ref_box, ref["skin"].shape)
            silhouette_iou = base.iou(ref["silhouette"], aligned_silhouette)
            hair_iou = base.iou(ref["hair"], aligned_hair)
            ref_face = ref["skin"] & base._face_region(ref["silhouette"])
            gen_face = aligned_skin & base._face_region(aligned_silhouette)
            face_iou = base.iou(ref_face, gen_face)
            ref_body_lm = reference["metadata"]["views"][view].get("bodyLandmarks", {})
            gen_body_lm = base.body_landmarks(aligned_silhouette)
            body_rms = base._rms(ref_body_lm, gen_body_lm)
            body_score = math.exp(-body_rms / float(objective.get("bodyLandmarkFalloffPx", 22.0)))
            ref_face_lm = reference["metadata"]["views"][view].get("faceLandmarks", {})
            if view == "back" or not ref_face_lm:
                face_rms, face_landmark_score = 0.0, 1.0
            else:
                gen_face_lm = base._project_face_landmarks(scene, cam, gen_box, ref_box, width, height)
                face_rms = base._rms(ref_face_lm, gen_face_lm)
                face_landmark_score = math.exp(-face_rms / float(objective.get("faceLandmarkFalloffPx", 14.0)))
            per_view[view] = {
                "silhouetteIoU": silhouette_iou,
                "hairIoU": hair_iou,
                "faceIoU": face_iou,
                "bodyLandmarkRmsPx": body_rms,
                "bodyLandmarkScore": body_score,
                "faceLandmarkRmsPx": face_rms,
                "faceLandmarkScore": face_landmark_score,
            }

            if local_cfg.get("enabled", False):
                local_meta = reference["metadata"]["views"][view].get("localCrops", {})
                head = detect_head_semantics(
                    generated_silhouette_hi,
                    generated_skin_hi,
                    generated_hair_hi,
                    view,
                )
                if head is None:
                    raise RuntimeError(f"generated V9 head semantics missing for {view}")
                head_diagnostics[view] = {
                    "primaryHairBox": head["primaryHairBox"],
                    "selectedHairComponents": head["selectedHairComponents"],
                    "headTop": head["headTop"],
                    "centerX": head["centerX"],
                    "headHeight": head["headHeight"],
                    "faceRegionBox": head["faceRegionBox"],
                    "faceBox": head["faceBox"],
                    "hairBox": head["hairBox"],
                }
                if view != "back" and ref.get("faceLocal") is not None and local_meta.get("face"):
                    generated_face_local, face_transform = base._crop_canvas(
                        head["faceSkin"], head["faceBox"], local_size
                    )
                    face_local_iou = base.iou(ref["faceLocal"], generated_face_local)
                    generated_local_lm = {
                        key: base._point_to_crop(value, face_transform)
                        for key, value in head["landmarks"].items()
                    }
                    ref_local_lm = local_meta["face"].get("landmarks", {})
                    local_face_rms = base._rms(ref_local_lm, generated_local_lm)
                    local_face_landmark_score = math.exp(
                        -local_face_rms / float(local_cfg.get("faceLandmarkFalloffPx", 44.0))
                    )
                    local_face_views[view] = {
                        "silhouetteIoU": face_local_iou,
                        "landmarkRmsPx": local_face_rms,
                        "landmarkScore": local_face_landmark_score,
                    }
                    base._save_mask(
                        generated_face_local,
                        os.path.join(output_dir, f"local-{tag}-{view}-face.png"),
                    )
                if ref.get("hairLocal") is not None and local_meta.get("hair"):
                    generated_hair_local, _ = base._crop_canvas(
                        head["headHair"], head["hairBox"], local_size
                    )
                    local_hair_iou = base.iou(ref["hairLocal"], generated_hair_local)
                    local_hair_views[view] = {"silhouetteIoU": local_hair_iou}
                    base._save_mask(
                        generated_hair_local,
                        os.path.join(output_dir, f"local-{tag}-{view}-hair.png"),
                    )
    finally:
        base._semantic_restore(stored)
        base._restore_state(scene, state)

    def avg(key):
        return sum(value[key] for value in per_view.values()) / max(1, len(per_view))

    components = {
        "silhouette": avg("silhouetteIoU"),
        "bodyLandmarks": avg("bodyLandmarkScore"),
        "faceLandmarks": avg("faceLandmarkScore"),
        "faceSilhouette": avg("faceIoU"),
        "hairSilhouette": avg("hairIoU"),
    }
    defaults = {
        "silhouette": .50,
        "bodyLandmarks": .18,
        "faceLandmarks": .12,
        "faceSilhouette": .10,
        "hairSilhouette": .10,
    }
    total_weight = 0.0
    total = 0.0
    for key, value in components.items():
        weight = float(weights.get(key, defaults[key]))
        total += value * weight
        total_weight += weight
    global_score = total / max(total_weight, 1e-6)

    local_objectives = {
        "face": {"score": 0.0, "views": {}},
        "hair": {"score": 0.0, "views": {}},
    }
    if local_cfg.get("enabled", False):
        face_view_weights = local_cfg.get(
            "faceViewWeights", {"front": .35, "three-quarter": .45, "side": .20}
        )
        hair_view_weights = local_cfg.get(
            "hairViewWeights", {"front": .25, "three-quarter": .30, "side": .20, "back": .25}
        )
        face_shape = base._weighted_average(
            {key: value["silhouetteIoU"] for key, value in local_face_views.items()},
            face_view_weights,
        ) if local_face_views else 0.0
        face_landmarks = base._weighted_average(
            {key: value["landmarkScore"] for key, value in local_face_views.items()},
            face_view_weights,
        ) if local_face_views else 0.0
        face_weights = local_cfg.get("faceWeights", {"silhouette": .65, "landmarks": .35})
        face_score = (
            face_shape * float(face_weights.get("silhouette", .65))
            + face_landmarks * float(face_weights.get("landmarks", .35))
        ) / max(
            1e-9,
            float(face_weights.get("silhouette", .65))
            + float(face_weights.get("landmarks", .35)),
        )
        hair_score = base._weighted_average(
            {key: value["silhouetteIoU"] for key, value in local_hair_views.items()},
            hair_view_weights,
        ) if local_hair_views else 0.0
        local_objectives = {
            "face": {
                "score": face_score,
                "silhouette": face_shape,
                "landmarks": face_landmarks,
                "views": local_face_views,
            },
            "hair": {
                "score": hair_score,
                "silhouette": hair_score,
                "views": local_hair_views,
            },
        }

    global_objective = {"score": global_score, "components": components, "views": per_view}
    return {
        "score": global_score,
        "components": components,
        "views": per_view,
        "globalObjective": global_objective,
        "localObjectives": local_objectives,
        "localAnchorMode": LOCAL_ANCHOR_MODE,
        "headSemanticVersion": HEAD_SEMANTIC_VERSION,
        "headSemanticDiagnostics": head_diagnostics,
        "objectiveVersion": "REFERENCE_CROP_INDEPENDENT_FACE_HAIR_V2"
        if local_cfg.get("enabled", False)
        else "REFERENCE_IMAGE_SILHOUETTE_LANDMARK_FACE_HAIR_V1",
    }

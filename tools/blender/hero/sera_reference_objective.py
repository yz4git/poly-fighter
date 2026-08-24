import json
import math
import os

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view

from sera_blender_helpers import SERA_FRONT_Y, point_at

VIEW_NAMES = ("front", "three-quarter", "side", "back")
VIEW_CAMERA = {
    "front": ((0.0, 3.65 * SERA_FRONT_Y, 1.02), (0.0, 0.0, 0.88)),
    "three-quarter": ((2.55, 2.85 * SERA_FRONT_Y, 1.08), (0.0, 0.0, 0.88)),
    "side": ((3.70, 0.0, 1.02), (0.0, 0.0, 0.88)),
    "back": ((0.0, -3.65 * SERA_FRONT_Y, 1.02), (0.0, 0.0, 0.88)),
}
FACE_OBJECTS = {
    "eyeL": "SERA_EyeL",
    "eyeR": "SERA_EyeR",
    "nose": "SERA_NosePlane",
    "mouth": "SERA_Lip",
}


def _semantic_material(name, color):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (*color, 1.0)
    emission.inputs["Strength"].default_value = 1.0
    mat.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    mat.diffuse_color = (*color, 1.0)
    return mat


def _category(obj):
    name = obj.name.lower()
    if obj.name == "Ground":
        return "ground"
    if obj.name.startswith("SERA_"):
        if any(token in name for token in ("hair", "fringe", "pony", "nape", "temple")):
            return "hair"
        if obj.name in FACE_OBJECTS.values() or "brow" in name:
            return "face"
        return "costume"
    return "skin"


def _load_image(path):
    image = bpy.data.images.load(os.path.abspath(path), check_existing=False)
    try:
        width, height = image.size
        raw = np.empty(width * height * 4, dtype=np.float32)
        image.pixels.foreach_get(raw)
        return raw.reshape((height, width, 4))[::-1].copy()
    finally:
        bpy.data.images.remove(image)


def load_mask(path):
    rgba = _load_image(path)
    return rgba[..., 0] > 0.5


def bbox(mask):
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return None
    return (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))


def _aligned(mask, generated_box, reference_box, shape):
    if generated_box is None or reference_box is None:
        return np.zeros(shape, dtype=bool)
    gx0, gy0, gx1, gy1 = generated_box
    rx0, ry0, rx1, ry1 = reference_box
    gh = max(1.0, gy1 - gy0 + 1.0)
    rh = max(1.0, ry1 - ry0 + 1.0)
    scale = rh / gh
    gcx = (gx0 + gx1) * 0.5
    rcx = (rx0 + rx1) * 0.5
    yy, xx = np.indices(shape)
    sx = np.rint((xx - rcx) / scale + gcx).astype(np.int32)
    sy = np.rint((yy - ry1) / scale + gy1).astype(np.int32)
    valid = (sx >= 0) & (sx < mask.shape[1]) & (sy >= 0) & (sy < mask.shape[0])
    result = np.zeros(shape, dtype=bool)
    result[valid] = mask[sy[valid], sx[valid]]
    return result


def _align_point(point, generated_box, reference_box):
    if point is None or generated_box is None or reference_box is None:
        return None
    gx0, gy0, gx1, gy1 = generated_box
    rx0, ry0, rx1, ry1 = reference_box
    scale = max(1.0, ry1 - ry0 + 1.0) / max(1.0, gy1 - gy0 + 1.0)
    gcx = (gx0 + gx1) * 0.5
    rcx = (rx0 + rx1) * 0.5
    return [rcx + (point[0] - gcx) * scale, ry1 + (point[1] - gy1) * scale]


def iou(a, b):
    union = np.count_nonzero(a | b)
    if union == 0:
        return 1.0
    return float(np.count_nonzero(a & b) / union)


def _row_extent(mask, y):
    xs = np.flatnonzero(mask[max(0, min(mask.shape[0] - 1, int(y)))])
    return None if not len(xs) else (float(xs.min()), float(xs.max()))


def body_landmarks(mask):
    box = bbox(mask)
    if box is None:
        return {}
    x0, y0, x1, y1 = box
    height = max(1, y1 - y0)
    result = {"headTop": [float((x0 + x1) * 0.5), float(y0)]}
    for name, lo, hi, choose_max in (
        ("shoulder", .18, .33, True),
        ("waist", .42, .56, False),
        ("hip", .54, .69, True),
    ):
        rows = []
        for y in range(int(y0 + height * lo), int(y0 + height * hi) + 1):
            ext = _row_extent(mask, y)
            if ext:
                rows.append((ext[1] - ext[0], y, ext))
        if rows:
            _, y, ext = (max(rows) if choose_max else min(rows))
            result[name + "L"] = [ext[0], float(y)]
            result[name + "R"] = [ext[1], float(y)]
    lower_y = int(y0 + height * .90)
    ys, xs = np.nonzero(mask[lower_y:y1 + 1])
    if len(xs):
        center = (x0 + x1) * .5
        for key, condition in (("footL", xs < center), ("footR", xs >= center)):
            selected = np.where(condition)[0]
            if len(selected):
                result[key] = [float(np.mean(xs[selected])), float(np.max(ys[selected]) + lower_y)]
    return result


def _rms(reference, generated):
    distances = []
    for key, ref in reference.items():
        gen = generated.get(key)
        if gen is not None:
            distances.append((gen[0] - ref[0]) ** 2 + (gen[1] - ref[1]) ** 2)
    if not distances:
        return 999.0
    return math.sqrt(sum(distances) / len(distances))


def _project_face_landmarks(scene, cam, generated_box, reference_box, width, height):
    result = {}
    for key, name in FACE_OBJECTS.items():
        obj = bpy.data.objects.get(name)
        if obj is None:
            continue
        co = obj.matrix_world.translation
        ndc = world_to_camera_view(scene, cam, co)
        pixel = [float(ndc.x * (width - 1)), float((1.0 - ndc.y) * (height - 1))]
        result[key] = _align_point(pixel, generated_box, reference_box)
    return result


def _face_region(mask):
    box = bbox(mask)
    result = np.zeros_like(mask, dtype=bool)
    if box is None:
        return result
    x0, y0, x1, y1 = box
    height = max(1, y1 - y0)
    fx0 = int((x0 + x1) * .5 - height * .10)
    fx1 = int((x0 + x1) * .5 + height * .10)
    fy1 = int(y0 + height * .30)
    result[max(0, y0):min(mask.shape[0], fy1 + 1), max(0, fx0):min(mask.shape[1], fx1 + 1)] = True
    return result


def _save_state(scene):
    return {
        "resolution_x": scene.render.resolution_x,
        "resolution_y": scene.render.resolution_y,
        "resolution_percentage": scene.render.resolution_percentage,
        "film_transparent": scene.render.film_transparent,
        "filepath": scene.render.filepath,
        "view_transform": scene.view_settings.view_transform,
        "look": scene.view_settings.look,
        "exposure": scene.view_settings.exposure,
    }


def _restore_state(scene, state):
    scene.render.resolution_x = state["resolution_x"]
    scene.render.resolution_y = state["resolution_y"]
    scene.render.resolution_percentage = state["resolution_percentage"]
    scene.render.film_transparent = state["film_transparent"]
    scene.render.filepath = state["filepath"]
    scene.view_settings.view_transform = state["view_transform"]
    scene.view_settings.look = state["look"]
    scene.view_settings.exposure = state["exposure"]


def _semantic_swap():
    mats = {
        "skin": _semantic_material("SERA_ObjectiveSkin", (1.0, 1.0, 1.0)),
        "costume": _semantic_material("SERA_ObjectiveCostume", (0.05, 0.10, 1.0)),
        "hair": _semantic_material("SERA_ObjectiveHair", (0.05, 1.0, 0.05)),
        "face": _semantic_material("SERA_ObjectiveFace", (1.0, 0.05, 0.05)),
    }
    stored = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        category = _category(obj)
        stored.append((obj, list(obj.data.materials), obj.hide_render))
        if category == "ground":
            obj.hide_render = True
            continue
        obj.data.materials.clear()
        obj.data.materials.append(mats[category])
    return stored


def _semantic_restore(stored):
    for obj, materials, hide_render in stored:
        obj.data.materials.clear()
        for mat in materials:
            obj.data.materials.append(mat)
        obj.hide_render = hide_render


def load_reference(reference_dir):
    with open(os.path.join(reference_dir, "reference-objective.json"), encoding="utf-8") as fp:
        metadata = json.load(fp)
    result = {"metadata": metadata, "views": {}}
    for view in VIEW_NAMES:
        result["views"][view] = {
            "silhouette": load_mask(os.path.join(reference_dir, f"reference-{view}-silhouette.png")),
            "skin": load_mask(os.path.join(reference_dir, f"reference-{view}-skin.png")),
            "hair": load_mask(os.path.join(reference_dir, f"reference-{view}-hair.png")),
        }
    return result


def render_and_score(reference, output_dir, tag, spec):
    scene = bpy.context.scene
    cam = bpy.data.objects.get("AuditCamera")
    if cam is None:
        raise RuntimeError("AuditCamera missing for SERA reference objective")
    objective = spec.get("referenceObjective", {})
    weights = objective.get("weights", {})
    width, height = reference["metadata"]["canonicalSize"]
    state = _save_state(scene)
    stored = _semantic_swap()
    scene.render.resolution_x = int(width)
    scene.render.resolution_y = int(height)
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = 0.0
    os.makedirs(output_dir, exist_ok=True)
    per_view = {}
    try:
        for view in VIEW_NAMES:
            loc, target = VIEW_CAMERA[view]
            cam.location = loc
            point_at(cam, target)
            path = os.path.join(output_dir, f"objective-{tag}-{view}.png")
            scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            rgba = _load_image(path)
            alpha = rgba[..., 3]
            generated_silhouette = alpha > .20
            red, green, blue = rgba[..., 0], rgba[..., 1], rgba[..., 2]
            generated_hair = generated_silhouette & (green > red * 1.35) & (green > blue * 1.35)
            generated_skin = generated_silhouette & (red > .45) & (green > .45) & (blue > .45) & ((np.maximum.reduce([red, green, blue]) - np.minimum.reduce([red, green, blue])) < .22)
            ref = reference["views"][view]
            ref_box = bbox(ref["silhouette"])
            gen_box = bbox(generated_silhouette)
            aligned_silhouette = _aligned(generated_silhouette, gen_box, ref_box, ref["silhouette"].shape)
            aligned_hair = _aligned(generated_hair, gen_box, ref_box, ref["hair"].shape)
            aligned_skin = _aligned(generated_skin, gen_box, ref_box, ref["skin"].shape)
            silhouette_iou = iou(ref["silhouette"], aligned_silhouette)
            hair_iou = iou(ref["hair"], aligned_hair)
            ref_face = ref["skin"] & _face_region(ref["silhouette"])
            gen_face = aligned_skin & _face_region(aligned_silhouette)
            face_iou = iou(ref_face, gen_face)
            ref_body_lm = reference["metadata"]["views"][view].get("bodyLandmarks", {})
            gen_body_lm = body_landmarks(aligned_silhouette)
            body_rms = _rms(ref_body_lm, gen_body_lm)
            body_score = math.exp(-body_rms / float(objective.get("bodyLandmarkFalloffPx", 22.0)))
            ref_face_lm = reference["metadata"]["views"][view].get("faceLandmarks", {})
            if view == "back" or not ref_face_lm:
                face_rms, face_landmark_score = 0.0, 1.0
            else:
                gen_face_lm = _project_face_landmarks(scene, cam, gen_box, ref_box, width, height)
                face_rms = _rms(ref_face_lm, gen_face_lm)
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
    finally:
        _semantic_restore(stored)
        _restore_state(scene, state)

    def avg(key):
        return sum(v[key] for v in per_view.values()) / max(1, len(per_view))
    silhouette = avg("silhouetteIoU")
    body_landmarks_score = avg("bodyLandmarkScore")
    face_landmarks_score = avg("faceLandmarkScore")
    face = avg("faceIoU")
    hair = avg("hairIoU")
    components = {
        "silhouette": silhouette,
        "bodyLandmarks": body_landmarks_score,
        "faceLandmarks": face_landmarks_score,
        "faceSilhouette": face,
        "hairSilhouette": hair,
    }
    defaults = {"silhouette": .50, "bodyLandmarks": .18, "faceLandmarks": .12, "faceSilhouette": .10, "hairSilhouette": .10}
    total_weight = 0.0
    total = 0.0
    for key, value in components.items():
        weight = float(weights.get(key, defaults[key]))
        total += value * weight
        total_weight += weight
    score = total / max(total_weight, 1e-6)
    return {"score": score, "components": components, "views": per_view}

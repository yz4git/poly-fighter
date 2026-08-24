#!/usr/bin/env python3
"""Rewrite V5 local Reference crops using tight native-resolution head regions.

The broad global masks intentionally keep the existing segmentation behavior.
This pass only refines the independent local objectives so black costume pixels
cannot masquerade as hair and shoulders cannot dominate the face crop.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).resolve().parent
PREPARE_PATH = HERE / "prepare-sera-reference-objective.py"
spec = importlib.util.spec_from_file_location("sera_reference_prepare", PREPARE_PATH)
prepare = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(prepare)


def clip_box(box, width, height):
    x0, y0, x1, y1 = box
    x0 = max(0, min(width - 1, int(round(x0))))
    x1 = max(0, min(width - 1, int(round(x1))))
    y0 = max(0, min(height - 1, int(round(y0))))
    y1 = max(0, min(height - 1, int(round(y1))))
    if x1 < x0:
        x0, x1 = x1, x0
    if y1 < y0:
        y0, y1 = y1, y0
    return [x0, y0, x1, y1]


def head_box(silhouette, body_box):
    bx0, by0, bx1, by1 = body_box
    body_h = max(1, by1 - by0 + 1)
    band = np.zeros_like(silhouette, dtype=bool)
    band[by0:min(silhouette.shape[0], int(by0 + body_h * .205) + 1), bx0:bx1 + 1] = True
    found = prepare.bbox(silhouette & band)
    if found is not None:
        return found
    cx = (bx0 + bx1) * .5
    return [int(cx - body_h * .075), by0, int(cx + body_h * .075), int(by0 + body_h * .20)]


def local_boxes(silhouette, view, face_landmarks=None):
    body = prepare.bbox(silhouette)
    if body is None:
        return None, None, None
    bx0, by0, bx1, by1 = body
    image_h, image_w = silhouette.shape
    body_h = max(1, by1 - by0 + 1)
    hx0, hy0, hx1, hy1 = head_box(silhouette, body)
    head_w = max(1, hx1 - hx0 + 1)
    head_cx = (hx0 + hx1) * .5

    face = None
    if view != "back":
        usable = [p for p in (face_landmarks or {}).values() if p is not None]
        if usable:
            xs = [float(p[0]) for p in usable]
            ys = [float(p[1]) for p in usable]
            mouth = (face_landmarks or {}).get("mouth")
            eyes = [p for key, p in (face_landmarks or {}).items() if key.startswith("eye") and p is not None]
            center_x = float(np.median(xs))
            span_x = max(xs) - min(xs)
            face_half = max(span_x * .90, body_h * .050)
            eye_top = min(float(p[1]) for p in eyes) if eyes else min(ys)
            mouth_y = float(mouth[1]) if mouth is not None else max(ys)
            face = clip_box([
                center_x - face_half,
                eye_top - body_h * .078,
                center_x + face_half,
                mouth_y + body_h * .052,
            ], image_w, image_h)
        else:
            face_half = max(head_w * .42, body_h * .050)
            face = clip_box([
                head_cx - face_half,
                by0 + body_h * .035,
                head_cx + face_half,
                by0 + body_h * .285,
            ], image_w, image_h)

    # Head hair/fringe/side/rear-cap/ponytail-root only. Keep the lower edge
    # above the shoulder band in all views; long hair remains globally scored.
    hair_half = max(head_w * .72, body_h * .080)
    hair = clip_box([
        head_cx - hair_half,
        by0 - body_h * .016,
        head_cx + hair_half,
        by0 + body_h * .218,
    ], image_w, image_h)
    return body, face, hair


def clean_head_hair(hair, silhouette, body_box, hair_box):
    x0, y0, x1, y1 = hair_box
    candidate = np.zeros_like(hair, dtype=bool)
    candidate[y0:y1 + 1, x0:x1 + 1] = True
    candidate &= hair & silhouette
    if not np.any(candidate):
        return candidate

    # Do not dilate components together: a one-pixel bridge at the neck is
    # exactly how black costume used to leak into the hair objective.
    labels, count = ndimage.label(candidate)
    bx0, by0, bx1, by1 = body_box
    body_h = max(1, by1 - by0 + 1)
    seed_limit = int(by0 + body_h * .205)
    chosen = []
    for idx, obj_box in enumerate(ndimage.find_objects(labels), start=1):
        if obj_box is None:
            continue
        component = labels[obj_box] == idx
        area = int(np.count_nonzero(component))
        top = obj_box[0].start
        if area >= 4 and top <= seed_limit:
            chosen.append(idx)
    if not chosen:
        return candidate
    return candidate & np.isin(labels, np.asarray(chosen, dtype=np.int32))


def normalized_box(local_box, body_box):
    if local_box is None:
        return None
    bx0, by0, bx1, by1 = body_box
    bw, bh = max(1.0, bx1 - bx0 + 1.0), max(1.0, by1 - by0 + 1.0)
    x0, y0, x1, y1 = local_box
    return [(x0 - bx0) / bw, (y0 - by0) / bh, (x1 - bx0 + 1.0) / bw, (y1 - by0 + 1.0) / bh]


def _validate_local_box(view, kind, box):
    """Reject body-scale crops while allowing normal side-profile overscan."""
    width = box[2] - box[0]
    height = box[3] - box[1]
    if kind == "face":
        max_width = .64 if view == "side" else .48
        if width > max_width or height > .34 or box[1] < -.02 or box[3] > .34:
            raise RuntimeError(f"{view} face crop escaped head region: {box}")
    elif kind == "hair":
        max_width = 1.20 if view == "side" else .88
        if width > max_width or height > .27 or box[1] < -.05 or box[3] > .27:
            raise RuntimeError(f"{view} hair crop escaped head region: {box}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--objective-dir", required=True)
    args = parser.parse_args()
    objective_dir = Path(args.objective_dir)
    metadata_path = objective_dir / "reference-objective.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    image = Image.open(args.source).convert("RGB")
    grid = prepare.detect_grid(image)
    dividers, row0, row1 = grid["xDividers"], grid["yTop"], grid["yBottom"]

    for index, view in enumerate(prepare.VIEW_NAMES):
        panel = image.crop((dividers[index], row0, dividers[index + 1], row1))
        silhouette, skin, hair = prepare.segment_panel(panel)
        native_face_landmarks = prepare.face_landmarks(silhouette, skin, hair, view)
        body, face_box, hair_box = local_boxes(silhouette, view, native_face_landmarks)
        if body is None or hair_box is None:
            raise RuntimeError(f"could not derive local crop for {view}")
        local = {}
        if face_box is not None:
            face_canvas, face_transform = prepare._crop_canvas(skin, face_box)
            prepare.save_mask(face_canvas, objective_dir / f"reference-{view}-face-local.png")
            local["face"] = {
                "normalizedBox": normalized_box(face_box, body),
                "landmarks": {
                    key: prepare._point_to_crop(value, face_box, face_transform)
                    for key, value in native_face_landmarks.items()
                },
            }
        head_hair = clean_head_hair(hair, silhouette, body, hair_box)
        hair_canvas, _ = prepare._crop_canvas(head_hair, hair_box)
        prepare.save_mask(hair_canvas, objective_dir / f"reference-{view}-hair-local.png")
        local["hair"] = {"normalizedBox": normalized_box(hair_box, body)}
        metadata["views"][view]["localCrops"] = local

        for kind, entry in local.items():
            _validate_local_box(view, kind, entry["normalizedBox"])

    metadata["version"] = "SERA_REFERENCE_OBJECTIVE_V5_LANDMARK_FACE_HEAD_HAIR_CROPS"
    metadata["localCropPurpose"] = {
        "face": "landmark-centered face skin silhouette and landmarks; shoulders excluded by narrow feature-derived box",
        "hair": "head hair/fringe/side/rear cap/ponytail-root silhouette ending above shoulder band; long hair remains global",
    }
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print("SERA_LOCAL_REFERENCE_CROPS_REFINED", objective_dir)


if __name__ == "__main__":
    main()

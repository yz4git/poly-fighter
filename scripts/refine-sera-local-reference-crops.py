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


def local_boxes(silhouette, view):
    body = prepare.bbox(silhouette)
    if body is None:
        return None, None, None
    bx0, by0, bx1, by1 = body
    image_h, image_w = silhouette.shape
    body_h = max(1, by1 - by0 + 1)
    hx0, hy0, hx1, hy1 = head_box(silhouette, body)
    head_w = max(1, hx1 - hx0 + 1)
    cx = (hx0 + hx1) * .5

    # Mouth remains inside ~28% body height while shoulders stay out.
    face_half = max(head_w * .50, body_h * .062)
    face = clip_box([
        cx - face_half,
        by0 - body_h * .012,
        cx + face_half,
        by0 + body_h * .282,
    ], image_w, image_h)

    # This local objective deliberately scores head hair, fringe, side locks,
    # rear cap and ponytail root only. Long tail/body-length hair remains part
    # of the global semantic objective instead of being confused with clothing.
    hair_half = max(head_w * .72, body_h * .080)
    hair = clip_box([
        cx - hair_half,
        by0 - body_h * .016,
        cx + hair_half,
        by0 + body_h * .255,
    ], image_w, image_h)
    return body, (None if view == "back" else face), hair


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
    seed_limit = int(by0 + body_h * .215)
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
        max_width = .82 if view == "side" else .68
        if width > max_width or height > .34 or box[1] < -.04 or box[3] > .34:
            raise RuntimeError(f"{view} face crop escaped head region: {box}")
    elif kind == "hair":
        max_width = .96 if view == "side" else .88
        if width > max_width or height > .31 or box[1] < -.05 or box[3] > .32:
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
        body, face_box, hair_box = local_boxes(silhouette, view)
        if body is None or hair_box is None:
            raise RuntimeError(f"could not derive local crop for {view}")
        native_face_landmarks = prepare.face_landmarks(silhouette, skin, hair, view)
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

        # The guard prevents accidental body crops, but side-profile references
        # legitimately need more horizontal room and tiny top overscan.
        for kind, entry in local.items():
            _validate_local_box(view, kind, entry["normalizedBox"])

    metadata["version"] = "SERA_REFERENCE_OBJECTIVE_V4_TIGHT_HEAD_LOCAL_CROPS"
    metadata["localCropPurpose"] = {
        "face": "face silhouette and landmarks only",
        "hair": "head hair/fringe/side/rear cap/ponytail-root silhouette; long hair remains global",
    }
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print("SERA_LOCAL_REFERENCE_CROPS_REFINED", objective_dir)


if __name__ == "__main__":
    main()

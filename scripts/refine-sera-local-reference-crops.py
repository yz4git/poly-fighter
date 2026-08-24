#!/usr/bin/env python3
"""Build V5 local Reference crops in a face-landmark coordinate system.

The global objective keeps its body-aligned masks. The independent face/hair
objectives use eye/nose/mouth landmarks as their own anchor so neither shoulder
width nor torso proportions can determine the local crop.
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


def landmark_window(landmarks, shape, kind):
    height, width = shape
    usable = [p for p in landmarks.values() if p is not None]
    if not usable:
        return None
    eyes = [p for key, p in landmarks.items() if key.startswith("eye") and p is not None]
    mouth = landmarks.get("mouth")
    nose = landmarks.get("nose")
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

    if kind == "face":
        half = max(eye_span * 1.25, feature_h * .72)
        box = [
            center_x - half,
            eye_top - feature_h * .82,
            center_x + half,
            mouth_y + feature_h * .34,
        ]
    elif kind == "hair":
        half = max(eye_span * 2.15, feature_h * 1.32)
        box = [
            center_x - half,
            eye_top - feature_h * 1.92,
            center_x + half,
            mouth_y + feature_h * .42,
        ]
    else:
        raise ValueError("unknown local crop kind " + str(kind))
    return clip_box(box, width, height)


def clean_head_hair(hair, silhouette, hair_box):
    """Keep only dark components that enter the landmark-anchored head window."""
    x0, y0, x1, y1 = hair_box
    candidate = np.zeros_like(hair, dtype=bool)
    candidate[y0:y1 + 1, x0:x1 + 1] = True
    candidate &= hair & silhouette
    if not np.any(candidate):
        return candidate
    labels, count = ndimage.label(candidate)
    if count == 0:
        return candidate
    # Components touching the upper 72% of the local window belong to head hair.
    # This rejects isolated collar/shoulder fragments at the lower edge.
    seed_bottom = y0 + int((y1 - y0 + 1) * .72)
    chosen = []
    for idx, obj_box in enumerate(ndimage.find_objects(labels), start=1):
        if obj_box is None:
            continue
        area = int(np.count_nonzero(labels[obj_box] == idx))
        top = obj_box[0].start
        if area >= 4 and top <= seed_bottom:
            chosen.append(idx)
    return candidate if not chosen else candidate & np.isin(labels, np.asarray(chosen, dtype=np.int32))


def normalized_box(local_box, body_box):
    if local_box is None or body_box is None:
        return None
    bx0, by0, bx1, by1 = body_box
    bw, bh = max(1.0, bx1 - bx0 + 1.0), max(1.0, by1 - by0 + 1.0)
    x0, y0, x1, y1 = local_box
    return [(x0 - bx0) / bw, (y0 - by0) / bh, (x1 - bx0 + 1.0) / bw, (y1 - by0 + 1.0) / bh]


def hair_limits(view):
    """View-aware locality guard for landmark windows, not a fit target."""
    if view == "side":
        return 1.20, .42
    if view == "three-quarter":
        return .96, .40
    if view == "back":
        return .36, .28
    return .88, .36


def validate_reference_box(view, kind, local_box, body_box):
    box = normalized_box(local_box, body_box)
    width = box[2] - box[0]
    height = box[3] - box[1]
    if kind == "face":
        max_width = .64 if view == "side" else (.52 if view == "three-quarter" else .48)
        if width > max_width or height > .30:
            raise RuntimeError(f"{view} face crop escaped landmark region: {box}")
    elif kind == "hair":
        max_width, max_height = hair_limits(view)
        # Hair can legitimately extend above the body bbox. Keep a separate
        # position guard so relaxing that overscan never permits a torso crop.
        if width > max_width or height > max_height or box[1] < -.16 or box[3] > .42:
            raise RuntimeError(f"{view} hair crop escaped landmark region: {box}")
    return box


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
        body = prepare.bbox(silhouette)
        if body is None:
            raise RuntimeError(f"could not derive body bbox for {view}")
        landmarks = prepare.face_landmarks(silhouette, skin, hair, view)
        local = {}

        if view != "back":
            face_box = landmark_window(landmarks, silhouette.shape, "face")
            if face_box is None:
                raise RuntimeError(f"could not derive landmark face crop for {view}")
            face_canvas, face_transform = prepare._crop_canvas(skin, face_box)
            prepare.save_mask(face_canvas, objective_dir / f"reference-{view}-face-local.png")
            local["face"] = {
                "normalizedBox": {"anchorMode": "faceLandmarks", "kind": "face"},
                "referenceNormalizedBox": validate_reference_box(view, "face", face_box, body),
                "landmarks": {
                    key: prepare._point_to_crop(value, face_box, face_transform)
                    for key, value in landmarks.items()
                },
            }

        # Back view has no facial landmarks. Its local hair objective remains
        # head-region based; front/3q/side use the same landmark anchor as the
        # generated render.
        if view == "back":
            bx0, by0, bx1, by1 = body
            bh = max(1, by1 - by0 + 1)
            cx = (bx0 + bx1) * .5
            hair_box = clip_box([cx - bh*.13, by0, cx + bh*.13, by0 + bh*.24], silhouette.shape[1], silhouette.shape[0])
            generated_anchor = {"anchorMode": "bodyHeadFallback", "kind": "hair"}
        else:
            hair_box = landmark_window(landmarks, silhouette.shape, "hair")
            generated_anchor = {"anchorMode": "faceLandmarks", "kind": "hair"}
        if hair_box is None:
            raise RuntimeError(f"could not derive landmark hair crop for {view}")
        head_hair = clean_head_hair(hair, silhouette, hair_box)
        hair_canvas, _ = prepare._crop_canvas(head_hair, hair_box)
        prepare.save_mask(hair_canvas, objective_dir / f"reference-{view}-hair-local.png")
        local["hair"] = {
            "normalizedBox": generated_anchor if view != "back" else normalized_box(hair_box, body),
            "referenceNormalizedBox": validate_reference_box(view, "hair", hair_box, body),
        }
        metadata["views"][view]["localCrops"] = local

    metadata["version"] = "SERA_REFERENCE_OBJECTIVE_V6_LANDMARK_ANCHORED_LOCAL_WINDOWS"
    metadata["localCropPurpose"] = {
        "face": "eye/nose/mouth-anchored face skin silhouette and landmarks; independent of full-body bbox",
        "hair": "face-landmark-anchored head-hair window for front/3q/side; long hair remains globally scored",
    }
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print("SERA_LOCAL_REFERENCE_CROPS_REFINED", objective_dir)


if __name__ == "__main__":
    main()

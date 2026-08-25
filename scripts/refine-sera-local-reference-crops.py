#!/usr/bin/env python3
"""Build V9 SERA local Reference crops with the shared head semantic detector."""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
HERO_DIR = ROOT / "tools" / "blender" / "hero"
if str(HERO_DIR) not in sys.path:
    sys.path.insert(0, str(HERO_DIR))

from sera_head_semantic import HEAD_SEMANTIC_VERSION, detect_head_semantics

PREPARE_PATH = HERE / "prepare-sera-reference-objective.py"
spec = importlib.util.spec_from_file_location("sera_reference_prepare", PREPARE_PATH)
prepare = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(prepare)

ANCHOR_MODE = "headSemanticV1"
REFERENCE_VERSION = "SERA_REFERENCE_OBJECTIVE_V9_HEAD_LOCAL_SEMANTIC"


def normalized_box(local_box, body_box):
    if local_box is None or body_box is None:
        return None
    bx0, by0, bx1, by1 = body_box
    bw, bh = max(1.0, bx1 - bx0 + 1.0), max(1.0, by1 - by0 + 1.0)
    x0, y0, x1, y1 = local_box
    return [
        (x0 - bx0) / bw,
        (y0 - by0) / bh,
        (x1 - bx0 + 1.0) / bw,
        (y1 - by0 + 1.0) / bh,
    ]


def validate_reference_box(view, kind, local_box, body_box):
    box = normalized_box(local_box, body_box)
    width = box[2] - box[0]
    height = box[3] - box[1]
    # Shoulder rejection is a vertical invariant. Horizontal size is only a
    # gross runaway guard because the full-body bbox width varies strongly with
    # pose. Hair uses its own semantic mask, so horizontal background cannot
    # introduce shoulder/chest skin into the local objective.
    if kind == "face":
        max_width = .55 if view == "side" else .48
        if width > max_width or height > .225 or box[3] > .225 or box[1] < -.02:
            raise RuntimeError(f"{view} face crop escaped head-local region: {box}")
    elif kind == "hair":
        if width > .90 or height > .38 or box[1] < -.08 or box[3] > .38:
            raise RuntimeError(f"{view} hair crop escaped head-local region: {box}")
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

    diagnostics = {}
    for index, view in enumerate(prepare.VIEW_NAMES):
        panel = image.crop((dividers[index], row0, dividers[index + 1], row1))
        silhouette, skin, hair = prepare.segment_panel(panel)
        head = detect_head_semantics(silhouette, skin, hair, view)
        if head is None:
            raise RuntimeError(f"could not derive head semantics for {view}")
        body = head["bodyBox"]
        local = {}

        if view != "back":
            face_box = head["faceBox"]
            face_canvas, face_transform = prepare._crop_canvas(head["faceSkin"], face_box)
            prepare.save_mask(face_canvas, objective_dir / f"reference-{view}-face-local.png")
            local["face"] = {
                "normalizedBox": {"anchorMode": ANCHOR_MODE, "kind": "face"},
                "referenceNormalizedBox": validate_reference_box(view, "face", face_box, body),
                "landmarks": {
                    key: prepare._point_to_crop(value, face_box, face_transform)
                    for key, value in head["landmarks"].items()
                },
            }

        hair_box = head["hairBox"]
        hair_canvas, _ = prepare._crop_canvas(head["headHair"], hair_box)
        prepare.save_mask(hair_canvas, objective_dir / f"reference-{view}-hair-local.png")
        local["hair"] = {
            "normalizedBox": {"anchorMode": ANCHOR_MODE, "kind": "hair"},
            "referenceNormalizedBox": validate_reference_box(view, "hair", hair_box, body),
        }
        metadata["views"][view]["localCrops"] = local
        diagnostics[view] = {
            "primaryHairBox": head["primaryHairBox"],
            "selectedHairComponents": head["selectedHairComponents"],
            "headTop": head["headTop"],
            "centerX": head["centerX"],
            "headHeight": head["headHeight"],
            "faceRegionBox": head["faceRegionBox"],
            "faceBox": head["faceBox"],
            "hairBox": head["hairBox"],
        }

    metadata["version"] = REFERENCE_VERSION
    metadata["headSemanticVersion"] = HEAD_SEMANTIC_VERSION
    metadata["localAnchorMode"] = ANCHOR_MODE
    metadata["headSemanticDiagnostics"] = diagnostics
    metadata["localCropPurpose"] = {
        "face": "top-hair-anchored head skin only; shoulder/chest pixels structurally excluded before 512x512 crop",
        "hair": "top-hair-anchored bounded head/nape/ponytail semantic window using the same detector as Generated",
    }
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print("SERA_LOCAL_REFERENCE_CROPS_REFINED", REFERENCE_VERSION, objective_dir)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Prepare global and high-resolution local SERA reference objectives."""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

VIEW_NAMES = ("front", "three-quarter", "side", "back")
CANONICAL_SIZE = (256, 512)
LOCAL_CROP_SIZE = (512, 512)


def _line_score(gray: np.ndarray, start: int, end: int, axis: int) -> np.ndarray:
    sample = gray[start:end, :] if axis == 1 else gray[:, start:end]
    return np.mean(sample > 62.0, axis=0 if axis == 1 else 1)


def _pick_peak(score: np.ndarray, lo: int, hi: int) -> int:
    lo, hi = max(0, int(lo)), min(score.shape[0], int(hi))
    if hi <= lo:
        raise ValueError("invalid divider search interval")
    peak = int(np.argmax(score[lo:hi])) + lo
    neighborhood = score[max(lo, peak - 2):min(hi, peak + 3)]
    return int(max(lo, peak - 2 + int(np.argmax(neighborhood))))


def detect_grid(image: Image.Image) -> dict:
    arr = np.asarray(image.convert("RGB"), dtype=np.float32)
    gray = arr.mean(axis=2)
    h, w = gray.shape
    xs = _line_score(gray, int(h * 0.112), int(h * 0.992), 1)
    ys = _line_score(gray, 0, w, 0)
    y_top = _pick_peak(ys, int(h * 0.09), int(h * 0.16))
    y_bottom = _pick_peak(ys, int(h * 0.96), int(h * 0.995))
    if y_bottom <= y_top + 100:
        raise ValueError(f"invalid reference panel rows: {y_top}, {y_bottom}")
    return {
        "sourceWidth": w,
        "sourceHeight": h,
        "xDividers": [
            _pick_peak(xs, 0, int(w * 0.08)),
            _pick_peak(xs, int(w * 0.20), int(w * 0.31)),
            _pick_peak(xs, int(w * 0.45), int(w * 0.55)),
            _pick_peak(xs, int(w * 0.70), int(w * 0.78)),
            _pick_peak(xs, int(w * 0.94), w),
        ],
        "yTop": y_top,
        "yBottom": y_bottom,
    }


def _disk(radius: int) -> np.ndarray:
    yy, xx = np.mgrid[-radius:radius + 1, -radius:radius + 1]
    return xx * xx + yy * yy <= radius * radius


def _component_selection(candidate: np.ndarray, core: np.ndarray) -> np.ndarray:
    h, w = candidate.shape
    closed = ndimage.binary_closing(candidate, structure=_disk(3), iterations=1)
    closed = ndimage.binary_dilation(closed, structure=_disk(1), iterations=1)
    labels, count = ndimage.label(closed)
    if count == 0:
        return np.zeros_like(candidate, dtype=bool)
    objects = ndimage.find_objects(labels)
    scored = []
    for idx, box_ in enumerate(objects, start=1):
        if box_ is None:
            continue
        area = int(np.count_nonzero(labels[box_] == idx))
        if area < 20:
            continue
        y0, y1 = box_[0].start, box_[0].stop
        x0, x1 = box_[1].start, box_[1].stop
        cy = (y0 + y1) * 0.5 / h
        cx = (x0 + x1) * 0.5 / w
        height = (y1 - y0) / h
        value = math.log1p(area) + height * 28.0 - abs(cx - 0.5) * 7.0 - max(0.0, 0.12 - cy) * 50.0
        scored.append((value, idx))
    if not scored:
        return np.zeros_like(candidate, dtype=bool)
    scored.sort(reverse=True)
    main = scored[0][1]
    box_ = objects[main - 1]
    assert box_ is not None
    my0, my1 = box_[0].start, box_[0].stop
    mx0, mx1 = box_[1].start, box_[1].stop
    chosen = []
    for value, idx in scored:
        b = objects[idx - 1]
        if b is None:
            continue
        y0, y1 = b[0].start, b[0].stop
        x0, x1 = b[1].start, b[1].stop
        near = not (x1 < mx0 - 22 or x0 > mx1 + 22 or y1 < my0 - 22 or y0 > my1 + 22)
        if idx == main or near and value > scored[-1][0] - 2.5:
            chosen.append(idx)
    result = np.isin(labels, np.asarray(chosen, dtype=np.int32))
    result |= ndimage.binary_dilation(core, structure=_disk(5), iterations=1) & result
    result = ndimage.binary_closing(result, structure=_disk(2), iterations=1)
    result = ndimage.binary_fill_holes(result)
    result[: max(1, int(h * 0.076))] = False
    result[int(h * 0.985):] = False
    result[:, : max(1, int(w * 0.095))] = False
    result[:, int(w * 0.905):] = False
    for row in range(min(150, h)):
        if int(result[row].sum()) > int(w * 0.45):
            result[max(0, row - 2):min(h, row + 3)] = False
    clean_labels, _ = ndimage.label(result)
    for clean_index, clean_box in enumerate(ndimage.find_objects(clean_labels), start=1):
        if clean_box is None:
            continue
        cy0, cy1 = clean_box[0].start, clean_box[0].stop
        area = int(np.count_nonzero(clean_labels[clean_box] == clean_index))
        if cy1 < int(h * 0.13) and area < 1200:
            result[clean_labels == clean_index] = False
    return result


def segment_panel(crop: Image.Image):
    arr = np.asarray(crop.convert("RGB"), dtype=np.float32)
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    gray = arr.mean(axis=2)
    chroma = arr.max(axis=2) - arr.min(axis=2)
    blue = (b > 48) & (b - r > 17) & (b - g > 4)
    skin = (r > 55) & (r - g > 11) & (g - b > 3)
    silver = (arr.min(axis=2) > 70) & (chroma < 48)
    colored = chroma > 20
    core = blue | skin | silver | (colored & (gray > 48))
    distance = ndimage.distance_transform_edt(~core)
    hair_raw = (gray < 44) & (distance < 35)
    candidate = core | ((gray < 34) & (distance < 28))
    candidate[: max(1, int(candidate.shape[0] * 0.060))] = False
    candidate[int(candidate.shape[0] * 0.985):] = False
    candidate[:, : max(1, int(candidate.shape[1] * 0.018))] = False
    candidate[:, int(candidate.shape[1] * 0.982):] = False
    mask = _component_selection(candidate, core)
    return mask, mask & skin, mask & hair_raw


def resize_mask(mask: np.ndarray) -> np.ndarray:
    image = Image.fromarray(mask.astype(np.uint8) * 255, "L").resize(CANONICAL_SIZE, Image.Resampling.NEAREST)
    return np.asarray(image) > 127


def bbox(mask: np.ndarray):
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return None
    return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]


def _clip_box(box_, width, height):
    x0, y0, x1, y1 = box_
    x0 = max(0, min(width - 1, int(x0)))
    x1 = max(0, min(width - 1, int(x1)))
    y0 = max(0, min(height - 1, int(y0)))
    y1 = max(0, min(height - 1, int(y1)))
    if x1 < x0:
        x0, x1 = x1, x0
    if y1 < y0:
        y0, y1 = y1, y0
    return [x0, y0, x1, y1]


def _head_box(silhouette: np.ndarray, body_box):
    x0, y0, x1, y1 = body_box
    body_h = max(1, y1 - y0 + 1)
    head_band = np.zeros_like(silhouette, dtype=bool)
    head_band[y0:min(silhouette.shape[0], int(y0 + body_h * .205) + 1), x0:x1 + 1] = True
    head = bbox(silhouette & head_band)
    if head is not None:
        return head
    cx = (x0 + x1) * .5
    return [int(cx - body_h * .075), y0, int(cx + body_h * .075), int(y0 + body_h * .20)]


def _local_boxes(silhouette: np.ndarray, skin: np.ndarray, hair: np.ndarray, view: str):
    body = bbox(silhouette)
    if body is None:
        return None, None
    bx0, by0, bx1, by1 = body
    image_h, image_w = silhouette.shape
    body_h = max(1, by1 - by0 + 1)
    head = _head_box(silhouette, body)
    hx0, hy0, hx1, hy1 = head
    head_w = max(1, hx1 - hx0 + 1)
    head_cx = (hx0 + hx1) * .5

    face_half = max(head_w * .62, body_h * .075)
    face_box = _clip_box([
        head_cx - face_half,
        by0 - body_h * .018,
        head_cx + face_half,
        by0 + body_h * .305,
    ], image_w, image_h)

    hair_half = max(head_w * 1.15, body_h * .12)
    hair_box = _clip_box([
        head_cx - hair_half,
        by0 - body_h * .025,
        head_cx + hair_half,
        by0 + body_h * .40,
    ], image_w, image_h)
    return (None if view == "back" else face_box), hair_box


def _local_hair_mask(hair: np.ndarray, silhouette: np.ndarray, body_box, hair_box):
    """Keep head-connected dark components and reject dark costume/limb noise."""
    bx0, by0, bx1, by1 = body_box
    body_h = max(1, by1 - by0 + 1)
    x0, y0, x1, y1 = hair_box
    region = np.zeros_like(hair, dtype=bool)
    region[y0:y1 + 1, x0:x1 + 1] = True
    candidate = hair & silhouette & region
    if not np.any(candidate):
        return candidate

    joined = ndimage.binary_dilation(candidate, structure=_disk(1), iterations=1)
    labels, count = ndimage.label(joined)
    if count == 0:
        return candidate
    seed = np.zeros_like(candidate, dtype=bool)
    seed_y1 = min(candidate.shape[0], int(by0 + body_h * .22) + 1)
    seed[by0:seed_y1, x0:x1 + 1] = True
    chosen = []
    for idx in range(1, count + 1):
        component = labels == idx
        if np.any(component & seed):
            chosen.append(idx)
    if not chosen:
        return candidate
    selected = np.isin(labels, np.asarray(chosen, dtype=np.int32))
    return candidate & ndimage.binary_dilation(selected, structure=_disk(1), iterations=1)


def _normalized_box(local_box, body_box):
    if local_box is None or body_box is None:
        return None
    bx0, by0, bx1, by1 = body_box
    bw, bh = max(1.0, bx1 - bx0 + 1.0), max(1.0, by1 - by0 + 1.0)
    x0, y0, x1, y1 = local_box
    return [(x0 - bx0) / bw, (y0 - by0) / bh, (x1 - bx0 + 1.0) / bw, (y1 - by0 + 1.0) / bh]


def _crop_canvas(mask: np.ndarray, box_, size=LOCAL_CROP_SIZE):
    target_w, target_h = size
    x0, y0, x1, y1 = box_
    crop = mask[y0:y1 + 1, x0:x1 + 1]
    h, w = crop.shape
    scale = min(target_w / max(1, w), target_h / max(1, h))
    rw, rh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
    resized = Image.fromarray(crop.astype(np.uint8) * 255, "L").resize((rw, rh), Image.Resampling.NEAREST)
    canvas = Image.new("L", (target_w, target_h), 0)
    ox, oy = (target_w - rw) // 2, (target_h - rh) // 2
    canvas.paste(resized, (ox, oy))
    return np.asarray(canvas) > 127, {"scale": scale, "offset": [ox, oy], "sourceSize": [w, h]}


def _point_to_crop(point, box_, transform):
    if point is None or box_ is None:
        return None
    x0, y0, _, _ = box_
    scale = float(transform["scale"])
    ox, oy = transform["offset"]
    return [ox + (point[0] - x0) * scale, oy + (point[1] - y0) * scale]


def _row_extent(mask: np.ndarray, y: int):
    xs = np.flatnonzero(mask[max(0, min(mask.shape[0] - 1, y))])
    return None if not len(xs) else (float(xs.min()), float(xs.max()))


def body_landmarks(mask: np.ndarray):
    box_ = bbox(mask)
    if box_ is None:
        return {}
    x0, y0, x1, y1 = box_
    h = max(1, y1 - y0)
    def best(lo, hi, mode):
        rows = []
        for y in range(int(y0 + h * lo), int(y0 + h * hi) + 1):
            ext = _row_extent(mask, y)
            if ext:
                rows.append((ext[1] - ext[0], y, ext))
        if not rows:
            return None
        _, y, ext = max(rows) if mode == "max" else min(rows)
        return {"left": [ext[0], float(y)], "right": [ext[1], float(y)]}
    result = {"headTop": [float((x0 + x1) * 0.5), float(y0)]}
    for name, lo, hi, mode in (("shoulder", .18, .33, "max"), ("waist", .42, .56, "min"), ("hip", .54, .69, "max")):
        pair = best(lo, hi, mode)
        if pair:
            result[name + "L"] = pair["left"]
            result[name + "R"] = pair["right"]
    lower_y = int(y0 + h * .90)
    ys, xs = np.nonzero(mask[lower_y:y1 + 1])
    if len(xs):
        center = (x0 + x1) * .5
        for key, condition in (("footL", xs < center), ("footR", xs >= center)):
            selected = np.where(condition)[0]
            if len(selected):
                result[key] = [float(np.mean(xs[selected])), float(np.max(ys[selected]) + lower_y)]
    return result


def face_landmarks(mask: np.ndarray, skin: np.ndarray, hair: np.ndarray, view: str):
    box_ = bbox(mask)
    if box_ is None or view == "back":
        return {}
    x0, y0, x1, y1 = box_
    h = max(1, y1 - y0)
    center = (x0 + x1) * .5
    dark = mask & ~skin
    def mean_points(region, fallback):
        ys, xs = np.nonzero(region)
        return fallback if not len(xs) else [float(xs.mean()), float(ys.mean())]
    eye_band = np.zeros_like(mask); eye_band[int(y0 + h*.08):int(y0 + h*.18)+1, x0:x1+1] = True
    eyes = dark & eye_band & ~hair
    left = eyes.copy(); left[:, int(center):] = False
    right = eyes.copy(); right[:, :int(center)] = False
    nose_band = np.zeros_like(mask); nose_band[int(y0+h*.12):int(y0+h*.23)+1, x0:x1+1] = True
    nose = skin & nose_band
    mouth_band = np.zeros_like(mask); mouth_band[int(y0+h*.20):int(y0+h*.29)+1, x0:x1+1] = True
    mouth = dark & mouth_band & ~hair
    return {
        "eyeL": mean_points(left, [center - h*.035, y0+h*.13]),
        "eyeR": mean_points(right, [center + h*.035, y0+h*.13]),
        "nose": mean_points(nose, [center, y0+h*.19]),
        "mouth": mean_points(mouth, [center, y0+h*.25]),
    }


def save_mask(mask: np.ndarray, path: Path):
    Image.fromarray(mask.astype(np.uint8) * 255, "L").save(path, optimize=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="public/reference/female-turnaround.jpeg")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    image = Image.open(args.source).convert("RGB")
    grid = detect_grid(image)
    x, y0, y1 = grid["xDividers"], grid["yTop"], grid["yBottom"]
    metadata = {
        "version": "SERA_REFERENCE_OBJECTIVE_V3_HIGH_RES_LOCAL_CROPS",
        "canonicalSize": list(CANONICAL_SIZE),
        "localCropSize": list(LOCAL_CROP_SIZE),
        "views": {},
    }
    for i, view in enumerate(VIEW_NAMES):
        crop = image.crop((x[i], y0, x[i+1], y1))
        native_silhouette, native_skin, native_hair = segment_panel(crop)
        silhouette, skin, hair = (resize_mask(v) for v in (native_silhouette, native_skin, native_hair))
        save_mask(silhouette, out / f"reference-{view}-silhouette.png")
        save_mask(skin, out / f"reference-{view}-skin.png")
        save_mask(hair, out / f"reference-{view}-hair.png")
        native_body_box = bbox(native_silhouette)
        native_face_lm = face_landmarks(native_silhouette, native_skin, native_hair, view)
        face_box, hair_box = _local_boxes(native_silhouette, native_skin, native_hair, view)
        local = {}
        if face_box is not None:
            face_local_source = native_skin.copy()
            face_canvas, face_transform = _crop_canvas(face_local_source, face_box)
            save_mask(face_canvas, out / f"reference-{view}-face-local.png")
            local["face"] = {
                "normalizedBox": _normalized_box(face_box, native_body_box),
                "landmarks": {k: _point_to_crop(v, face_box, face_transform) for k, v in native_face_lm.items()},
            }
        local_hair = _local_hair_mask(native_hair, native_silhouette, native_body_box, hair_box)
        hair_canvas, _ = _crop_canvas(local_hair, hair_box)
        save_mask(hair_canvas, out / f"reference-{view}-hair-local.png")
        local["hair"] = {"normalizedBox": _normalized_box(hair_box, native_body_box)}
        metadata["views"][view] = {
            "bbox": bbox(silhouette),
            "bodyLandmarks": body_landmarks(silhouette),
            "faceLandmarks": face_landmarks(silhouette, skin, hair, view),
            "localCrops": local,
        }
    (out / "reference-objective.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print("SERA_REFERENCE_OBJECTIVE_V3_LOCAL_CROPS_OK", out)

if __name__ == "__main__":
    main()

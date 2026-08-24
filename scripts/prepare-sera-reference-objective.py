#!/usr/bin/env python3
"""Prepare canonical SERA reference masks and landmarks from the turnaround JPEG."""
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


def _line_score(gray: np.ndarray, start: int, end: int, axis: int) -> np.ndarray:
    sample = gray[start:end, :] if axis == 1 else gray[:, start:end]
    return np.mean(sample > 62.0, axis=0 if axis == 1 else 1)


def _pick_peak(score: np.ndarray, lo: int, hi: int) -> int:
    lo, hi = max(0, int(lo)), min(score.shape[0], int(hi))
    if hi <= lo:
        raise ValueError("invalid divider search interval")
    return int(np.argmax(score[lo:hi])) + lo


def detect_grid(image: Image.Image) -> dict:
    arr = np.asarray(image.convert("RGB"), dtype=np.float32)
    gray = arr.mean(axis=2)
    h, w = gray.shape
    xs = _line_score(gray, int(h * 0.112), int(h * 0.992), 1)
    ys = _line_score(gray, 0, w, 0)
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
        "yTop": _pick_peak(ys, int(h * 0.09), int(h * 0.16)),
        "yBottom": _pick_peak(ys, int(h * 0.96), int(h * 0.995)),
    }


def _disk(radius: int) -> np.ndarray:
    yy, xx = np.mgrid[-radius:radius + 1, -radius:radius + 1]
    return xx * xx + yy * yy <= radius * radius


def _component_selection(candidate: np.ndarray) -> np.ndarray:
    h, w = candidate.shape
    closed = ndimage.binary_closing(candidate, structure=_disk(3), iterations=1)
    closed = ndimage.binary_dilation(closed, structure=_disk(1), iterations=1)
    labels, count = ndimage.label(closed)
    if count == 0:
        return np.zeros_like(candidate, dtype=bool)
    objects = ndimage.find_objects(labels)
    scored = []
    for idx, box in enumerate(objects, start=1):
        if box is None:
            continue
        area = int(np.count_nonzero(labels[box] == idx))
        if area < 20:
            continue
        y0, y1 = box[0].start, box[0].stop
        x0, x1 = box[1].start, box[1].stop
        cx = (x0 + x1) * 0.5 / w
        height = (y1 - y0) / h
        scored.append((math.log1p(area) + height * 28.0 - abs(cx - 0.5) * 7.0, idx))
    if not scored:
        return np.zeros_like(candidate, dtype=bool)
    scored.sort(reverse=True)
    main = scored[0][1]
    box = objects[main - 1]
    assert box is not None
    my0, my1 = box[0].start, box[0].stop
    mx0, mx1 = box[1].start, box[1].stop
    chosen = []
    for score, idx in scored:
        b = objects[idx - 1]
        if b is None:
            continue
        y0, y1 = b[0].start, b[0].stop
        x0, x1 = b[1].start, b[1].stop
        near = not (x1 < mx0 - 22 or x0 > mx1 + 22 or y1 < my0 - 22 or y0 > my1 + 22)
        if idx == main or near and score > scored[-1][0] - 2.5:
            chosen.append(idx)
    result = np.isin(labels, np.asarray(chosen, dtype=np.int32))
    result = ndimage.binary_closing(result, structure=_disk(2), iterations=1)
    result = ndimage.binary_fill_holes(result)
    result[: max(1, int(h * 0.076))] = False
    result[int(h * 0.985):] = False
    result[:, : max(1, int(w * 0.095))] = False
    result[:, int(w * 0.905):] = False
    return result


def segment_panel(crop: Image.Image):
    arr = np.asarray(crop.convert("RGB"), dtype=np.float32)
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    gray = arr.mean(axis=2)
    chroma = arr.max(axis=2) - arr.min(axis=2)
    blue = (b > 48) & (b - r > 17) & (b - g > 4)
    skin = (r > 55) & (r - g > 11) & (g - b > 3)
    silver = (arr.min(axis=2) > 70) & (chroma < 48)
    core = blue | skin | silver | ((chroma > 20) & (gray > 48))
    distance = ndimage.distance_transform_edt(~core)
    hair_raw = (gray < 44) & (distance < 35)
    candidate = core | ((gray < 34) & (distance < 28))
    candidate[: max(1, int(candidate.shape[0] * 0.060))] = False
    candidate[int(candidate.shape[0] * 0.985):] = False
    candidate[:, : max(1, int(candidate.shape[1] * 0.018))] = False
    candidate[:, int(candidate.shape[1] * 0.982):] = False
    mask = _component_selection(candidate)
    return mask, mask & skin, mask & hair_raw


def resize_mask(mask: np.ndarray) -> np.ndarray:
    image = Image.fromarray(mask.astype(np.uint8) * 255, "L").resize(CANONICAL_SIZE, Image.Resampling.NEAREST)
    return np.asarray(image) > 127


def bbox(mask: np.ndarray):
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return None
    return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]


def _row_extent(mask: np.ndarray, y: int):
    xs = np.flatnonzero(mask[max(0, min(mask.shape[0] - 1, y))])
    return None if not len(xs) else (float(xs.min()), float(xs.max()))


def body_landmarks(mask: np.ndarray):
    box = bbox(mask)
    if box is None:
        return {}
    x0, y0, x1, y1 = box
    h = max(1, y1 - y0)
    def best(lo, hi, mode):
        rows = []
        for y in range(int(y0 + h * lo), int(y0 + h * hi) + 1):
            ext = _row_extent(mask, y)
            if ext:
                rows.append((ext[1] - ext[0], y, ext))
        if not rows:
            return None
        width, y, ext = (max(rows) if mode == "max" else min(rows))
        return {"left": [ext[0], float(y)], "right": [ext[1], float(y)]}
    top_x = np.flatnonzero(mask[y0:min(y1 + 1, y0 + 4)])
    head_top = [float((x0 + x1) * 0.5), float(y0)]
    lm = {"headTop": head_top}
    for name, lo, hi, mode in (
        ("shoulder", .18, .33, "max"),
        ("waist", .42, .56, "min"),
        ("hip", .54, .69, "max"),
    ):
        pair = best(lo, hi, mode)
        if pair:
            lm[name + "L"] = pair["left"]
            lm[name + "R"] = pair["right"]
    lower = mask[int(y0 + h * .90):y1 + 1]
    ys, xs = np.nonzero(lower)
    if len(xs):
        center = (x0 + x1) * .5
        for side, predicate in (("footL", xs < center), ("footR", xs >= center)):
            selected = np.where(predicate)[0]
            if len(selected):
                sx, sy = xs[selected], ys[selected] + int(y0 + h * .90)
                lm[side] = [float(np.mean(sx)), float(np.max(sy))]
    return lm


def face_landmarks(mask: np.ndarray, skin: np.ndarray, hair: np.ndarray, view: str):
    box = bbox(mask)
    if box is None or view == "back":
        return {}
    x0, y0, x1, y1 = box
    h = max(1, y1 - y0)
    fy1 = int(y0 + h * .30)
    center = (x0 + x1) * .5
    dark = mask & ~skin
    def mean_points(region, fallback):
        ys, xs = np.nonzero(region)
        return fallback if not len(xs) else [float(xs.mean()), float(ys.mean())]
    eye_band = np.zeros_like(mask)
    eye_band[int(y0 + h*.08):int(y0 + h*.18)+1, x0:x1+1] = True
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
    metadata = {"version": "SERA_REFERENCE_OBJECTIVE_V1", "canonicalSize": [256, 512], "views": {}}
    for i, view in enumerate(VIEW_NAMES):
        crop = image.crop((x[i], y0, x[i+1], y1))
        silhouette, skin, hair = (resize_mask(v) for v in segment_panel(crop))
        save_mask(silhouette, out / f"reference-{view}-silhouette.png")
        save_mask(skin, out / f"reference-{view}-skin.png")
        save_mask(hair, out / f"reference-{view}-hair.png")
        metadata["views"][view] = {
            "bbox": bbox(silhouette),
            "bodyLandmarks": body_landmarks(silhouette),
            "faceLandmarks": face_landmarks(silhouette, skin, hair, view),
        }
    (out / "reference-objective.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print("SERA_REFERENCE_OBJECTIVE_OK", out)

if __name__ == "__main__":
    main()

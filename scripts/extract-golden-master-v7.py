#!/usr/bin/env python3
"""Extract the V7 Golden Master from real source pixels.

This script is deliberately independent from the game renderer.  It reads the
supplied JPEG, detects the printed turnaround grid, crops the four panels, and
classifies foreground/region pixels from their measured RGB values.  The
resulting masks are committed as QA artifacts so the comparison pipeline can
be inspected without a browser or a texture in the gameplay scene.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage


VIEW_NAMES = ("front", "three-quarter", "side", "back")
CANONICAL_SIZE = (256, 512)


def _line_score(gray: np.ndarray, start: int, end: int, axis: int) -> np.ndarray:
    """Score light, low-chroma printed divider lines from source pixels."""
    if axis == 1:
        sample = gray[start:end, :]
        return np.mean(sample > 62.0, axis=0)
    sample = gray[:, start:end]
    return np.mean(sample > 62.0, axis=1)


def _pick_peak(score: np.ndarray, lo: int, hi: int) -> int:
    lo = max(0, int(lo))
    hi = min(score.shape[0], int(hi))
    if hi <= lo:
        raise ValueError("invalid divider search interval")
    window = score[lo:hi]
    # Prefer a printed line, but keep the result stable when JPEG ringing makes
    # two neighboring columns similarly bright.
    peak = int(np.argmax(window)) + lo
    neighborhood = score[max(lo, peak - 2):min(hi, peak + 3)]
    return int(max(lo, peak - 2 + int(np.argmax(neighborhood))))


def detect_grid(image: Image.Image) -> dict:
    """Read panel boundaries from divider pixels rather than model guesses."""
    array = np.asarray(image.convert("RGB"), dtype=np.float32)
    gray = array.mean(axis=2)
    h, w = gray.shape
    # The header and panel dividers are the only long, bright low-detail lines.
    x_score = _line_score(gray, int(h * 0.112), int(h * 0.992), axis=1)
    y_score = _line_score(gray, 0, w, axis=0)
    x_bounds = [
        _pick_peak(x_score, 0, int(w * 0.08)),
        _pick_peak(x_score, int(w * 0.20), int(w * 0.31)),
        _pick_peak(x_score, int(w * 0.45), int(w * 0.55)),
        _pick_peak(x_score, int(w * 0.70), int(w * 0.78)),
        _pick_peak(x_score, int(w * 0.94), w),
    ]
    # The horizontal panel frame is shared by all four views.  Search only
    # rows where the complete frame is visible.
    y_top = _pick_peak(y_score, int(h * 0.09), int(h * 0.16))
    y_bottom = _pick_peak(y_score, int(h * 0.96), int(h * 0.995))
    if y_bottom <= y_top + 100:
        raise ValueError(f"detected invalid panel rows: {y_top}, {y_bottom}")
    return {
        "sourceWidth": w,
        "sourceHeight": h,
        "xDividers": x_bounds,
        "yTop": y_top,
        "yBottom": y_bottom,
    }


def _disk(radius: int) -> np.ndarray:
    size = radius * 2 + 1
    yy, xx = np.mgrid[-radius:radius + 1, -radius:radius + 1]
    return (xx * xx + yy * yy) <= radius * radius


def _component_selection(candidate: np.ndarray, core: np.ndarray) -> np.ndarray:
    """Keep character-connected components, dropping title/frame/background."""
    h, w = candidate.shape
    # Close narrow gaps between adjacent black/blue costume areas, but do not
    # turn the panel background into a foreground fill.
    closed = ndimage.binary_closing(candidate, structure=_disk(3), iterations=1)
    closed = ndimage.binary_dilation(closed, structure=_disk(1), iterations=1)
    labels, count = ndimage.label(closed)
    if count == 0:
        return np.zeros_like(candidate, dtype=bool)
    objects = ndimage.find_objects(labels)
    scores: list[tuple[float, int]] = []
    for index, box in enumerate(objects, start=1):
        if box is None:
            continue
        area = int(np.count_nonzero(labels[box] == index))
        if area < 20:
            continue
        y0, y1 = box[0].start, box[0].stop
        x0, x1 = box[1].start, box[1].stop
        cy = (y0 + y1) / 2 / h
        cx = (x0 + x1) / 2 / w
        height = (y1 - y0) / h
        # A character spans most of the panel height and is centered in its
        # panel.  Components are ranked instead of hard-coded to a rectangle.
        score = math.log1p(area) + height * 28.0 - abs(cx - 0.5) * 7.0 - max(0.0, 0.12 - cy) * 50.0
        scores.append((score, index))
    if not scores:
        return np.zeros_like(candidate, dtype=bool)
    scores.sort(reverse=True)
    chosen: list[int] = []
    main = scores[0][1]
    main_box = objects[main - 1]
    assert main_box is not None
    main_y0, main_y1 = main_box[0].start, main_box[0].stop
    main_x0, main_x1 = main_box[1].start, main_box[1].stop
    for score, index in scores:
        box = objects[index - 1]
        if box is None:
            continue
        y0, y1 = box[0].start, box[0].stop
        x0, x1 = box[1].start, box[1].stop
        near = not (x1 < main_x0 - 22 or x0 > main_x1 + 22 or y1 < main_y0 - 22 or y0 > main_y1 + 22)
        # Preserve detached hands/boots if they sit close to the main body.
        if index == main or near and score > scores[-1][0] - 2.5:
            chosen.append(index)
    result = np.isin(labels, np.asarray(chosen, dtype=np.int32))
    # Only use core pixels to pull in dark costume/hair, then fill small holes
    # inside the actual character component.  This avoids treating the dark
    # panel background as a character material.
    result |= ndimage.binary_dilation(core, structure=_disk(5), iterations=1) & result
    result = ndimage.binary_closing(result, structure=_disk(2), iterations=1)
    result = ndimage.binary_fill_holes(result)
    # The dominant component can legitimately be connected to a frame pixel
    # through JPEG ringing.  Remove the measured frame bands once more after
    # the component union, without touching the character interior.
    result[: max(1, int(h * 0.076))] = False
    result[int(h * 0.985):] = False
    # Long straight rows/columns are the turnaround frame.  Character hair
    # and limbs are compact enough that a row spanning nearly half the panel
    # cannot be a plausible silhouette extremity.
    for row in range(min(150, h)):
        if int(result[row].sum()) > int(w * 0.45):
            result[max(0, row - 2):min(h, row + 3)] = False
    result[:, : max(1, int(w * 0.095))] = False
    result[:, int(w * 0.905):] = False
    clean_labels, clean_count = ndimage.label(result)
    for clean_index, clean_box in enumerate(ndimage.find_objects(clean_labels), start=1):
        if clean_box is None:
            continue
        cy0, cy1 = clean_box[0].start, clean_box[0].stop
        area = int(np.count_nonzero(clean_labels[clean_box] == clean_index))
        if cy1 < int(h * 0.13) and area < 1200:
            result[clean_labels == clean_index] = False
    return result


def segment_panel(crop: Image.Image) -> tuple[np.ndarray, dict[str, np.ndarray]]:
    array = np.asarray(crop.convert("RGB"), dtype=np.float32)
    r, g, b = array[..., 0], array[..., 1], array[..., 2]
    gray = array.mean(axis=2)
    chroma = array.max(axis=2) - array.min(axis=2)
    blue = (b > 48) & (b - r > 17) & (b - g > 4)
    skin = (r > 55) & (r - g > 11) & (g - b > 3)
    silver = (array.min(axis=2) > 70) & (chroma < 48)
    colored = chroma > 20
    # Hair and black clothing are close to the charcoal background.  Use local
    # high-frequency edges around the measured colored/skin core to include
    # those pixels without accepting the whole background.
    core = blue | skin | silver | (colored & (gray > 48))
    distance = ndimage.distance_transform_edt(~core)
    dark_foreground = (gray < 34) & (distance < 28)
    candidate = core | dark_foreground
    # Exclude the printed header/footer rows before component analysis.  This
    # is a crop-relative pixel rule, not a character bounding box.
    # Printed panel border and title are not character pixels.  Remove their
    # measured frame bands before connected-component analysis; the character
    # begins well below the panel label and never touches the frame.
    candidate[: max(1, int(candidate.shape[0] * 0.060))] = False
    candidate[int(candidate.shape[0] * 0.985):] = False
    candidate[:, : max(1, int(candidate.shape[1] * 0.018))] = False
    candidate[:, int(candidate.shape[1] * 0.982):] = False
    mask = _component_selection(candidate, core)
    # Any region mask is derived from source RGB pixels and constrained by the
    # measured character mask; no hand-painted material shapes are used.
    regions = {
        "skin": mask & skin,
        "blue": mask & blue,
        "silver": mask & silver,
        "hair": mask & (gray < 44) & (distance < 35),
    }
    # Material regions used by V7 are mutually exclusive.  The raw dark-pixel
    # hair classifier is kept separate so BLACK means the actual clothing/body
    # material rather than the union of black clothing and hair.
    regions["black"] = mask & ~regions["skin"] & ~regions["blue"] & ~regions["silver"] & ~regions["hair"]
    return mask, regions


def save_mask(mask: np.ndarray, path: Path, size: tuple[int, int] = CANONICAL_SIZE) -> None:
    image = Image.fromarray((mask.astype(np.uint8) * 255), mode="L")
    image = image.resize(size, Image.Resampling.LANCZOS)
    image.save(path, optimize=True)


def save_debug(mask: np.ndarray, source: Image.Image, path: Path) -> None:
    rgb = np.asarray(source.convert("RGB"), dtype=np.uint8).copy()
    rgb[~mask] = (rgb[~mask] * 0.20).astype(np.uint8)
    rgb[mask] = np.clip(rgb[mask] * 0.72 + np.array([60, 180, 255]) * 0.28, 0, 255).astype(np.uint8)
    Image.fromarray(rgb, mode="RGB").resize(CANONICAL_SIZE, Image.Resampling.LANCZOS).save(path, optimize=True)


def bbox(mask: np.ndarray) -> dict[str, int] | None:
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return None
    return {"minX": int(xs.min()), "minY": int(ys.min()), "maxX": int(xs.max()), "maxY": int(ys.max())}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="public/reference/female-turnaround.jpeg")
    parser.add_argument("--out", default="public/reference/v7")
    args = parser.parse_args()
    source_path = Path(args.source)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    image = Image.open(source_path).convert("RGB")
    grid = detect_grid(image)
    x = grid["xDividers"]
    y0, y1 = grid["yTop"], grid["yBottom"]
    view_stats: dict[str, object] = {}
    for index, name in enumerate(VIEW_NAMES):
        crop_box = (x[index], y0, x[index + 1], y1)
        crop = image.crop(crop_box)
        crop.save(out / f"reference-{name}.png", optimize=True)
        mask, regions = segment_panel(crop)
        save_mask(mask, out / f"reference-{name}-mask.png")
        Image.fromarray((mask.astype(np.uint8) * 255), mode="L").save(out / f"reference-{name}-mask-native.png", optimize=True)
        save_debug(mask, crop, out / f"reference-{name}-mask-debug.png")
        region_stats: dict[str, object] = {}
        for region, value in regions.items():
            save_mask(value, out / f"reference-{name}-{region}-mask.png")
            Image.fromarray((value.astype(np.uint8) * 255), mode="L").save(out / f"reference-{name}-{region}-mask-native.png", optimize=True)
            region_stats[region] = {"pixels": int(np.count_nonzero(value)), "bbox": bbox(value)}
        view_stats[name] = {
            "crop": {"x": crop_box[0], "y": crop_box[1], "width": crop_box[2] - crop_box[0], "height": crop_box[3] - crop_box[1]},
            "canonicalWidth": CANONICAL_SIZE[0],
            "canonicalHeight": CANONICAL_SIZE[1],
            "maskPixelsNative": int(np.count_nonzero(mask)),
            "maskPixelsCanonical": int(np.count_nonzero(np.asarray(Image.open(out / f"reference-{name}-mask.png")) > 127)),
            "maskBoundsNative": bbox(mask),
            "regions": region_stats,
        }
    metadata = {"source": str(source_path), "grid": grid, "canonicalSize": {"width": CANONICAL_SIZE[0], "height": CANONICAL_SIZE[1]}, "views": view_stats}
    (out / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()

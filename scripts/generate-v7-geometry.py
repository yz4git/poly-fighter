#!/usr/bin/env python3
"""Generate compact polygon rectangles from the actual V7 region masks.

The output is geometry data, never an image texture.  Two-pixel blocks are
merged into long coplanar quads so the Golden Master silhouette remains
measurable while avoiding one mesh per source pixel.
"""

from __future__ import annotations

import importlib.util
import json
import base64
import struct
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
EXTRACTOR = ROOT / "scripts/extract-golden-master-v7.py"
OUT = ROOT / "src/game/golden-master-v7-geometry.ts"
VIEW_NAMES = ("front", "three-quarter", "side", "back")
REGIONS = ("skin", "hair", "blue", "black", "silver")


def load_extractor():
    spec = importlib.util.spec_from_file_location("v7_extractor", EXTRACTOR)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def rects_for_labels(labels: np.ndarray, region: str, block_size: int) -> list[list[int]]:
    active: dict[tuple[int, int], list[int]] = {}
    result: list[list[int]] = []
    for y, row in enumerate(labels):
        xs = np.flatnonzero(row == region)
        runs: list[tuple[int, int]] = []
        if len(xs):
            start = previous = int(xs[0])
            for value in xs[1:]:
                x = int(value)
                if x != previous + 1:
                    runs.append((start, previous + 1))
                    start = x
                previous = x
            runs.append((start, previous + 1))
        current = set(runs)
        for key in set(active) - current:
            result.append(active.pop(key))
        for key in current:
            if key in active:
                active[key][3] = min(labels.shape[0] * block_size, (y + 1) * block_size)
            else:
                active[key] = [key[0] * block_size, y * block_size, key[1] * block_size, min(labels.shape[0] * block_size, (y + 1) * block_size)]
    result.extend(active.values())
    return result


def main() -> None:
    extractor = load_extractor()
    image = Image.open(ROOT / "public/reference/female-turnaround.jpeg").convert("RGB")
    grid = extractor.detect_grid(image)
    dividers = grid["xDividers"]
    all_rects: list[dict[str, object]] = []
    for view_index, name in enumerate(VIEW_NAMES):
        crop = image.crop((dividers[view_index], grid["yTop"], dividers[view_index + 1], grid["yBottom"]))
        mask, regions = extractor.segment_panel(crop)
        height, width = mask.shape
        small_h = (height + 1) // 2
        small_w = (width + 1) // 2
        for region in REGIONS:
            # Keep each measured material mask independent.  The source
            # classifier may intentionally overlap dark hair and black cloth;
            # comparing each generated region separately preserves that pixel
            # evidence instead of silently assigning it to another material.
            block_size = 1 if region in ("hair", "silver", "black") else 2
            region_h = (height + block_size - 1) // block_size
            region_w = (width + block_size - 1) // block_size
            labels = np.full((region_h, region_w), "none", dtype=object)
            for y in range(region_h):
                for x in range(region_w):
                    block = regions[region][y * block_size:min(height, y * block_size + block_size), x * block_size:min(width, x * block_size + block_size)]
                    if block.any():
                        labels[y, x] = region
            for x0, y0, x1, y1 in rects_for_labels(labels, region, block_size):
                all_rects.append({"view": name, "region": region, "x0": x0, "y0": y0, "x1": min(width, x1), "y1": min(height, y1), "width": width, "height": height})
    view_dims = []
    for view_index, name in enumerate(VIEW_NAMES):
        crop = image.crop((dividers[view_index], grid["yTop"], dividers[view_index + 1], grid["yBottom"]))
        view_dims.append((crop.width, crop.height))
    region_indices = {name: index for index, name in enumerate(REGIONS)}
    view_indices = {name: index for index, name in enumerate(VIEW_NAMES)}
    packed = bytearray()
    for rect in all_rects:
        packed.extend(struct.pack(
            "<6H",
            view_indices[str(rect["view"])],
            region_indices[str(rect["region"])],
            int(rect["x0"]),
            int(rect["y0"]),
            int(rect["x1"]),
            int(rect["y1"]),
        ))
    encoded = base64.b64encode(packed).decode("ascii")
    dims_literal = json.dumps(view_dims, separators=(",", ":"))
    OUT.write_text(
        "// Generated from public/reference/female-turnaround.jpeg by scripts/generate-v7-geometry.py.\n"
        "// This is polygon geometry data; it is not a texture or a painted image.\n"
        "export interface GoldenMasterRect { view: 'front' | 'three-quarter' | 'side' | 'back'; region: 'skin' | 'hair' | 'blue' | 'black' | 'silver'; x0: number; y0: number; x1: number; y1: number; width: number; height: number; }\n"
        f"const VIEW_NAMES = ['front', 'three-quarter', 'side', 'back'] as const;\n"
        f"const REGION_NAMES = ['skin', 'hair', 'blue', 'black', 'silver'] as const;\n"
        f"const VIEW_DIMS: readonly (readonly [number, number])[] = {dims_literal};\n"
        f"const PACKED_RECTS = '{encoded}';\n"
        "function decodeRects(): readonly GoldenMasterRect[] {\n"
        "  const bytes = new Uint8Array(PACKED_RECTS.length * 3 / 4);\n"
        "  const binary = globalThis.atob(PACKED_RECTS);\n"
        "  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);\n"
        "  const view = new DataView(bytes.buffer);\n"
        "  const rects: GoldenMasterRect[] = [];\n"
        "  for (let offset = 0; offset < bytes.byteLength; offset += 12) {\n"
        "    const viewIndex = view.getUint16(offset, true);\n"
        "    const regionIndex = view.getUint16(offset + 2, true);\n"
        "    const dims = VIEW_DIMS[viewIndex];\n"
        "    rects.push({ view: VIEW_NAMES[viewIndex], region: REGION_NAMES[regionIndex], x0: view.getUint16(offset + 4, true), y0: view.getUint16(offset + 6, true), x1: view.getUint16(offset + 8, true), y1: view.getUint16(offset + 10, true), width: dims[0], height: dims[1] });\n"
        "  }\n"
        "  return rects;\n"
        "}\n"
        "export const GOLDEN_MASTER_V7_RECTS: readonly GoldenMasterRect[] = decodeRects();\n"
        f"export const GOLDEN_MASTER_V7_RECT_COUNT = {len(all_rects)};\n",
        encoding="utf-8",
    )
    print(json.dumps({"rectangles": len(all_rects), "triangles": len(all_rects) * 2, "output": str(OUT)}))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Convert FAB fab-world SMPL world-joints NPZ into a safe, browser-readable JSON.

This is a data-format adapter, NOT a FAB inference implementation and NOT a
production retargeter. No SMPL model assets or commercial-use weights included.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np

SMPL_NAMES = [
    'pelvis', 'left_hip', 'right_hip', 'spine1', 'left_knee', 'right_knee',
    'spine2', 'left_ankle', 'right_ankle', 'spine3', 'left_foot', 'right_foot',
    'neck', 'left_collar', 'right_collar', 'head', 'left_shoulder',
    'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist',
    'right_wrist', 'left_hand', 'right_hand',
]
CONTACT_NAMES = ('lfoot', 'rfoot', 'lhand', 'rhand', 'lknee', 'rknee')


def to_scalar_float(obj, default: float) -> float:
    try:
        value = float(np.asarray(obj).reshape(-1)[0])
        if math.isfinite(value) and value > 0:
            return value
    except (TypeError, ValueError, IndexError):
        pass
    return default


def parse_contacts(raw, n_frames: int) -> list[dict]:
    """Accept JSON dictionary-of-arrays or list-of-dicts; ignore other formats."""
    if raw is None:
        return [{} for _ in range(n_frames)]
    try:
        doc = json.loads(str(np.asarray(raw).item()))
    except (ValueError, TypeError, json.JSONDecodeError):
        return [{} for _ in range(n_frames)]
    result = []
    for i in range(n_frames):
        if isinstance(doc, dict):
            values = {name: doc[name][i] for name in CONTACT_NAMES
                      if isinstance(doc.get(name), list) and len(doc[name]) > i}
        elif isinstance(doc, list) and len(doc) > i and isinstance(doc[i], dict):
            values = doc[i]
        else:
            values = {}
        clean = {}
        for name in CONTACT_NAMES:
            try:
                if name in values:
                    val = float(values[name])
                    if math.isfinite(val):
                        clean[name] = round(max(0., min(1., val)), 4)
            except (ValueError, TypeError):
                continue
        result.append(clean)
    return result


def convert(src: Path, *, stride: int = 1, max_frames: int | None = None) -> dict:
    if stride < 1 or (max_frames is not None and max_frames < 1):
        raise ValueError('stride and max_frames must be positive')
    with np.load(src, allow_pickle=False) as z:
        if 'joints' not in z:
            raise ValueError("Not a FAB world NPZ: missing 'joints'. Run fab-world first")
        raw_j = np.asarray(z['joints'], dtype=np.float64)
        if raw_j.ndim != 3 or raw_j.shape[1:] != (24, 3):
            raise ValueError(f'Expected joints (T,24,3), got {raw_j.shape}')
        if len(raw_j) == 0:
            raise ValueError('No motion frames in NPZ')
        fps = to_scalar_float(z['fps'] if 'fps' in z else None, 30.0)
        raw_valid = np.asarray(z['valid'], dtype=bool) if 'valid' in z else np.ones(len(raw_j), bool)
        if raw_valid.shape != (len(raw_j),):
            raise ValueError(f'Invalid valid shape: {raw_valid.shape}')
        frames_idx = np.asarray(z['frames']) if 'frames' in z else np.arange(len(raw_j))
        if frames_idx.shape != (len(raw_j),) or not np.issubdtype(frames_idx.dtype, np.number):
            frames_idx = np.arange(len(raw_j))
        contacts = parse_contacts(z['contacts'] if 'contacts' in z else None, len(raw_j))

    # Carry forward failed predictions instead of emitting non-finite JSON. Don't
    # pretend those predictions were real: each frame retains its valid flag.
    usable = raw_valid & np.isfinite(raw_j).all(axis=(1, 2))
    if not np.any(usable):
        raise ValueError('No valid finite 3D joint frames')
    last = raw_j[np.flatnonzero(usable)[0]].copy()
    cleaned = []
    for i in range(len(raw_j)):
        if usable[i]:
            last = raw_j[i]
        cleaned.append(last.copy())

    picks = np.arange(0, len(raw_j), stride, dtype=int)
    if max_frames is not None:
        picks = picks[:max_frames]
    frame_zero = float(frames_idx[picks[0]])
    return {
        'format': 'fab-smpl24-joints-v1',
        'source': 'FAB fab-world world NPZ (not a GLB retarget)',
        'coordinateSystem': 'world-z-up',
        'units': 'meters',
        'fps': round(fps / stride, 5),
        'jointNames': SMPL_NAMES,
        'frames': [
            {
                'time': round((float(frames_idx[i]) - frame_zero) / fps, 5),
                'j': np.round(cleaned[i], 5).tolist(),
                'valid': bool(usable[i]),
                'c': contacts[i],
            }
            for i in picks
        ],
    }


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('input', type=Path, help='fab-world output video.npz')
    p.add_argument('output', type=Path, help='Browser motion.json')
    p.add_argument('--stride', type=int, default=1, help='Take every Nth source frame')
    p.add_argument('--max-frames', type=int, default=None, help='Optional output length limit')
    args = p.parse_args()
    output = convert(args.input, stride=args.stride, max_frames=args.max_frames)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    print(f"Wrote {args.output}: {len(output['frames'])} frames @ {output['fps']} fps")


if __name__ == '__main__':
    main()

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from scipy.ndimage import label
from skimage.measure import marching_cubes
import trimesh

HUMAN_H = 1.68
BASE_W = 1536.0
BASE_H = 1024.0
# Exact panel layout measured on the provided 1536x1024 turnaround; scaled for resized copies.
PANEL_BASE = {
    "front": (8, 168, 389, 1015),
    "three-quarter": (389, 168, 759, 1015),
    "side": (759, 168, 1134, 1015),
    "back": (1134, 168, 1528, 1015),
}
THETA = {"front": 0.0, "three-quarter": 45.0, "side": 90.0, "back": 180.0}


def segment(crop_rgb: np.ndarray) -> np.ndarray:
    crop = cv2.cvtColor(crop_rgb, cv2.COLOR_RGB2BGR)
    h, w = crop.shape[:2]
    mask = np.full((h, w), cv2.GC_PR_BGD, np.uint8)
    border = 10
    mask[:border, :] = cv2.GC_BGD
    mask[-border:, :] = cv2.GC_BGD
    mask[:, :border] = cv2.GC_BGD
    mask[:, -border:] = cv2.GC_BGD

    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    yy, xx = np.indices((h, w))
    central = (yy > 0) & (yy < 0.94 * h) & (xx > 0.02 * w) & (xx < 0.98 * w)
    sat, val = hsv[:, :, 1], hsv[:, :, 2]
    definite = central & (((sat > 70) & (val > 42)) | (val > 125))
    mask[definite] = cv2.GC_FGD

    border_pixels = np.concatenate(
        [crop[:16].reshape(-1, 3), crop[:, -10:].reshape(-1, 3), crop[:, :10].reshape(-1, 3)],
        axis=0,
    )
    background = np.median(border_pixels, axis=0)
    difference = np.linalg.norm(crop.astype(np.float32) - background.astype(np.float32), axis=2)
    probable = central & (difference > 16)
    mask[probable & (mask != cv2.GC_FGD)] = cv2.GC_PR_FGD

    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    cv2.grabCut(crop, mask, None, bgd, fgd, 8, cv2.GC_INIT_WITH_MASK)
    result = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)

    count, labels, stats, _ = cv2.connectedComponentsWithStats(result, 8)
    components = sorted([(stats[i, cv2.CC_STAT_AREA], i) for i in range(1, count)], reverse=True)
    kept = np.zeros_like(result)
    # Preserve disconnected hands / forearm guards / ponytail pieces instead of forcing one largest blob.
    for area, index in components[:12]:
        if area > 70:
            kept[labels == index] = 255
    kept = cv2.morphologyEx(kept, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8), iterations=1)
    kept = cv2.dilate(kept, np.ones((5, 5), np.uint8), iterations=1)
    return kept


def scaled_panel(bounds: tuple[int, int, int, int], width: int, height: int) -> tuple[int, int, int, int]:
    x0, y0, x1, y1 = bounds
    sx, sy = width / BASE_W, height / BASE_H
    return (
        int(round(x0 * sx)),
        int(round(y0 * sy)),
        int(round(x1 * sx)),
        int(round(y1 * sy)),
    )


def cluster_mesh(mesh: trimesh.Trimesh, cell: float) -> trimesh.Trimesh:
    vertices = np.asarray(mesh.vertices)
    quantized = np.floor((vertices - vertices.min(axis=0)) / cell).astype(np.int64)
    _, inverse = np.unique(quantized, axis=0, return_inverse=True)
    new_count = int(inverse.max()) + 1
    sums = np.zeros((new_count, 3), dtype=np.float64)
    counts = np.bincount(inverse, minlength=new_count).astype(np.float64)
    np.add.at(sums, inverse, vertices)
    new_vertices = sums / counts[:, None]
    new_faces = inverse[np.asarray(mesh.faces)]
    good = (
        (new_faces[:, 0] != new_faces[:, 1])
        & (new_faces[:, 1] != new_faces[:, 2])
        & (new_faces[:, 0] != new_faces[:, 2])
    )
    new_faces = new_faces[good]
    key = np.sort(new_faces, axis=1)
    _, unique = np.unique(key, axis=0, return_index=True)
    new_faces = new_faces[np.sort(unique)]
    return trimesh.Trimesh(vertices=new_vertices, faces=new_faces, process=True)


def iou(a: np.ndarray, b: np.ndarray) -> tuple[float, int, int]:
    first = a > 0
    second = b > 0
    intersection = int(np.logical_and(first, second).sum())
    union = int(np.logical_or(first, second).sum())
    return (float(intersection / union) if union else 1.0, intersection, union)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="public/reference/female-turnaround.jpeg")
    parser.add_argument("--output", default="public/models/sera-v10.glb")
    parser.add_argument("--metrics", default="public/models/sera-v10.metrics.json")
    parser.add_argument("--debug", default="artifacts/sera-v10")
    args = parser.parse_args()

    source_path = Path(args.input)
    output_path = Path(args.output)
    metrics_path = Path(args.metrics)
    debug = Path(args.debug)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    metrics_path.parent.mkdir(parents=True, exist_ok=True)
    debug.mkdir(parents=True, exist_ok=True)

    source = np.asarray(Image.open(source_path).convert("RGB"))
    image_h, image_w, _ = source.shape

    views: dict[str, dict[str, object]] = {}
    for name, base_bounds in PANEL_BASE.items():
        x0, y0, x1, y1 = scaled_panel(base_bounds, image_w, image_h)
        crop = source[y0:y1, x0:x1].copy()
        mask = segment(crop)
        ys_mask, xs_mask = np.where(mask > 0)
        if len(xs_mask) < 1000:
            raise RuntimeError(f"{name} segmentation is too small: {len(xs_mask)}")
        bbox = (int(xs_mask.min()), int(ys_mask.min()), int(xs_mask.max() + 1), int(ys_mask.max() + 1))
        body_height_px = bbox[3] - bbox[1]
        pixels_per_meter = body_height_px / HUMAN_H
        views[name] = {
            "crop": crop,
            "mask": mask,
            "bbox": bbox,
            "ppm": pixels_per_meter,
            "cx": (bbox[0] + bbox[2] - 1) / 2.0,
            "bottom": bbox[3] - 1,
            "width_m": (bbox[2] - bbox[0]) / pixels_per_meter,
        }
        Image.fromarray(crop).save(debug / f"{name}-crop.png")
        Image.fromarray(mask).save(debug / f"{name}-mask.png")

    front_w = float(views["front"]["width_m"])
    side_w = float(views["side"]["width_m"])
    x_extent = max(0.50, front_w * 0.58)
    z_extent = max(0.38, side_w * 0.60)
    nx, nz, ny = 144, 128, 288
    xs = np.linspace(-x_extent, x_extent, nx, dtype=np.float32)
    zs = np.linspace(-z_extent, z_extent, nz, dtype=np.float32)
    ys = np.linspace(0, HUMAN_H, ny, dtype=np.float32)
    grid_x, grid_z = np.meshgrid(xs, zs, indexing="ij")
    volume = np.ones((ny, nx, nz), dtype=bool)

    projected: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for name, degrees in THETA.items():
        view = views[name]
        angle = math.radians(degrees)
        u_world = grid_x * math.cos(angle) - grid_z * math.sin(angle)
        u = (float(view["cx"]) + u_world * float(view["ppm"])).round().astype(np.int32)
        valid = (u >= 0) & (u < view["mask"].shape[1])
        projected[name] = (u, valid)

    for y_index, y_value in enumerate(ys):
        slice_ok = np.ones((nx, nz), dtype=bool)
        for name in ("front", "three-quarter", "side", "back"):
            view = views[name]
            row = int(round(float(view["bottom"]) - y_value * float(view["ppm"])))
            u, valid = projected[name]
            ok = np.zeros_like(slice_ok)
            if 0 <= row < view["mask"].shape[0]:
                safe = np.clip(u, 0, view["mask"].shape[1] - 1)
                ok = valid & (view["mask"][row, safe] > 0)
            slice_ok &= ok
        volume[y_index] = slice_ok

    labels_3d, component_count = label(volume)
    if component_count:
        counts = np.bincount(labels_3d.ravel())
        keep_ids = np.where(counts >= 80)[0]
        keep_ids = keep_ids[keep_ids != 0]
        volume = np.isin(labels_3d, keep_ids)
    filled_voxels = int(volume.sum())
    if filled_voxels < 5000:
        raise RuntimeError(f"visual hull is too small: {filled_voxels}")

    spacing = (ys[1] - ys[0], xs[1] - xs[0], zs[1] - zs[0])
    vertices_yxz, faces, _normals, _ = marching_cubes(
        volume.astype(np.uint8), level=0.5, spacing=spacing, step_size=2, allow_degenerate=False
    )
    vertices = np.column_stack(
        [vertices_yxz[:, 1] + xs[0], vertices_yxz[:, 0] + ys[0], vertices_yxz[:, 2] + zs[0]]
    ).astype(np.float64)
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces.astype(np.int64), process=True)
    try:
        trimesh.smoothing.filter_taubin(mesh, lamb=0.35, nu=0.37, iterations=4)
    except Exception:
        pass
    mesh.remove_unreferenced_vertices()

    base = mesh
    best = base
    for cell in (0.003, 0.004, 0.005, 0.006, 0.007, 0.008, 0.010, 0.012, 0.014, 0.016):
        candidate = cluster_mesh(base, cell)
        if len(candidate.faces) <= 23000:
            best = candidate
            if len(candidate.faces) >= 9000:
                break
    mesh = best
    mesh.remove_unreferenced_vertices()
    mesh.fix_normals()

    def project_point(point: np.ndarray, name: str) -> tuple[float, float]:
        view = views[name]
        angle = math.radians(THETA[name])
        u_world = point[0] * math.cos(angle) - point[2] * math.sin(angle)
        return (
            float(view["cx"]) + u_world * float(view["ppm"]),
            float(view["bottom"]) - point[1] * float(view["ppm"]),
        )

    camera_dirs = {
        "front": np.array([0.0, 0.0, 1.0]),
        "three-quarter": np.array([math.sin(math.radians(45)), 0.0, math.cos(math.radians(45))]),
        "side": np.array([1.0, 0.0, 0.0]),
        "back": np.array([0.0, 0.0, -1.0]),
    }
    face_rgb = np.zeros((len(mesh.faces), 3), dtype=np.uint8)
    for index, (center, normal) in enumerate(zip(mesh.triangles_center, mesh.face_normals)):
        order = sorted(camera_dirs, key=lambda name: float(np.dot(normal, camera_dirs[name])), reverse=True)
        color = None
        for name in order:
            if float(np.dot(normal, camera_dirs[name])) < -0.05:
                continue
            u, v = project_point(center, name)
            view = views[name]
            ui, vi = int(round(u)), int(round(v))
            crop = view["crop"]
            mask = view["mask"]
            if 0 <= ui < crop.shape[1] and 0 <= vi < crop.shape[0] and mask[vi, ui] > 0:
                patch = crop[max(0, vi - 1) : vi + 2, max(0, ui - 1) : ui + 2].reshape(-1, 3)
                color = np.median(patch, axis=0)
                break
        if color is None:
            color = np.array([30, 35, 48])
        face_rgb[index] = np.clip(color, 0, 255).astype(np.uint8)

    k = 14
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 60, 0.8)
    _, labels_k, centers = cv2.kmeans(face_rgb.astype(np.float32), k, None, criteria, 6, cv2.KMEANS_PP_CENTERS)
    quantized = np.clip(centers[labels_k.ravel()], 0, 255).astype(np.uint8)
    rgba = np.column_stack([quantized, np.full(len(quantized), 255, np.uint8)])
    mesh.visual = trimesh.visual.ColorVisuals(mesh=mesh, face_colors=rgba)
    mesh.export(output_path, file_type="glb")

    def raster_mask(name: str) -> np.ndarray:
        view = views[name]
        h, w = view["mask"].shape
        angle = math.radians(THETA[name])
        points = np.empty((len(mesh.vertices), 2), dtype=np.float32)
        u_world = mesh.vertices[:, 0] * math.cos(angle) - mesh.vertices[:, 2] * math.sin(angle)
        points[:, 0] = float(view["cx"]) + u_world * float(view["ppm"])
        points[:, 1] = float(view["bottom"]) - mesh.vertices[:, 1] * float(view["ppm"])
        output = np.zeros((h, w), np.uint8)
        pixel_points = np.round(points).astype(np.int32)
        for face in mesh.faces:
            cv2.fillConvexPoly(output, pixel_points[face], 255)
        return output

    view_metrics: dict[str, dict[str, object]] = {}
    for name in THETA:
        rendered = raster_mask(name)
        reference = views[name]["mask"]
        score, intersection, union = iou(reference, rendered)
        view_metrics[name] = {
            "bbox": [int(value) for value in views[name]["bbox"]],
            "referencePixels": int((reference > 0).sum()),
            "projectionPixels": int((rendered > 0).sum()),
            "iou": score,
            "intersection": intersection,
            "union": union,
        }
        Image.fromarray(rendered).save(debug / f"{name}-hull-projection.png")
        xor = np.logical_xor(reference > 0, rendered > 0)
        Image.fromarray((xor * 255).astype(np.uint8)).save(debug / f"{name}-xor.png")

    metrics = {
        "source": {"width": image_w, "height": image_h},
        "singleVolume": True,
        "threeQuarterYawDegrees": 45.0,
        "grid": [nx, ny, nz],
        "occupiedVoxels": filled_voxels,
        "mesh": {
            "vertices": int(len(mesh.vertices)),
            "triangles": int(len(mesh.faces)),
            "normalizedHeight": 1.0,
            "authoredHeightMeters": HUMAN_H,
            "actualHeightMeters": float(mesh.bounds[1, 1] - mesh.bounds[0, 1]),
            "watertight": bool(mesh.is_watertight),
        },
        "views": view_metrics,
    }
    metrics_path.write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()

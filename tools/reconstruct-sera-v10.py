from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage import measure
import trimesh


PANEL_X = {
    "front": (0.005, 0.253),
    "three-quarter": (0.254, 0.493),
    "side": (0.494, 0.738),
    "back": (0.739, 0.995),
}
ROI = {
    "front": (0.10, 0.02, 0.90, 0.96),
    "three-quarter": (0.09, 0.02, 0.92, 0.97),
    "side": (0.16, 0.02, 0.88, 0.97),
    "back": (0.09, 0.02, 0.91, 0.97),
}
THREE_QUARTER_YAW = math.radians(37.5)
PALETTE = {
    "skin": np.array([211, 161, 132, 255], np.uint8),
    "blue": np.array([36, 82, 197, 255], np.uint8),
    "black": np.array([14, 14, 22, 255], np.uint8),
    "silver": np.array([216, 224, 235, 255], np.uint8),
}


def largest_component(mask: np.ndarray) -> np.ndarray:
    count, labels, stats, centers = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    if count <= 1:
        return mask.astype(bool)
    h, w = mask.shape
    candidates: list[tuple[float, int]] = []
    for index in range(1, count):
        area = int(stats[index, cv2.CC_STAT_AREA])
        if area < h * w * 0.0005:
            continue
        cx, cy = centers[index]
        score = area
        score *= max(0.2, 1.0 - abs(cx - w / 2) / (w * 0.65))
        score *= max(0.2, 1.0 - abs(cy - h * 0.48) / (h * 0.8))
        candidates.append((score, index))
    chosen = max(candidates)[1] if candidates else 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    result = labels == chosen
    distance = ndi.distance_transform_edt(~result)
    for index in range(1, count):
        if index == chosen:
            continue
        component = labels == index
        area = int(component.sum())
        if 20 < area < h * w * 0.02 and np.min(distance[component]) < 5:
            result |= component
    return result


def extract_panels(source: np.ndarray, debug: Path) -> dict[str, dict[str, object]]:
    image_h, image_w, _ = source.shape
    y0 = int(round(image_h * 0.165))
    y1 = int(round(image_h * 0.985))
    panels: dict[str, dict[str, object]] = {}
    for name, (xf0, xf1) in PANEL_X.items():
        x0 = int(round(image_w * xf0))
        x1 = int(round(image_w * xf1))
        crop = source[y0:y1, x0:x1].copy()
        h, w, _ = crop.shape
        rx0, ry0, rx1, ry1 = ROI[name]
        rect = (int(w * rx0), int(h * ry0), int(w * (rx1 - rx0)), int(h * (ry1 - ry0)))
        labels = np.full((h, w), cv2.GC_BGD, np.uint8)
        x, y, rw, rh = rect
        labels[y:y + rh, x:x + rw] = cv2.GC_PR_FGD

        border = np.concatenate([
            crop[: max(5, h // 30)].reshape(-1, 3),
            crop[-max(5, h // 30):].reshape(-1, 3),
            crop[:, : max(5, w // 30)].reshape(-1, 3),
            crop[:, -max(5, w // 30):].reshape(-1, 3),
        ])
        background = np.median(border, axis=0)
        difference = np.linalg.norm(crop.astype(np.float32) - background.astype(np.float32), axis=2)
        hsv = cv2.cvtColor(crop, cv2.COLOR_RGB2HSV)
        seed = ((difference > 23) & (hsv[:, :, 2] > 18)) | ((hsv[:, :, 1] > 45) & (hsv[:, :, 2] > 35))
        inset = np.zeros((h, w), bool)
        inset[max(2, h // 100): h - max(2, h // 100), max(2, w // 100): w - max(2, w // 100)] = True
        labels[seed & inset & (labels != cv2.GC_BGD)] = cv2.GC_FGD
        background_model = np.zeros((1, 65), np.float64)
        foreground_model = np.zeros((1, 65), np.float64)
        cv2.grabCut(
            cv2.cvtColor(crop, cv2.COLOR_RGB2BGR),
            labels,
            None,
            background_model,
            foreground_model,
            8,
            cv2.GC_INIT_WITH_MASK,
        )
        raw = (labels == cv2.GC_FGD) | (labels == cv2.GC_PR_FGD)
        mask = largest_component(raw)
        mask = ndi.binary_closing(mask, structure=np.ones((3, 3)), iterations=1)
        mask = ndi.binary_fill_holes(mask)
        mask &= ndi.binary_dilation(raw, iterations=2)
        ys, xs = np.nonzero(mask)
        if len(xs) < 1000:
            raise RuntimeError(f"{name} segmentation is too small: {len(xs)} pixels")
        bbox = (int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1))
        panels[name] = {"crop": crop, "mask": mask, "bbox": bbox}
        Image.fromarray(crop).save(debug / f"{name}-crop.png")
        Image.fromarray((mask * 255).astype(np.uint8)).save(debug / f"{name}-mask.png")
    return panels


def view_u(name: str, x: np.ndarray, z: np.ndarray) -> np.ndarray:
    if name == "front":
        return x
    if name == "back":
        return -x
    if name == "side":
        return -z
    return math.cos(THREE_QUARTER_YAW) * x - math.sin(THREE_QUARTER_YAW) * z


def build_hull(panels: dict[str, dict[str, object]]) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    body_heights = [int(d["bbox"][3]) - int(d["bbox"][1]) for d in panels.values()]
    shared_height = float(np.median(body_heights))
    for data in panels.values():
        x0, _y0, x1, y1 = data["bbox"]
        data["cx"] = (int(x0) + int(x1) - 1) / 2
        data["bottom"] = float(int(y1) - 1)
        data["scale"] = shared_height
        data["dilated3"] = ndi.binary_dilation(data["mask"], iterations=3)
        data["dilated4"] = ndi.binary_dilation(data["mask"], iterations=4)

    front_box = panels["front"]["bbox"]
    side_box = panels["side"]["bbox"]
    x_half = max((int(front_box[2]) - int(front_box[0])) / (2 * shared_height) * 1.08, 0.13)
    z_half = max((int(side_box[2]) - int(side_box[0])) / (2 * shared_height) * 1.10, 0.10)
    nx, ny, nz = 112, 224, 112
    xs = np.linspace(-x_half, x_half, nx, dtype=np.float32)
    ys = np.linspace(-0.01, 1.03, ny, dtype=np.float32)
    zs = np.linspace(-z_half, z_half, nz, dtype=np.float32)
    grid_x, grid_z = np.meshgrid(xs, zs, indexing="ij")
    occupied = np.zeros((nx, ny, nz), dtype=bool)

    def sample(name: str, u: np.ndarray, y_norm: np.ndarray, dilation: int) -> np.ndarray:
        data = panels[name]
        mask = data["dilated3"] if dilation == 3 else data["dilated4"]
        px = np.rint(float(data["cx"]) + u * float(data["scale"])).astype(np.int32)
        py = np.rint(float(data["bottom"]) - y_norm * float(data["scale"])).astype(np.int32)
        valid = (px >= 0) & (px < mask.shape[1]) & (py >= 0) & (py < mask.shape[0])
        result = np.zeros(px.shape, dtype=bool)
        result[valid] = mask[py[valid], px[valid]]
        return result

    for y_index, y_value in enumerate(ys):
        grid_y = np.full_like(grid_x, y_value)
        front = sample("front", grid_x, grid_y, 3)
        side = sample("side", -grid_z, grid_y, 3)
        back = sample("back", -grid_x, grid_y, 4)
        three = sample("three-quarter", view_u("three-quarter", grid_x, grid_z), grid_y, 4)
        occupied[:, y_index, :] = front & side & (back | three)

    occupied = ndi.binary_closing(occupied, structure=np.ones((3, 3, 3)), iterations=1)
    occupied = ndi.binary_opening(occupied, structure=np.ones((2, 2, 2)), iterations=1)
    labels, count = ndi.label(occupied)
    if count:
        counts = np.bincount(labels.ravel())
        counts[0] = 0
        occupied = labels == int(counts.argmax())
    if int(occupied.sum()) < 5000:
        raise RuntimeError(f"visual hull is too small: {occupied.sum()} voxels")
    return occupied, xs, ys, zs


def build_mesh(occupied: np.ndarray, xs: np.ndarray, ys: np.ndarray, zs: np.ndarray) -> trimesh.Trimesh:
    field = ndi.gaussian_filter(occupied.astype(np.float32), sigma=0.65)
    vertices, faces, _normals, _values = measure.marching_cubes(
        field,
        level=0.45,
        spacing=(float(xs[1] - xs[0]), float(ys[1] - ys[0]), float(zs[1] - zs[0])),
    )
    vertices[:, 0] += xs[0]
    vertices[:, 1] += ys[0]
    vertices[:, 2] += zs[0]
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=True)
    try:
        trimesh.smoothing.filter_taubin(mesh, lamb=0.28, nu=0.30, iterations=3)
    except Exception:
        pass
    if len(mesh.faces) > 18000:
        try:
            mesh = mesh.simplify_quadric_decimation(face_count=15000)
        except Exception:
            pass
    mesh.remove_unreferenced_vertices()
    mesh.fix_normals()
    return mesh


def semantic(rgb: np.ndarray) -> str:
    r, g, b = [int(value) for value in rgb]
    maximum = max(r, g, b)
    minimum = min(r, g, b)
    mean = (r + g + b) / 3
    if b > 80 and b > r * 1.35 and b > g * 1.12:
        return "blue"
    if r > 95 and r > g * 1.05 and r > b * 1.13 and g > 55:
        return "skin"
    if mean > 105 and maximum - minimum < 55:
        return "silver"
    return "black"


def add_reference_colors(mesh: trimesh.Trimesh, panels: dict[str, dict[str, object]]) -> None:
    colors = np.zeros((len(mesh.vertices), 4), np.uint8)
    for index, (vertex, normal) in enumerate(zip(np.asarray(mesh.vertices), np.asarray(mesh.vertex_normals))):
        x, y, z = vertex
        nx, _ny, nz = normal
        if nz > 0.38:
            view = "front"
        elif nz < -0.38:
            view = "back"
        elif nx > 0.15:
            view = "side"
        else:
            view = "three-quarter"
        data = panels[view]
        u = float(view_u(view, np.asarray(x), np.asarray(z)))
        px = int(round(float(data["cx"]) + u * float(data["scale"])))
        py = int(round(float(data["bottom"]) - y * float(data["scale"])))
        crop = data["crop"]
        px = max(0, min(crop.shape[1] - 1, px))
        py = max(0, min(crop.shape[0] - 1, py))
        colors[index] = PALETTE[semantic(crop[py, px])]
    mesh.visual.vertex_colors = colors


def projection_mask(name: str, occupied: np.ndarray, xs: np.ndarray, ys: np.ndarray, zs: np.ndarray, data: dict[str, object]) -> np.ndarray:
    result = np.zeros_like(data["mask"], bool)
    indices = np.argwhere(occupied)
    x = xs[indices[:, 0]]
    y = ys[indices[:, 1]]
    z = zs[indices[:, 2]]
    u = view_u(name, x, z)
    px = np.rint(float(data["cx"]) + u * float(data["scale"])).astype(int)
    py = np.rint(float(data["bottom"]) - y * float(data["scale"])).astype(int)
    valid = (px >= 0) & (px < result.shape[1]) & (py >= 0) & (py < result.shape[0])
    result[py[valid], px[valid]] = True
    return ndi.binary_closing(result, iterations=1)


def iou(first: np.ndarray, second: np.ndarray) -> float:
    intersection = int(np.logical_and(first, second).sum())
    union = int(np.logical_or(first, second).sum())
    return intersection / union if union else 0.0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="public/reference/female-turnaround.jpeg")
    parser.add_argument("--output", default="public/models/sera-v10.glb")
    parser.add_argument("--metrics", default="public/models/sera-v10.metrics.json")
    parser.add_argument("--debug", default="artifacts/sera-v10")
    args = parser.parse_args()

    source = np.asarray(Image.open(args.input).convert("RGB"))
    debug = Path(args.debug)
    debug.mkdir(parents=True, exist_ok=True)
    panels = extract_panels(source, debug)
    occupied, xs, ys, zs = build_hull(panels)
    mesh = build_mesh(occupied, xs, ys, zs)
    # The runtime uses normalized character height 1.0 and applies world scale separately.
    minimum = mesh.bounds[0]
    maximum = mesh.bounds[1]
    height = float(maximum[1] - minimum[1])
    mesh.vertices[:, 0] -= (minimum[0] + maximum[0]) * 0.5
    mesh.vertices[:, 2] -= (minimum[2] + maximum[2]) * 0.5
    mesh.vertices[:, 1] -= minimum[1]
    mesh.vertices /= height
    add_reference_colors(mesh, panels)

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    mesh.export(output, file_type="glb")

    metrics = {
        "source": {"width": int(source.shape[1]), "height": int(source.shape[0])},
        "singleVolume": True,
        "threeQuarterYawDegrees": 37.5,
        "grid": [int(len(xs)), int(len(ys)), int(len(zs))],
        "occupiedVoxels": int(occupied.sum()),
        "mesh": {"vertices": int(len(mesh.vertices)), "triangles": int(len(mesh.faces)), "normalizedHeight": 1.0, "authoredHeightMeters": 1.68},
        "views": {},
    }
    for name, data in panels.items():
        projection = projection_mask(name, occupied, xs, ys, zs, data)
        reference = data["mask"]
        metrics["views"][name] = {
            "bbox": [int(value) for value in data["bbox"]],
            "referencePixels": int(reference.sum()),
            "projectionPixels": int(projection.sum()),
            "iou": iou(reference, projection),
        }
        Image.fromarray((projection * 255).astype(np.uint8)).save(debug / f"{name}-hull-projection.png")
        Image.fromarray((np.logical_xor(reference, projection) * 255).astype(np.uint8)).save(debug / f"{name}-xor.png")

    metrics_path = Path(args.metrics)
    metrics_path.parent.mkdir(parents=True, exist_ok=True)
    metrics_path.write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()

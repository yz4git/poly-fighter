#!/usr/bin/env python3
"""Turn the project's ORIGINAL SERA 4-view character art into direct
image-to-3D/multiview sculpt inputs. No hallucinated interpolation, no
resculpt, no marketing render replacement, no external upload.

Requires Pillow. Run:
  python scripts/prepare-sera-multiview.py \
    public/reference/female-turnaround.jpeg docs/sera-generation-input
"""
import hashlib
import json
import os
import sys
from PIL import Image, ImageOps

if len(sys.argv) != 3:
    raise SystemExit("Usage: script original-turnaround.jpeg output-directory")
source, target = sys.argv[1:]
with open(source, "rb") as f:
    digest = hashlib.sha256(f.read()).hexdigest()
im = Image.open(source).convert("RGB")
width, height = im.size
if width != 1536 or height != 1024:
    raise RuntimeError(
        f"Reference art changed dimensions {width}x{height}; "
        "review face/body crop coordinates instead of generating incorrect art"
    )

# The master image is deliberately authored as four equal camera views with
# full body and consistent materials. Remove UI labels and the header; use
# unchanged pixel values for all body/face/hair surfaces.
views = (
    ("front", (8, 174, 389, 1015)),
    ("three-quarter", (390, 174, 758, 1015)),
    ("side", (760, 174, 1133, 1015)),
    ("back", (1135, 174, 1527, 1015)),
)
os.makedirs(target, exist_ok=True)
report = {
    "subject": "SERA — original reference, NOT generated final mesh",
    "master_reference": source,
    "master_sha256": digest,
    "master_size_px": [width, height],
    "output_size_px": [640, 1280],
    "provenance": "Unaltered original pixels; crop/resize/pad only, no AI reimagination",
    "review_required": "Compare generated head/hair/garments with all four views",
    "views": [],
}
for label, rect in views:
    cut = im.crop(rect)
    # Re-center while maintaining exact figure proportions and background;
    # do NOT stretch the anatomy to fit a different model's template.
    frame = ImageOps.contain(cut, (640, 1280), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (640, 1280), (24, 24, 25))
    canvas.paste(frame, ((640 - frame.width)//2, (1280 - frame.height)//2))
    destination = os.path.join(target, label + ".png")
    canvas.save(destination, "PNG", optimize=True)
    with open(destination,"rb") as f:
        target_hash=hashlib.sha256(f.read()).hexdigest()
    report["views"].append({
        "name": label, "crop_xyxy": list(rect),
        "image": label + ".png",
        "sha256": target_hash,
        "width": 640, "height": 1280,
    })
with open(os.path.join(target, "manifest.json"),"w",encoding="utf-8") as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
print("SERA_ORIGINAL_FOUR_VIEW_INPUTS_READY", json.dumps({
    "source_sha256":digest, "views":[v["name"] for v in report["views"]]
}))

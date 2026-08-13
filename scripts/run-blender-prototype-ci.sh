#!/usr/bin/env bash
set -euo pipefail

branch="${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-}}"
if [[ "$branch" != "chatgpt/blender-sera-prototype" ]]; then
  echo "Blender prototype skipped on branch: ${branch:-local}"
  exit 0
fi

sudo apt-get update -qq
sudo apt-get install -y blender python3-numpy libegl1 libgl1-mesa-dri xvfb
blender --version | head -n 2

export PYTHONPATH="/usr/lib/python3/dist-packages${PYTHONPATH:+:$PYTHONPATH}"
blender --background --python-use-system-env --python-expr "import numpy; print('BLENDER_NUMPY', numpy.__version__)"

out="artifacts/visual-audit/blender-sera"
mkdir -p "$out"
xvfb-run -a blender --background \
  --python-use-system-env \
  --python-exit-code 1 \
  --python tools/blender/build-sera-prototype.py \
  -- --output-dir "$out"

test -s "$out/sera-blender-prototype.blend"
test -s "$out/sera-blender-prototype.glb"
for view in front three-quarter side back; do
  test -s "$out/sera-blender-${view}.png"
  file "$out/sera-blender-${view}.png" | grep -q "PNG image data"
done
cat "$out/blender-version.txt"

#!/usr/bin/env python3
"""Export a UniMate-animated UAL GLB/FBX as BVH for Motion Foundry.

Run under Blender:
  blender -b --python tools/unimate/export-animated-ual-bvh.py -- \
    --source animated.glb --output refined.bvh

The official UniMate custom-asset path preserves the source rig's joint names.
For POLY FIGHTER that means the UAL names (pelvis, upperarm_l, thigh_r, ...),
which motion_foundry_v6_mocap.py now consumes as an identity-profile prior.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import bpy


REQUIRED_UAL = {
    "pelvis",
    "spine_02",
    "upperarm_l",
    "upperarm_r",
    "thigh_l",
    "calf_l",
    "foot_l",
    "thigh_r",
    "calf_r",
    "foot_r",
}


def _argv() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def _reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)


def _import_asset(path: Path) -> None:
    suffix = path.suffix.lower()
    if suffix in {".glb", ".gltf"}:
        bpy.ops.import_scene.gltf(filepath=str(path))
    elif suffix == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(path), automatic_bone_orientation=False)
    else:
        raise ValueError(f"Unsupported animated asset format: {path.suffix}")


def _choose_armature() -> bpy.types.Object:
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if not armatures:
        raise RuntimeError("Animated asset contains no armature")
    compatible = [
        obj for obj in armatures if REQUIRED_UAL.issubset(set(obj.pose.bones.keys()))
    ]
    pool = compatible or armatures
    armature = max(pool, key=lambda obj: len(obj.pose.bones))
    missing = sorted(REQUIRED_UAL - set(armature.pose.bones.keys()))
    if missing:
        raise RuntimeError(
            "UniMate bridge expected the POLY FIGHTER UAL skeleton; "
            f"missing bones: {missing}"
        )
    return armature


def _choose_action(armature: bpy.types.Object) -> bpy.types.Action:
    active = armature.animation_data.action if armature.animation_data else None
    if active is not None:
        return active

    # glTF import can place clips in NLA tracks rather than the active action.
    if armature.animation_data:
        strips = [
            strip
            for track in armature.animation_data.nla_tracks
            for strip in track.strips
            if strip.action is not None
        ]
        if strips:
            action = max(
                (strip.action for strip in strips),
                key=lambda item: item.frame_range[1] - item.frame_range[0],
            )
            armature.animation_data.action = action
            return action

    candidates = [
        action for action in bpy.data.actions
        if any(group.name in armature.pose.bones for group in action.groups)
    ]
    if not candidates:
        raise RuntimeError("Animated UAL asset contains no usable action")
    action = max(
        candidates,
        key=lambda item: item.frame_range[1] - item.frame_range[0],
    )
    if armature.animation_data is None:
        armature.animation_data_create()
    armature.animation_data.action = action
    return action


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--fps", type=int, default=30)
    args = parser.parse_args(_argv())

    source = Path(args.source).resolve()
    output = Path(args.output).resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    output.parent.mkdir(parents=True, exist_ok=True)

    _reset_scene()
    _import_asset(source)
    armature = _choose_armature()
    action = _choose_action(armature)

    start = max(1, int(round(action.frame_range[0])))
    end = max(start + 1, int(round(action.frame_range[1])))
    scene = bpy.context.scene
    scene.render.fps = max(1, args.fps)
    scene.frame_start = start
    scene.frame_end = end

    bpy.ops.object.select_all(action="DESELECT")
    armature.hide_set(False)
    armature.hide_viewport = False
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    scene.frame_set(start)

    bpy.ops.export_anim.bvh(
        filepath=str(output),
        global_scale=1.0,
        frame_start=start,
        frame_end=end,
        rotate_mode="NATIVE",
        root_transform_only=False,
    )
    if not output.is_file() or output.stat().st_size < 256:
        raise RuntimeError(f"BVH export failed or empty: {output}")

    print(
        "POLY_FIGHTER_UNIMATE_BVH "
        f"source={source.name} action={action.name} frames={start}:{end} "
        f"fps={scene.render.fps} output={output}"
    )


if __name__ == "__main__":
    main()

import argparse
import math
import os
import sys

import bpy
from mathutils import Vector


# SERA Blender proof-of-concept. This intentionally does not replace the runtime
# fighter yet: it proves a repeatable Blender -> GLB/.blend -> real render path.
# The proportions and large blue/black/silver color masses follow the current
# Golden References while keeping the geometry simple enough to iterate quickly.


def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1 :] if "--" in argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default="artifacts/blender-sera")
    return parser.parse_args(argv)


def clean_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        # Keep materials only when created later; at startup this removes defaults.
        for block in list(datablocks):
            if getattr(block, "users", 0) == 0:
                datablocks.remove(block)


def rgba(hex_color):
    return (
        ((hex_color >> 16) & 0xFF) / 255.0,
        ((hex_color >> 8) & 0xFF) / 255.0,
        (hex_color & 0xFF) / 255.0,
        1.0,
    )


def material(name, color, roughness=0.72, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = rgba(color)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba(color)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
    return mat


def add_material(obj, mat):
    obj.data.materials.append(mat)


def add_ico(name, loc, scale, mat, subdivisions=2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1.0, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    add_material(obj, mat)
    for poly in obj.data.polygons:
        poly.use_smooth = False
    return obj


def add_cone(name, loc, radius1, radius2, depth, scale_xy, mat, vertices=8, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius1,
        radius2=radius2,
        depth=depth,
        end_fill_type="NGON",
        location=loc,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale.x = scale_xy[0]
    obj.scale.y = scale_xy[1]
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    add_material(obj, mat)
    for poly in obj.data.polygons:
        poly.use_smooth = False
    return obj


def add_segment(name, a, b, radius_a, radius_b, mat, squash=(1.0, 1.0), vertices=7):
    a = Vector(a)
    b = Vector(b)
    delta = b - a
    depth = delta.length
    mid = (a + b) * 0.5
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius_a,
        radius2=radius_b,
        depth=depth,
        end_fill_type="NGON",
        location=mid,
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = delta.to_track_quat("Z", "Y")
    obj.scale.x = squash[0]
    obj.scale.y = squash[1]
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    add_material(obj, mat)
    for poly in obj.data.polygons:
        poly.use_smooth = False
    return obj


def add_box(name, loc, scale, mat, rotation=(0.0, 0.0, 0.0), bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        mod = obj.modifiers.new(name="Facet bevel", type="BEVEL")
        mod.width = bevel
        mod.segments = 1
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    add_material(obj, mat)
    for poly in obj.data.polygons:
        poly.use_smooth = False
    return obj


def add_wedge(name, verts, faces, mat):
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update(calc_edges=True)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    add_material(obj, mat)
    return obj


def create_armature():
    arm_data = bpy.data.armatures.new("SERA_CanonicalRig")
    arm_obj = bpy.data.objects.new("SERA_CanonicalRig", arm_data)
    bpy.context.collection.objects.link(arm_obj)
    arm_obj.show_in_front = True
    bpy.context.view_layer.objects.active = arm_obj
    arm_obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    specs = {
        "root": ((0, 0, 0.00), (0, 0, 0.10), None),
        "hips": ((0, 0, 0.86), (0, 0, 1.00), "root"),
        "spineLower": ((0, 0, 1.00), (0, 0, 1.14), "hips"),
        "spineUpper": ((0, 0, 1.14), (0, 0, 1.31), "spineLower"),
        "chest": ((0, 0, 1.31), (0, 0, 1.39), "spineUpper"),
        "neck": ((0, 0, 1.39), (0, 0, 1.48), "chest"),
        "head": ((0, 0, 1.48), (0, 0, 1.66), "neck"),
        "leftUpperArm": ((-0.19, 0, 1.37), (-0.31, 0.01, 1.18), "chest"),
        "leftForearm": ((-0.31, 0.01, 1.18), (-0.39, 0.03, 1.01), "leftUpperArm"),
        "leftHand": ((-0.39, 0.03, 1.01), (-0.41, 0.06, 0.93), "leftForearm"),
        "rightUpperArm": ((0.19, 0, 1.37), (0.28, 0.06, 1.25), "chest"),
        "rightForearm": ((0.28, 0.06, 1.25), (0.18, 0.13, 1.39), "rightUpperArm"),
        "rightHand": ((0.18, 0.13, 1.39), (0.12, 0.18, 1.44), "rightForearm"),
        "leftThigh": ((-0.09, 0, 0.88), (-0.23, -0.02, 0.48), "hips"),
        "leftShin": ((-0.23, -0.02, 0.48), (-0.30, 0.02, 0.13), "leftThigh"),
        "leftFoot": ((-0.30, 0.02, 0.13), (-0.31, 0.19, 0.07), "leftShin"),
        "rightThigh": ((0.09, 0, 0.88), (0.22, 0.05, 0.54), "hips"),
        "rightShin": ((0.22, 0.05, 0.54), (0.34, 0.11, 0.15), "rightThigh"),
        "rightFoot": ((0.34, 0.11, 0.15), (0.35, 0.29, 0.07), "rightShin"),
    }
    bones = {}
    for name, (head, tail, parent) in specs.items():
        bone = arm_data.edit_bones.new(name)
        bone.head = head
        bone.tail = tail
        if parent:
            bone.parent = bones[parent]
        bones[name] = bone
    bpy.ops.object.mode_set(mode="OBJECT")
    arm_obj.hide_render = True
    arm_obj.hide_viewport = True
    return arm_obj


def build_character(mats):
    skin, black, blue, silver, hair, eye, mouth = (
        mats["skin"], mats["black"], mats["blue"], mats["silver"], mats["hair"], mats["eye"], mats["mouth"]
    )

    objects = []

    # Torso: broad upper body, narrow exposed midriff, and wider pelvis.
    objects.append(add_cone("TorsoBlue", (0, 0.015, 1.25), 0.18, 0.23, 0.30, (1.0, 0.58), blue, 8))
    objects.append(add_cone("MidriffSkin", (0, 0.010, 1.02), 0.14, 0.13, 0.18, (1.0, 0.62), skin, 8))
    objects.append(add_cone("PelvisBlack", (0, -0.005, 0.88), 0.18, 0.15, 0.18, (1.0, 0.68), black, 8))
    objects.append(add_box("ChestBlackPanel", (0, 0.115, 1.25), (0.105, 0.028, 0.10), black, rotation=(math.radians(-5), 0, 0), bevel=0.012))
    objects.append(add_box("HighBlueCollar", (0, -0.010, 1.42), (0.16, 0.075, 0.075), blue, bevel=0.015))

    # Neck and head.
    objects.append(add_cone("Neck", (0, 0, 1.48), 0.055, 0.050, 0.12, (1.0, 0.88), skin, 7))
    objects.append(add_ico("Head", (0, 0.015, 1.61), (0.105, 0.090, 0.145), skin, 2))
    # Jaw/cheek plane and nose projection.
    objects.append(add_cone("Jaw", (0, 0.065, 1.555), 0.080, 0.102, 0.100, (1.0, 0.70), skin, 6))
    objects.append(add_wedge(
        "Nose",
        [(-0.018, 0.092, 1.625), (0.018, 0.092, 1.625), (0.0, 0.145, 1.595), (-0.015, 0.090, 1.585), (0.015, 0.090, 1.585)],
        [(0, 1, 2), (0, 2, 3), (1, 4, 2), (3, 2, 4), (0, 3, 4, 1)],
        skin,
    ))
    # Eye/brow/mouth planes large enough to read in prototype renders.
    for side in (-1, 1):
        objects.append(add_box(f"Eye_{side}", (side * 0.038, 0.104, 1.635), (0.027, 0.006, 0.008), eye, rotation=(0, 0, math.radians(-side * 8))))
        objects.append(add_box(f"Brow_{side}", (side * 0.040, 0.102, 1.660), (0.032, 0.006, 0.007), hair, rotation=(0, 0, math.radians(-side * 10))))
    objects.append(add_box("Mouth", (0, 0.103, 1.555), (0.038, 0.005, 0.006), mouth))

    # Hair mass and reference ponytail.
    objects.append(add_ico("HairCap", (0, -0.018, 1.67), (0.118, 0.100, 0.125), hair, 2))
    objects.append(add_box("FringeL", (-0.035, 0.085, 1.665), (0.045, 0.020, 0.085), hair, rotation=(math.radians(-10), math.radians(4), math.radians(-13)), bevel=0.008))
    objects.append(add_box("FringeR", (0.033, 0.084, 1.665), (0.045, 0.020, 0.080), hair, rotation=(math.radians(-10), math.radians(-4), math.radians(13)), bevel=0.008))
    objects.append(add_segment("PonytailUpper", (0.00, -0.10, 1.73), (0.03, -0.18, 1.54), 0.075, 0.062, hair, (0.72, 1.0), 7))
    objects.append(add_segment("PonytailMid", (0.03, -0.18, 1.54), (0.05, -0.22, 1.28), 0.062, 0.042, hair, (0.72, 1.0), 7))
    objects.append(add_segment("PonytailTip", (0.05, -0.22, 1.28), (0.04, -0.20, 1.08), 0.042, 0.018, hair, (0.72, 1.0), 7))
    objects.append(add_box("HairTie", (0.0, -0.10, 1.73), (0.070, 0.025, 0.018), blue, bevel=0.006))

    # Signature-stance arms. Left hand is lower/open-side, right hand protects face.
    objects.append(add_segment("LeftUpperArmSkin", (-0.18, 0.0, 1.36), (-0.31, 0.02, 1.18), 0.055, 0.045, skin, (0.88, 1.0)))
    objects.append(add_segment("LeftForearmBlack", (-0.31, 0.02, 1.18), (-0.39, 0.055, 1.00), 0.050, 0.038, black, (0.88, 1.0)))
    objects.append(add_segment("RightUpperArmSkin", (0.18, 0.0, 1.36), (0.28, 0.07, 1.24), 0.055, 0.045, skin, (0.88, 1.0)))
    objects.append(add_segment("RightForearmBlack", (0.28, 0.07, 1.24), (0.17, 0.14, 1.40), 0.050, 0.038, black, (0.88, 1.0)))
    objects.append(add_segment("LeftBracer", (-0.32, 0.035, 1.16), (-0.38, 0.058, 1.03), 0.055, 0.043, silver, (0.70, 1.0), 6))
    objects.append(add_segment("RightBracer", (0.26, 0.082, 1.27), (0.19, 0.135, 1.38), 0.055, 0.043, silver, (0.70, 1.0), 6))
    objects.append(add_ico("LeftHand", (-0.405, 0.072, 0.955), (0.045, 0.035, 0.070), black, 1))
    objects.append(add_ico("RightHand", (0.125, 0.18, 1.445), (0.045, 0.035, 0.070), black, 1))

    # Legs in a grounded wide fighting stance.
    objects.append(add_segment("LeftThighSkin", (-0.085, 0.0, 0.90), (-0.225, -0.02, 0.52), 0.085, 0.070, skin, (0.86, 1.0), 7))
    objects.append(add_segment("LeftThighBlack", (-0.225, -0.02, 0.52), (-0.275, 0.0, 0.35), 0.075, 0.060, black, (0.86, 1.0), 7))
    objects.append(add_segment("LeftShinBlack", (-0.275, 0.0, 0.35), (-0.30, 0.03, 0.13), 0.060, 0.042, black, (0.84, 1.0), 7))
    objects.append(add_segment("RightThighSkin", (0.085, 0.0, 0.90), (0.215, 0.05, 0.56), 0.085, 0.070, skin, (0.86, 1.0), 7))
    objects.append(add_segment("RightThighBlack", (0.215, 0.05, 0.56), (0.28, 0.08, 0.36), 0.075, 0.060, black, (0.86, 1.0), 7))
    objects.append(add_segment("RightShinBlack", (0.28, 0.08, 0.36), (0.34, 0.12, 0.14), 0.060, 0.042, black, (0.84, 1.0), 7))

    # Blue shin armor and pointed boots.
    objects.append(add_segment("LeftShinArmor", (-0.285, 0.035, 0.32), (-0.30, 0.075, 0.14), 0.055, 0.035, blue, (0.64, 1.0), 6))
    objects.append(add_segment("RightShinArmor", (0.295, 0.11, 0.33), (0.34, 0.16, 0.15), 0.055, 0.035, blue, (0.64, 1.0), 6))

    def boot(name, x, y, mirror=1):
        verts = [
            (x - 0.055, y - 0.035, 0.02), (x + 0.055, y - 0.035, 0.02),
            (x + 0.050, y + 0.065, 0.02), (x - 0.050, y + 0.065, 0.02),
            (x - 0.050, y - 0.025, 0.12), (x + 0.050, y - 0.025, 0.12),
            (x + 0.030, y + 0.20, 0.065), (x - 0.030, y + 0.20, 0.065),
            (x, y + 0.30, 0.045),
        ]
        faces = [
            (0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2),
            (3, 2, 6, 7), (0, 3, 7, 4), (7, 6, 8), (3, 2, 8), (2, 6, 8), (3, 8, 7),
        ]
        return add_wedge(name, verts, faces, blue)

    objects.append(boot("LeftBoot", -0.30, 0.03))
    objects.append(boot("RightBoot", 0.34, 0.12))

    # Asymmetric waist panels from the reference set.
    objects.append(add_wedge(
        "WaistPanelFront",
        [(-0.12, 0.075, 0.91), (0.12, 0.075, 0.91), (0.09, 0.11, 0.62), (-0.07, 0.11, 0.58),
         (-0.12, 0.02, 0.91), (0.12, 0.02, 0.91), (0.09, 0.04, 0.62), (-0.07, 0.04, 0.58)],
        [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)],
        blue,
    ))
    objects.append(add_wedge(
        "WaistPanelBack",
        [(-0.11, -0.07, 0.91), (0.11, -0.07, 0.91), (0.08, -0.12, 0.64), (-0.09, -0.12, 0.61),
         (-0.11, -0.02, 0.91), (0.11, -0.02, 0.91), (0.08, -0.05, 0.64), (-0.09, -0.05, 0.61)],
        [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)],
        blue,
    ))

    return objects


def setup_render():
    scene = bpy.context.scene
    # Blender 4.2+ renamed EEVEE. Ubuntu repositories may still ship 3.x.
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            scene.render.engine = engine
            break
        except Exception:
            continue
    scene.render.resolution_x = 640
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.world.color = (0.012, 0.016, 0.025)
    scene.render.film_transparent = False

    # Ground plane.
    ground_mat = material("Ground", 0x151923, 0.88, 0.0)
    bpy.ops.mesh.primitive_plane_add(size=6.0, location=(0, 0, 0))
    ground = bpy.context.object
    ground.name = "Ground"
    add_material(ground, ground_mat)

    # Camera.
    cam_data = bpy.data.cameras.new("AuditCamera")
    cam = bpy.data.objects.new("AuditCamera", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 2.05
    scene.camera = cam

    # Key/fill/rim lights.
    def area(name, loc, energy, size, color):
        data = bpy.data.lights.new(name, type="AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        data.color = color
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.location = loc
        return obj

    key = area("Key", (2.8, 2.8, 4.0), 850, 3.0, (0.92, 0.96, 1.0))
    fill = area("Fill", (-2.0, 1.0, 2.4), 420, 2.5, (0.55, 0.68, 1.0))
    rim = area("Rim", (0.0, -2.8, 3.0), 650, 2.0, (0.35, 0.55, 1.0))

    def point_at(obj, target):
        direction = Vector(target) - obj.location
        obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    for light in (key, fill, rim):
        point_at(light, (0, 0, 0.95))
    return cam, point_at


def render_views(output_dir, cam, point_at):
    views = {
        "front": (0.0, 4.0, 1.05),
        "three-quarter": (2.85, 2.85, 1.05),
        "side": (4.0, 0.0, 1.05),
        "back": (0.0, -4.0, 1.05),
    }
    for name, loc in views.items():
        cam.location = loc
        point_at(cam, (0, 0, 0.93))
        bpy.context.scene.render.filepath = os.path.join(output_dir, f"sera-blender-{name}.png")
        bpy.ops.render.render(write_still=True)


def main():
    args = parse_args()
    output_dir = os.path.abspath(args.output_dir)
    os.makedirs(output_dir, exist_ok=True)
    clean_scene()

    mats = {
        "skin": material("Skin", 0xD8A287, 0.72),
        "black": material("NearBlack", 0x111218, 0.76),
        "blue": material("SeraBlue", 0x285FD5, 0.66),
        "silver": material("Silver", 0xC7D0DE, 0.48, 0.18),
        "hair": material("Hair", 0x151319, 0.68),
        "eye": material("Eye", 0xEDF4FF, 0.55),
        "mouth": material("Mouth", 0x6C3B43, 0.75),
    }

    build_character(mats)
    create_armature()
    cam, point_at = setup_render()

    blend_path = os.path.join(output_dir, "sera-blender-prototype.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)

    glb_path = os.path.join(output_dir, "sera-blender-prototype.glb")
    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
    )

    render_views(output_dir, cam, point_at)

    with open(os.path.join(output_dir, "blender-version.txt"), "w", encoding="utf-8") as fp:
        fp.write(bpy.app.version_string + "\n")
    with open(os.path.join(output_dir, "README.txt"), "w", encoding="utf-8") as fp:
        fp.write(
            "SERA Blender prototype generated headlessly in GitHub Actions.\n"
            "This is a modeling pipeline proof, not yet the in-game runtime asset.\n"
            "Outputs: editable .blend, GLB, and four real Blender renders.\n"
        )

    print("SERA_BLENDER_PROTOTYPE_OK", glb_path)


if __name__ == "__main__":
    main()

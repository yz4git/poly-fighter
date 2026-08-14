from sera_blender_helpers import add_box, add_ico, add_segment, add_wedge, material


def bone_points(armature, name):
    bone = armature.pose.bones.get(name)
    if bone is None:
        raise RuntimeError('missing source rig bone ' + name)
    return armature.matrix_world @ bone.head, armature.matrix_world @ bone.tail


def apply(armature, mats):
    blue, blue_hi, black = mats[1], mats[2], mats[3]
    silver = material('SERA_Silver', 0x9FADC2, 0.55, 0.24)
    hair = material('SERA_Hair', 0x17151A, 0.86)
    eye = material('SERA_Eye', 0x211A18, 0.76)
    brow = material('SERA_Brow', 0x17151A, 0.84)
    lip = material('SERA_Lip', 0x8A4D55, 0.80)
    skin_shadow = material('SERA_SkinShadow', 0xB97967, 0.82)

    add_box('SERA_Collar', (0, -0.004, 1.405), (0.122, 0.050, 0.047), blue_hi, bevel=0.007)
    faces = [(0,1,2,3),(4,7,6,5),(0,4,5,1),(3,2,6,7),(1,5,6,2),(0,3,7,4)]
    add_wedge('SERA_FrontSkirt', [
        (-0.120,0.070,0.955),(0.095,0.070,0.955),(0.070,0.080,0.625),(-0.045,0.080,0.585),
        (-0.120,0.030,0.955),(0.095,0.030,0.955),(0.070,0.035,0.625),(-0.045,0.035,0.585)], faces, blue_hi)
    add_wedge('SERA_LeftSkirt', [
        (-0.165,0.025,0.940),(-0.085,0.025,0.925),(-0.105,0.015,0.635),(-0.205,0.010,0.700),
        (-0.165,-0.020,0.940),(-0.085,-0.020,0.925),(-0.105,-0.025,0.635),(-0.205,-0.025,0.700)], faces, blue)
    add_wedge('SERA_RightSkirt', [
        (0.165,0.020,0.940),(0.090,0.020,0.925),(0.105,0.010,0.675),(0.205,0.005,0.735),
        (0.165,-0.022,0.940),(0.090,-0.022,0.925),(0.105,-0.028,0.675),(0.205,-0.028,0.735)], faces, black)

    # Keep the source head as the coherent anatomical base, then layer only the
    # large SERA identity planes that the turnaround needs to read at game scale.
    add_ico('SERA_HairCap', (0,-0.012,1.575), (0.112,0.098,0.118), hair, 2)
    add_wedge('SERA_FringeL', [
        (-0.094,0.100,1.655),(-0.008,0.101,1.650),(-0.018,0.105,1.588),(-0.060,0.105,1.565),
        (-0.094,0.070,1.655),(-0.008,0.071,1.650),(-0.018,0.075,1.588),(-0.060,0.075,1.565)], faces, hair)
    add_wedge('SERA_FringeR', [
        (0.008,0.101,1.650),(0.094,0.100,1.655),(0.060,0.105,1.565),(0.018,0.105,1.588),
        (0.008,0.071,1.650),(0.094,0.070,1.655),(0.060,0.075,1.565),(0.018,0.075,1.588)], faces, hair)
    add_box('SERA_TempleLockL', (-0.088,0.078,1.570), (0.016,0.012,0.052), hair, rotation=(-0.08,0.02,-0.10), bevel=0.003)
    add_box('SERA_TempleLockR', (0.088,0.078,1.570), (0.016,0.012,0.052), hair, rotation=(-0.08,-0.02,0.10), bevel=0.003)
    add_box('SERA_HairTie', (0,-0.092,1.665), (0.055,0.020,0.015), blue_hi, bevel=0.003)
    add_segment('SERA_Pony1', (0,-0.100,1.675), (0.025,-0.175,1.500), 0.064,0.052,hair,(0.70,1),7)
    add_segment('SERA_Pony2', (0.025,-0.175,1.500), (0.040,-0.205,1.265), 0.052,0.032,hair,(0.68,1),7)
    add_segment('SERA_Pony3', (0.040,-0.205,1.265), (0.030,-0.175,1.075), 0.032,0.010,hair,(0.66,1),7)

    # Minimal flat-shaded facial planes. These are deliberately shallow so the
    # underlying free head remains the silhouette source from every camera.
    add_box('SERA_BrowL', (-0.032,0.108,1.600), (0.029,0.006,0.004), brow, rotation=(0.0,0.0,-0.10), bevel=0.0015)
    add_box('SERA_BrowR', (0.032,0.108,1.600), (0.029,0.006,0.004), brow, rotation=(0.0,0.0,0.10), bevel=0.0015)
    add_box('SERA_EyeL', (-0.031,0.111,1.579), (0.025,0.006,0.004), eye, rotation=(0.0,0.0,-0.035), bevel=0.0015)
    add_box('SERA_EyeR', (0.031,0.111,1.579), (0.025,0.006,0.004), eye, rotation=(0.0,0.0,0.035), bevel=0.0015)
    add_box('SERA_NosePlane', (0.0,0.109,1.553), (0.008,0.008,0.026), skin_shadow, bevel=0.002)
    add_box('SERA_Lip', (0.0,0.111,1.526), (0.024,0.006,0.004), lip, bevel=0.0015)

    for side in ('l','r'):
        a,b = bone_points(armature, 'lowerarm_' + side)
        add_segment('SERA_Guard_' + side, a.lerp(b,0.43), a.lerp(b,0.88), 0.046,0.030,silver,(0.68,1),6)
        a,b = bone_points(armature, 'calf_' + side)
        add_segment('SERA_Shin_' + side, a.lerp(b,0.20), a.lerp(b,0.90), 0.050,0.030,blue_hi,(0.69,1),7)

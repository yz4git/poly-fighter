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

    add_ico('SERA_HairCap', (0,-0.012,1.575), (0.112,0.098,0.118), hair, 2)
    add_box('SERA_FringeL', (-0.037,0.082,1.590), (0.041,0.014,0.073), hair, rotation=(-0.12,0.04,-0.20), bevel=0.004)
    add_box('SERA_FringeR', (0.037,0.082,1.593), (0.041,0.014,0.069), hair, rotation=(-0.12,-0.04,0.20), bevel=0.004)
    add_box('SERA_HairTie', (0,-0.092,1.665), (0.055,0.020,0.015), blue_hi, bevel=0.003)
    add_segment('SERA_Pony1', (0,-0.100,1.675), (0.025,-0.175,1.500), 0.064,0.052,hair,(0.70,1),7)
    add_segment('SERA_Pony2', (0.025,-0.175,1.500), (0.040,-0.205,1.265), 0.052,0.032,hair,(0.68,1),7)
    add_segment('SERA_Pony3', (0.040,-0.205,1.265), (0.030,-0.175,1.075), 0.032,0.010,hair,(0.66,1),7)

    for side in ('l','r'):
        a,b = bone_points(armature, 'lowerarm_' + side)
        add_segment('SERA_Guard_' + side, a.lerp(b,0.43), a.lerp(b,0.88), 0.046,0.030,silver,(0.68,1),6)
        a,b = bone_points(armature, 'calf_' + side)
        add_segment('SERA_Shin_' + side, a.lerp(b,0.20), a.lerp(b,0.90), 0.050,0.030,blue_hi,(0.69,1),7)

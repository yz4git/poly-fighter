from sera_blender_helpers import SERA_FRONT_Y, add_box, add_ico, add_segment, add_wedge, material


def bone_points(armature, name):
    bone = armature.pose.bones.get(name)
    if bone is None:
        raise RuntimeError('missing source rig bone ' + name)
    return armature.matrix_world @ bone.head, armature.matrix_world @ bone.tail


def fy(value):
    """Map authored +front depth into the imported character's Blender axis."""
    return value * SERA_FRONT_Y


def apply(armature, mats):
    blue, blue_hi, black = mats[1], mats[2], mats[3]
    silver = material('SERA_Silver', 0x9FADC2, 0.55, 0.24)
    hair = material('SERA_Hair', 0x17151A, 0.86)
    eye = material('SERA_Eye', 0x211A18, 0.76)
    brow = material('SERA_Brow', 0x17151A, 0.84)
    lip = material('SERA_Lip', 0x8A4D55, 0.80)
    skin_shadow = material('SERA_SkinShadow', 0xB97967, 0.82)

    add_box('SERA_Collar', (0, fy(-0.004), 1.405), (0.122, 0.050, 0.047), blue_hi, bevel=0.007)
    faces = [(0,1,2,3),(4,7,6,5),(0,4,5,1),(3,2,6,7),(1,5,6,2),(0,3,7,4)]
    add_wedge('SERA_FrontSkirt', [
        (-0.120,fy(0.070),0.955),(0.095,fy(0.070),0.955),(0.070,fy(0.080),0.625),(-0.045,fy(0.080),0.585),
        (-0.120,fy(0.030),0.955),(0.095,fy(0.030),0.955),(0.070,fy(0.035),0.625),(-0.045,fy(0.035),0.585)], faces, blue_hi)
    add_wedge('SERA_LeftSkirt', [
        (-0.165,fy(0.025),0.940),(-0.085,fy(0.025),0.925),(-0.105,fy(0.015),0.635),(-0.205,fy(0.010),0.700),
        (-0.165,fy(-0.020),0.940),(-0.085,fy(-0.020),0.925),(-0.105,fy(-0.025),0.635),(-0.205,fy(-0.025),0.700)], faces, blue)
    add_wedge('SERA_RightSkirt', [
        (0.165,fy(0.020),0.940),(0.090,fy(0.020),0.925),(0.105,fy(0.010),0.675),(0.205,fy(0.005),0.735),
        (0.165,fy(-0.022),0.940),(0.090,fy(-0.022),0.925),(0.105,fy(-0.028),0.675),(0.205,fy(-0.028),0.735)], faces, black)

    # Hair follows the imported Quaternius forward convention explicitly.
    # The cap is a coherent skull volume; two swept fringe locks start near the
    # center part and open outward so they frame the face instead of crossing it.
    add_ico('SERA_HairCap', (0,fy(-0.014),1.580), (0.108,0.092,0.114), hair, 2)
    add_segment('SERA_FringeL', (-0.016,fy(0.090),1.653), (-0.054,fy(0.096),1.603), 0.019,0.0075,hair,(0.48,1.0),6)
    add_segment('SERA_FringeR', (0.016,fy(0.090),1.653), (0.054,fy(0.096),1.603), 0.019,0.0075,hair,(0.48,1.0),6)
    add_segment('SERA_TempleLockL', (-0.074,fy(0.066),1.630), (-0.081,fy(0.073),1.558), 0.012,0.0055,hair,(0.50,1.0),6)
    add_segment('SERA_TempleLockR', (0.074,fy(0.066),1.630), (0.081,fy(0.073),1.558), 0.012,0.0055,hair,(0.50,1.0),6)
    add_box('SERA_HairTie', (0,fy(-0.095),1.668), (0.048,0.018,0.014), blue_hi, bevel=0.003)
    add_segment('SERA_Pony1', (0,fy(-0.102),1.675), (0.020,fy(-0.166),1.510), 0.054,0.045,hair,(0.66,1),7)
    add_segment('SERA_Pony2', (0.020,fy(-0.166),1.510), (0.034,fy(-0.190),1.300), 0.045,0.029,hair,(0.64,1),7)
    add_segment('SERA_Pony3', (0.034,fy(-0.190),1.300), (0.027,fy(-0.164),1.125), 0.029,0.009,hair,(0.62,1),7)

    # Facial accents use the same forward convention as the fringe, preventing
    # a false face from being constructed on the back of the source head.
    add_box('SERA_BrowL', (-0.029,fy(0.095),1.598), (0.025,0.0035,0.0032), brow, rotation=(0.0,0.0,-0.11), bevel=0.0012)
    add_box('SERA_BrowR', (0.029,fy(0.095),1.598), (0.025,0.0035,0.0032), brow, rotation=(0.0,0.0,0.11), bevel=0.0012)
    add_box('SERA_EyeL', (-0.028,fy(0.097),1.578), (0.021,0.0035,0.0032), eye, rotation=(0.0,0.0,-0.04), bevel=0.0012)
    add_box('SERA_EyeR', (0.028,fy(0.097),1.578), (0.021,0.0035,0.0032), eye, rotation=(0.0,0.0,0.04), bevel=0.0012)
    add_box('SERA_NosePlane', (0.0,fy(0.099),1.552), (0.006,0.004,0.022), skin_shadow, bevel=0.0016)
    add_box('SERA_Lip', (0.0,fy(0.100),1.526), (0.020,0.0035,0.0032), lip, bevel=0.0012)

    for side in ('l','r'):
        a,b = bone_points(armature, 'lowerarm_' + side)
        add_segment('SERA_Guard_' + side, a.lerp(b,0.47), a.lerp(b,0.84), 0.040,0.027,silver,(0.66,1),6)
        a,b = bone_points(armature, 'calf_' + side)
        add_segment('SERA_Shin_' + side, a.lerp(b,0.28), a.lerp(b,0.86), 0.043,0.027,blue_hi,(0.64,1),7)

        # Bone-anchored foot shell keeps the boot tied to the imported foot rig.
        a,b = bone_points(armature, 'foot_' + side)
        add_segment('SERA_BootFoot_' + side, a.lerp(b,0.05), b.lerp(a,0.03), 0.044,0.028,black,(1.02,0.62),7)

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
    # The cap supplies the skull mass. Two shallow 3D hairline wedges bridge the
    # cap to the forehead so no skin-colored crown patch can open between them.
    add_ico('SERA_HairCap', (0,fy(-0.006),1.586), (0.116,0.104,0.124), hair, 2)
    add_wedge('SERA_HairlineL', [
        (-0.004,fy(0.104),1.674),(-0.066,fy(0.103),1.661),(-0.086,fy(0.099),1.620),(-0.020,fy(0.104),1.628),
        (-0.004,fy(0.082),1.674),(-0.066,fy(0.081),1.661),(-0.086,fy(0.078),1.620),(-0.020,fy(0.083),1.628)], faces, hair)
    add_wedge('SERA_HairlineR', [
        (0.004,fy(0.104),1.674),(0.066,fy(0.103),1.661),(0.086,fy(0.099),1.620),(0.020,fy(0.104),1.628),
        (0.004,fy(0.082),1.674),(0.066,fy(0.081),1.661),(0.086,fy(0.078),1.620),(0.020,fy(0.083),1.628)], faces, hair)

    # Side masses overlap the cap edge, then taper toward the temples and nape.
    # This removes the disconnected helmet/flap look in side and 3/4 views.
    add_segment('SERA_SideHairL', (-0.086,fy(0.018),1.656), (-0.096,fy(0.054),1.555), 0.027,0.011,hair,(0.70,1.0),7)
    add_segment('SERA_SideHairR', (0.086,fy(0.018),1.656), (0.096,fy(0.054),1.555), 0.027,0.011,hair,(0.70,1.0),7)
    add_segment('SERA_NapeHairL', (-0.072,fy(-0.052),1.628), (-0.058,fy(-0.076),1.520), 0.023,0.010,hair,(0.74,1.0),7)
    add_segment('SERA_NapeHairR', (0.072,fy(-0.052),1.628), (0.058,fy(-0.076),1.520), 0.023,0.010,hair,(0.74,1.0),7)

    # The fringe is intentionally asymmetric like a styled haircut, not a pair
    # of mirrored rods. A short center wisp establishes the part; the left inner
    # lock hangs slightly lower while the right side opens more of the eye area.
    add_segment('SERA_FringeCenter', (-0.004,fy(0.105),1.659), (-0.015,fy(0.109),1.630), 0.012,0.0038,hair,(0.44,1.0),6)
    add_segment('SERA_FringeL', (-0.010,fy(0.103),1.662), (-0.031,fy(0.108),1.604), 0.019,0.0058,hair,(0.44,1.0),6)
    add_segment('SERA_FringeR', (0.012,fy(0.103),1.660), (0.043,fy(0.108),1.616), 0.018,0.0055,hair,(0.44,1.0),6)
    add_segment('SERA_FringeSideL', (-0.036,fy(0.099),1.654), (-0.064,fy(0.105),1.580), 0.018,0.0055,hair,(0.46,1.0),6)
    add_segment('SERA_FringeSideR', (0.044,fy(0.098),1.652), (0.074,fy(0.104),1.592), 0.017,0.0052,hair,(0.46,1.0),6)
    add_segment('SERA_TempleLockL', (-0.078,fy(0.072),1.630), (-0.084,fy(0.078),1.552), 0.0115,0.0050,hair,(0.50,1.0),6)
    add_segment('SERA_TempleLockR', (0.078,fy(0.072),1.630), (0.084,fy(0.078),1.562), 0.0110,0.0048,hair,(0.50,1.0),6)

    # The high ponytail starts as a broad gathered root and then sweeps slightly
    # sideways while tapering. This replaces the previous straight, rod-like tail.
    add_box('SERA_HairTie', (0.004,fy(-0.098),1.672), (0.042,0.020,0.015), blue_hi, bevel=0.003)
    add_segment('SERA_PonyRoot', (0.004,fy(-0.090),1.676), (0.020,fy(-0.122),1.648), 0.050,0.064,hair,(0.72,1.0),7)
    add_segment('SERA_Pony1', (0.020,fy(-0.122),1.648), (0.050,fy(-0.166),1.535), 0.064,0.054,hair,(0.72,1.0),7)
    add_segment('SERA_Pony2', (0.050,fy(-0.166),1.535), (0.074,fy(-0.184),1.360), 0.054,0.036,hair,(0.70,1.0),7)
    add_segment('SERA_Pony3', (0.074,fy(-0.184),1.360), (0.050,fy(-0.166),1.205), 0.036,0.012,hair,(0.66,1.0),7)

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

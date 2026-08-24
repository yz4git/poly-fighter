from sera_blender_helpers import SERA_FRONT_Y, add_box, add_ico, add_segment, add_wedge, material
from sera_bone_follow import attach_head_follow, parent_to_bone_keep_world


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

    add_ico('SERA_HairCap', (0,fy(-0.006),1.586), (0.116,0.104,0.124), hair, 2)
    add_wedge('SERA_HairlineL', [
        (-0.004,fy(0.104),1.674),(-0.066,fy(0.103),1.661),(-0.086,fy(0.099),1.620),(-0.020,fy(0.104),1.628),
        (-0.004,fy(0.082),1.674),(-0.066,fy(0.081),1.661),(-0.086,fy(0.078),1.620),(-0.020,fy(0.083),1.628)], faces, hair)
    add_wedge('SERA_HairlineR', [
        (0.004,fy(0.104),1.674),(0.066,fy(0.103),1.661),(0.086,fy(0.099),1.620),(0.020,fy(0.104),1.628),
        (0.004,fy(0.082),1.674),(0.066,fy(0.081),1.661),(0.086,fy(0.078),1.620),(0.020,fy(0.083),1.628)], faces, hair)
    add_wedge('SERA_FringeRootL', [
        (-0.002,fy(0.108),1.666),(-0.036,fy(0.108),1.657),(-0.050,fy(0.108),1.625),(-0.012,fy(0.109),1.631),
        (-0.002,fy(0.092),1.666),(-0.036,fy(0.092),1.657),(-0.050,fy(0.092),1.625),(-0.012,fy(0.093),1.631)], faces, hair)
    add_wedge('SERA_FringeRootR', [
        (0.002,fy(0.108),1.666),(0.042,fy(0.108),1.656),(0.056,fy(0.108),1.628),(0.012,fy(0.109),1.634),
        (0.002,fy(0.092),1.666),(0.042,fy(0.092),1.656),(0.056,fy(0.092),1.628),(0.012,fy(0.093),1.634)], faces, hair)

    add_segment('SERA_SideHairL', (-0.086,fy(0.018),1.656), (-0.096,fy(0.054),1.555), 0.027,0.011,hair,(0.70,1.0),7)
    add_segment('SERA_SideHairR', (0.086,fy(0.018),1.656), (0.096,fy(0.054),1.555), 0.027,0.011,hair,(0.70,1.0),7)
    add_segment('SERA_NapeHairL', (-0.072,fy(-0.052),1.628), (-0.058,fy(-0.076),1.520), 0.023,0.010,hair,(0.74,1.0),7)
    add_segment('SERA_NapeHairR', (0.072,fy(-0.052),1.628), (0.058,fy(-0.076),1.520), 0.023,0.010,hair,(0.74,1.0),7)

    # V4 strand-level hair: add dedicated inner/outer fringe blades instead of
    # asking one shared fringe primitive to represent the entire forehead.
    add_segment('SERA_FringeCenter', (-0.004,fy(0.105),1.659), (-0.015,fy(0.109),1.632), 0.011,0.0036,hair,(0.42,1.0),6)
    add_segment('SERA_FringeInnerL', (-0.014,fy(0.106),1.663), (-0.028,fy(0.111),1.612), 0.0135,0.0043,hair,(0.44,1.0),6)
    add_segment('SERA_FringeInnerR', (0.014,fy(0.106),1.662), (0.031,fy(0.111),1.616), 0.0135,0.0043,hair,(0.44,1.0),6)
    add_segment('SERA_FringeL', (-0.010,fy(0.103),1.662), (-0.031,fy(0.108),1.608), 0.018,0.0056,hair,(0.43,1.0),6)
    add_segment('SERA_FringeR', (0.012,fy(0.103),1.660), (0.043,fy(0.108),1.620), 0.017,0.0053,hair,(0.43,1.0),6)
    add_segment('SERA_FringeSideL', (-0.036,fy(0.099),1.654), (-0.064,fy(0.105),1.584), 0.017,0.0053,hair,(0.45,1.0),6)
    add_segment('SERA_FringeSideR', (0.044,fy(0.098),1.652), (0.074,fy(0.104),1.596), 0.016,0.0050,hair,(0.45,1.0),6)
    add_segment('SERA_FringeOuterL', (-0.056,fy(0.092),1.650), (-0.079,fy(0.101),1.574), 0.0145,0.0040,hair,(0.46,1.0),6)
    add_segment('SERA_FringeOuterR', (0.057,fy(0.092),1.648), (0.080,fy(0.101),1.582), 0.0140,0.0038,hair,(0.46,1.0),6)
    add_segment('SERA_TempleLockL', (-0.078,fy(0.072),1.630), (-0.084,fy(0.078),1.552), 0.0115,0.0050,hair,(0.50,1.0),6)
    add_segment('SERA_TempleLockR', (0.078,fy(0.072),1.630), (0.084,fy(0.078),1.562), 0.0110,0.0048,hair,(0.50,1.0),6)

    # Separate back-hair masses provide an independently optimizable rear
    # silhouette. They intentionally overlap the cap/nape volumes so flat
    # shading reads as designed polygon planes instead of a smooth helmet.
    add_segment('SERA_BackHairCenter', (0.000,fy(-0.045),1.642), (0.000,fy(-0.078),1.505), 0.034,0.014,hair,(0.76,1.0),7)
    add_segment('SERA_BackHairL', (-0.058,fy(-0.050),1.635), (-0.075,fy(-0.082),1.468), 0.027,0.010,hair,(0.72,1.0),7)
    add_segment('SERA_BackHairR', (0.058,fy(-0.050),1.635), (0.075,fy(-0.082),1.468), 0.027,0.010,hair,(0.72,1.0),7)

    add_box('SERA_HairTie', (0.004,fy(-0.098),1.672), (0.042,0.020,0.015), blue_hi, bevel=0.003)
    add_segment('SERA_PonyRoot', (0.004,fy(-0.090),1.676), (0.020,fy(-0.122),1.648), 0.050,0.064,hair,(0.72,1.0),7)
    add_segment('SERA_Pony1', (0.020,fy(-0.122),1.648), (0.050,fy(-0.166),1.535), 0.064,0.054,hair,(0.72,1.0),7)
    add_segment('SERA_PonyFanL', (0.016,fy(-0.121),1.644), (-0.006,fy(-0.158),1.500), 0.030,0.012,hair,(0.70,1.0),7)
    add_segment('SERA_PonyFanR', (0.027,fy(-0.124),1.642), (0.072,fy(-0.170),1.492), 0.031,0.012,hair,(0.70,1.0),7)
    add_segment('SERA_Pony2', (0.050,fy(-0.166),1.535), (0.074,fy(-0.184),1.360), 0.054,0.036,hair,(0.70,1.0),7)
    add_segment('SERA_Pony3', (0.074,fy(-0.184),1.360), (0.050,fy(-0.166),1.205), 0.036,0.012,hair,(0.66,1.0),7)

    # Facial planes remain small overlays. V4 deforms the actual source-face
    # vertices locally underneath them, so these no longer have to fake skull,
    # cheek, jaw, nose and mouth volume with whole-head scale changes.
    add_box('SERA_BrowL', (-0.031,fy(0.096),1.603), (0.024,0.0032,0.0028), brow, rotation=(0.0,0.0,-0.08), bevel=0.0010)
    add_box('SERA_BrowR', (0.031,fy(0.096),1.603), (0.024,0.0032,0.0028), brow, rotation=(0.0,0.0,0.08), bevel=0.0010)
    add_box('SERA_EyeL', (-0.029,fy(0.098),1.581), (0.019,0.0032,0.0028), eye, rotation=(0.0,0.0,-0.03), bevel=0.0010)
    add_box('SERA_EyeR', (0.029,fy(0.098),1.581), (0.019,0.0032,0.0028), eye, rotation=(0.0,0.0,0.03), bevel=0.0010)
    add_box('SERA_NosePlane', (0.0,fy(0.100),1.552), (0.0055,0.0036,0.020), skin_shadow, bevel=0.0014)
    add_box('SERA_Lip', (0.0,fy(0.101),1.527), (0.017,0.0032,0.0028), lip, bevel=0.0010)

    for side in ('l','r'):
        a,b = bone_points(armature, 'lowerarm_' + side)
        guard = add_segment('SERA_Guard_' + side, a.lerp(b,0.47), a.lerp(b,0.84), 0.040,0.027,silver,(0.66,1),6)
        parent_to_bone_keep_world(guard, armature, 'lowerarm_' + side)

        a,b = bone_points(armature, 'calf_' + side)
        shin = add_segment('SERA_Shin_' + side, a.lerp(b,0.28), a.lerp(b,0.86), 0.043,0.027,blue_hi,(0.64,1),7)
        parent_to_bone_keep_world(shin, armature, 'calf_' + side)

        a,b = bone_points(armature, 'foot_' + side)
        boot = add_segment('SERA_BootFoot_' + side, a.lerp(b,0.05), b.lerp(a,0.03), 0.044,0.028,black,(1.02,0.62),7)
        parent_to_bone_keep_world(boot, armature, 'foot_' + side)

    head_names = (
        'SERA_HairCap','SERA_HairlineL','SERA_HairlineR','SERA_FringeRootL','SERA_FringeRootR',
        'SERA_SideHairL','SERA_SideHairR','SERA_NapeHairL','SERA_NapeHairR','SERA_FringeCenter',
        'SERA_FringeInnerL','SERA_FringeInnerR','SERA_FringeL','SERA_FringeR','SERA_FringeSideL',
        'SERA_FringeSideR','SERA_FringeOuterL','SERA_FringeOuterR','SERA_TempleLockL','SERA_TempleLockR',
        'SERA_BackHairCenter','SERA_BackHairL','SERA_BackHairR','SERA_HairTie','SERA_PonyRoot','SERA_Pony1',
        'SERA_PonyFanL','SERA_PonyFanR','SERA_Pony2','SERA_Pony3','SERA_BrowL','SERA_BrowR','SERA_EyeL',
        'SERA_EyeR','SERA_NosePlane','SERA_Lip'
    )
    attach_head_follow([obj for name in head_names if (obj := __import__('bpy').data.objects.get(name))], armature)

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

    # Waist equipment is deliberately short and rooted close to the pelvis.
    # Earlier long panels read as three unrelated cards once the combat rig bent.
    add_box('SERA_Collar', (0, fy(-0.004), 1.405), (0.112, 0.044, 0.040), blue_hi, bevel=0.006)
    faces = [(0,1,2,3),(4,7,6,5),(0,4,5,1),(3,2,6,7),(1,5,6,2),(0,3,7,4)]
    add_wedge('SERA_FrontSkirt', [
        (-0.105,fy(0.055),0.950),(0.085,fy(0.055),0.950),(0.060,fy(0.062),0.735),(-0.042,fy(0.062),0.705),
        (-0.105,fy(0.026),0.950),(0.085,fy(0.026),0.950),(0.060,fy(0.030),0.735),(-0.042,fy(0.030),0.705)], faces, blue_hi)
    add_wedge('SERA_LeftSkirt', [
        (-0.150,fy(0.022),0.936),(-0.086,fy(0.022),0.925),(-0.098,fy(0.014),0.735),(-0.170,fy(0.010),0.770),
        (-0.150,fy(-0.016),0.936),(-0.086,fy(-0.016),0.925),(-0.098,fy(-0.020),0.735),(-0.170,fy(-0.020),0.770)], faces, blue)
    add_wedge('SERA_RightSkirt', [
        (0.150,fy(0.020),0.936),(0.086,fy(0.020),0.925),(0.098,fy(0.012),0.750),(0.170,fy(0.008),0.780),
        (0.150,fy(-0.018),0.936),(0.086,fy(-0.018),0.925),(0.098,fy(-0.022),0.750),(0.170,fy(-0.022),0.780)], faces, black)

    # MODEL QUALITY V2 HAIR
    # The cap is now a restrained skull-following backing mass instead of the
    # dominant silhouette. Readability comes from small authored strands around
    # it, leaving the face exposed in front and 3/4 views.
    add_ico('SERA_HairCap', (0,fy(-0.018),1.603), (0.094,0.076,0.102), hair, 2)
    add_wedge('SERA_HairlineL', [
        (-0.003,fy(0.096),1.669),(-0.050,fy(0.095),1.660),(-0.068,fy(0.092),1.628),(-0.018,fy(0.097),1.632),
        (-0.003,fy(0.083),1.669),(-0.050,fy(0.082),1.660),(-0.068,fy(0.080),1.628),(-0.018,fy(0.084),1.632)], faces, hair)
    add_wedge('SERA_HairlineR', [
        (0.003,fy(0.096),1.669),(0.050,fy(0.095),1.660),(0.068,fy(0.092),1.628),(0.018,fy(0.097),1.632),
        (0.003,fy(0.083),1.669),(0.050,fy(0.082),1.660),(0.068,fy(0.080),1.628),(0.018,fy(0.084),1.632)], faces, hair)
    add_wedge('SERA_FringeRootL', [
        (-0.002,fy(0.101),1.661),(-0.029,fy(0.101),1.654),(-0.039,fy(0.101),1.630),(-0.010,fy(0.102),1.635),
        (-0.002,fy(0.091),1.661),(-0.029,fy(0.091),1.654),(-0.039,fy(0.091),1.630),(-0.010,fy(0.092),1.635)], faces, hair)
    add_wedge('SERA_FringeRootR', [
        (0.002,fy(0.101),1.661),(0.033,fy(0.101),1.653),(0.043,fy(0.101),1.632),(0.010,fy(0.102),1.636),
        (0.002,fy(0.091),1.661),(0.033,fy(0.091),1.653),(0.043,fy(0.091),1.632),(0.010,fy(0.092),1.636)], faces, hair)

    add_segment('SERA_SideHairL', (-0.072,fy(0.012),1.646), (-0.079,fy(0.045),1.570), 0.018,0.007,hair,(0.62,1.0),6)
    add_segment('SERA_SideHairR', (0.072,fy(0.012),1.646), (0.079,fy(0.045),1.570), 0.018,0.007,hair,(0.62,1.0),6)
    add_segment('SERA_NapeHairL', (-0.061,fy(-0.044),1.626), (-0.052,fy(-0.064),1.545), 0.016,0.006,hair,(0.64,1.0),6)
    add_segment('SERA_NapeHairR', (0.061,fy(-0.044),1.626), (0.052,fy(-0.064),1.545), 0.016,0.006,hair,(0.64,1.0),6)

    add_segment('SERA_FringeCenter', (-0.003,fy(0.101),1.656), (-0.011,fy(0.105),1.630), 0.0090,0.0030,hair,(0.38,1.0),6)
    add_segment('SERA_FringeInnerL', (-0.012,fy(0.102),1.659), (-0.024,fy(0.106),1.616), 0.0105,0.0034,hair,(0.40,1.0),6)
    add_segment('SERA_FringeInnerR', (0.012,fy(0.102),1.658), (0.026,fy(0.106),1.619), 0.0105,0.0034,hair,(0.40,1.0),6)
    add_segment('SERA_FringeL', (-0.026,fy(0.100),1.655), (-0.041,fy(0.105),1.607), 0.0115,0.0036,hair,(0.40,1.0),6)
    add_segment('SERA_FringeR', (0.027,fy(0.100),1.654), (0.045,fy(0.105),1.614), 0.0115,0.0036,hair,(0.40,1.0),6)
    add_segment('SERA_FringeSideL', (-0.044,fy(0.096),1.650), (-0.059,fy(0.101),1.592), 0.0105,0.0034,hair,(0.42,1.0),6)
    add_segment('SERA_FringeSideR', (0.046,fy(0.096),1.649), (0.061,fy(0.101),1.598), 0.0100,0.0032,hair,(0.42,1.0),6)
    add_segment('SERA_FringeOuterL', (-0.058,fy(0.089),1.646), (-0.071,fy(0.097),1.582), 0.0090,0.0030,hair,(0.44,1.0),6)
    add_segment('SERA_FringeOuterR', (0.058,fy(0.089),1.645), (0.071,fy(0.097),1.588), 0.0090,0.0030,hair,(0.44,1.0),6)
    add_segment('SERA_TempleLockL', (-0.068,fy(0.066),1.625), (-0.073,fy(0.073),1.566), 0.0080,0.0034,hair,(0.46,1.0),6)
    add_segment('SERA_TempleLockR', (0.068,fy(0.066),1.625), (0.073,fy(0.073),1.572), 0.0080,0.0034,hair,(0.46,1.0),6)

    # Rear hair is intentionally shallow. The former long thick segments stacked
    # into a segmented helmet when viewed from the side/back.
    add_segment('SERA_BackHairCenter', (0.000,fy(-0.038),1.635), (0.000,fy(-0.066),1.535), 0.020,0.008,hair,(0.62,1.0),6)
    add_segment('SERA_BackHairL', (-0.047,fy(-0.042),1.628), (-0.058,fy(-0.070),1.515), 0.016,0.007,hair,(0.60,1.0),6)
    add_segment('SERA_BackHairR', (0.047,fy(-0.042),1.628), (0.058,fy(-0.070),1.515), 0.016,0.007,hair,(0.60,1.0),6)

    # Ponytail is now a narrow curved root/body/tip chain. Tiny side wisps retain
    # faceted character without creating the previous giant fan plates.
    add_box('SERA_HairTie', (0.003,fy(-0.084),1.657), (0.027,0.014,0.010), blue_hi, bevel=0.002)
    add_segment('SERA_PonyRoot', (0.003,fy(-0.080),1.657), (0.014,fy(-0.112),1.615), 0.026,0.021,hair,(0.62,1.0),7)
    add_segment('SERA_Pony1', (0.014,fy(-0.112),1.615), (0.047,fy(-0.151),1.525), 0.032,0.024,hair,(0.60,1.0),7)
    add_segment('SERA_PonyFanL', (0.026,fy(-0.128),1.578), (0.010,fy(-0.154),1.522), 0.010,0.004,hair,(0.48,1.0),6)
    add_segment('SERA_PonyFanR', (0.030,fy(-0.130),1.576), (0.058,fy(-0.158),1.516), 0.010,0.004,hair,(0.48,1.0),6)
    add_segment('SERA_Pony2', (0.047,fy(-0.151),1.525), (0.071,fy(-0.174),1.420), 0.024,0.016,hair,(0.56,1.0),7)
    add_segment('SERA_Pony3', (0.071,fy(-0.174),1.420), (0.055,fy(-0.160),1.330), 0.016,0.007,hair,(0.50,1.0),7)

    # Minimal facial accents: the source face carries the volume; these only
    # sharpen eye/brow/nose/lip readability at game distance.
    add_box('SERA_BrowL', (-0.030,fy(0.096),1.603), (0.021,0.0028,0.0024), brow, rotation=(0.0,0.0,-0.08), bevel=0.0008)
    add_box('SERA_BrowR', (0.030,fy(0.096),1.603), (0.021,0.0028,0.0024), brow, rotation=(0.0,0.0,0.08), bevel=0.0008)
    add_box('SERA_EyeL', (-0.028,fy(0.099),1.581), (0.017,0.0028,0.0025), eye, rotation=(0.0,0.0,-0.03), bevel=0.0008)
    add_box('SERA_EyeR', (0.028,fy(0.099),1.581), (0.017,0.0028,0.0025), eye, rotation=(0.0,0.0,0.03), bevel=0.0008)
    add_box('SERA_NosePlane', (0.0,fy(0.102),1.552), (0.0050,0.0042,0.018), skin_shadow, bevel=0.0012)
    add_box('SERA_Lip', (0.0,fy(0.102),1.527), (0.014,0.0028,0.0025), lip, bevel=0.0008)

    for side in ('l','r'):
        a,b = bone_points(armature, 'lowerarm_' + side)
        guard = add_segment('SERA_Guard_' + side, a.lerp(b,0.52), a.lerp(b,0.80), 0.031,0.023,silver,(0.76,1),7)
        parent_to_bone_keep_world(guard, armature, 'lowerarm_' + side)

        a,b = bone_points(armature, 'calf_' + side)
        shin = add_segment('SERA_Shin_' + side, a.lerp(b,0.38), a.lerp(b,0.78), 0.030,0.022,blue_hi,(0.76,1),8)
        parent_to_bone_keep_world(shin, armature, 'calf_' + side)

        a,b = bone_points(armature, 'foot_' + side)
        boot = add_segment('SERA_BootFoot_' + side, a.lerp(b,0.08), b.lerp(a,0.08), 0.036,0.024,black,(0.92,0.72),8)
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

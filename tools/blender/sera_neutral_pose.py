import bpy


def _empty(name, location):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    return obj


def _ik(armature, bone_name, target, pole):
    bone = armature.pose.bones.get(bone_name)
    if bone is None:
        raise RuntimeError('missing rig bone ' + bone_name)
    constraint = bone.constraints.new('IK')
    constraint.name = 'SERA_Turnaround_IK'
    constraint.target = _empty('TARGET_' + bone_name, target)
    constraint.pole_target = _empty('POLE_' + bone_name, pole)
    constraint.chain_count = 2
    constraint.use_tail = True


def apply(armature):
    _ik(armature, 'lowerarm_l', (-0.255, 0.015, 1.02), (-0.48, 0.18, 1.19))
    _ik(armature, 'lowerarm_r', (0.255, 0.015, 1.02), (0.48, 0.18, 1.19))
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()

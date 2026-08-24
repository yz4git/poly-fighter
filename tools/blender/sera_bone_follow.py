import bpy


def resolve_pose_bone(armature, candidates):
    """Resolve a source-rig bone without baking a specific capitalization into identity code."""
    if isinstance(candidates, str):
        candidates = (candidates,)
    for name in candidates:
        if armature.pose.bones.get(name) is not None:
            return name
    wanted = {str(name).lower().replace('-', '_'): str(name) for name in candidates}
    for bone in armature.pose.bones:
        key = bone.name.lower().replace('-', '_')
        if key in wanted:
            return bone.name
    return None


def parent_to_bone_keep_world(obj, armature, candidates, required=True):
    """Bone-parent an authored overlay while preserving its current world transform.

    Identity meshes are authored in world space from the imported source rig.  A
    plain object parent would still leave them behind when an IK/pose constraint
    moves a limb. Bone parenting gives Blender audits the same attachment
    semantics the runtime canonical reskin expects.
    """
    if obj is None:
        if required:
            raise RuntimeError('cannot bone-parent a missing SERA object')
        return None
    bone_name = resolve_pose_bone(armature, candidates)
    if bone_name is None:
        if required:
            raise RuntimeError('missing source rig bone for SERA attachment: ' + ', '.join(candidates if not isinstance(candidates, str) else (candidates,)))
        return None
    world = obj.matrix_world.copy()
    obj.parent = armature
    obj.parent_type = 'BONE'
    obj.parent_bone = bone_name
    obj.matrix_world = world
    obj['seraBoneFollow'] = bone_name
    bpy.context.view_layer.update()
    return bone_name


def attach_head_follow(objects, armature):
    """Attach hair/face overlays to the head when the source rig exposes one."""
    attached = 0
    for obj in objects:
        if parent_to_bone_keep_world(obj, armature, ('head', 'Head', 'head.x'), required=False):
            attached += 1
    return attached

from mathutils import Vector
import bpy


def load_body(obj_path, target_path):
    raw_vertices = []
    body_faces = []
    group = None
    with open(obj_path, 'r', encoding='utf-8', errors='replace') as handle:
        for line in handle:
            if line.startswith('v '):
                parts = line.split()
                raw_vertices.append(Vector((float(parts[1]), float(parts[2]), float(parts[3]))))
            elif line.startswith('g '):
                group = line.strip()[2:]
            elif line.startswith('f ') and group == 'body':
                face = []
                for token in line.split()[1:]:
                    idx = int(token.split('/', 1)[0])
                    face.append(len(raw_vertices) + idx if idx < 0 else idx - 1)
                if len(face) >= 3:
                    body_faces.append(tuple(face))

    with open(target_path, 'r', encoding='utf-8', errors='replace') as handle:
        for line in handle:
            text = line.strip()
            if not text or text.startswith('#'):
                continue
            parts = text.split()
            if len(parts) < 4:
                continue
            idx = int(parts[0])
            if 0 <= idx < len(raw_vertices):
                raw_vertices[idx] += Vector((float(parts[1]), float(parts[2]), float(parts[3])))

    used = sorted({idx for face in body_faces for idx in face})
    if not used:
        raise RuntimeError('MakeHuman BODY group produced no faces')

    converted = {idx: Vector((raw_vertices[idx].x, raw_vertices[idx].z, raw_vertices[idx].y)) for idx in used}
    xs = [converted[i].x for i in used]
    ys = [converted[i].y for i in used]
    zs = [converted[i].z for i in used]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    min_z, max_z = min(zs), max(zs)
    scale = 1.68 / (max_z - min_z)
    cx = (min_x + max_x) * 0.5
    cy = (min_y + max_y) * 0.5

    def profile(t, stops):
        if t <= stops[0][0]:
            return stops[0][1]
        for (t0, v0), (t1, v1) in zip(stops, stops[1:]):
            if t <= t1:
                q = (t - t0) / max(1e-6, t1 - t0)
                return v0 + (v1 - v0) * q
        return stops[-1][1]

    x_stops = [(0.00,0.94),(0.12,0.91),(0.30,0.90),(0.52,0.94),(0.62,0.84),(0.72,0.93),(0.80,0.95),(0.88,0.90),(1.00,0.90)]
    d_stops = [(0.00,0.93),(0.50,0.93),(0.62,0.88),(0.78,0.90),(0.88,0.90),(1.00,0.92)]

    vertices = []
    reindex = {}
    for new_idx, old_idx in enumerate(used):
        p = converted[old_idx]
        x = (p.x - cx) * scale
        y = (p.y - cy) * scale
        z = (p.z - min_z) * scale
        t = z / 1.68
        x *= profile(t, x_stops)
        y *= profile(t, d_stops)
        if z < 0.92:
            z *= 1.025
        else:
            z = 0.943 + (z - 0.92) * 0.965
        vertices.append((x, y, z))
        reindex[old_idx] = new_idx

    faces = [tuple(reindex[idx] for idx in face) for face in body_faces]
    return vertices, faces


def create_body(obj_path, target_path, skin_material):
    vertices, faces = load_body(obj_path, target_path)
    mesh = bpy.data.meshes.new('SERA_CC0_MakeHumanBodyMesh')
    mesh.from_pydata(vertices, [], faces)
    mesh.update(calc_edges=True)
    body = bpy.data.objects.new('SERA_CC0_MakeHumanBody', mesh)
    bpy.context.collection.objects.link(body)
    body.data.materials.append(skin_material)

    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    tri = body.modifiers.new(name='Triangulate', type='TRIANGULATE')
    bpy.ops.object.modifier_apply(modifier=tri.name)
    decimate = body.modifiers.new(name='LowPolyDecimate', type='DECIMATE')
    decimate.decimate_type = 'COLLAPSE'
    decimate.ratio = 0.42
    decimate.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    for poly in body.data.polygons:
        poly.use_smooth = False
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    body.select_set(False)
    return body

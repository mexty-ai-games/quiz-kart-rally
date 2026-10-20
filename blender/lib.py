"""Small helpers shared by the Blender scripts (Blender 5.x, run headless or as the bpy module)."""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

# Palette matched to the Kenney karts: lavender/purple bodies, orange trims, cream and charcoal.
PALETTE = {
    "purple": (0.42, 0.30, 0.86),
    "lavender": (0.70, 0.64, 0.95),
    "orange": (1.00, 0.52, 0.12),
    "yellow": (1.00, 0.80, 0.20),
    "cream": (0.96, 0.94, 0.90),
    "white": (1.00, 1.00, 1.00),
    "charcoal": (0.13, 0.12, 0.17),
    "rubber": (0.07, 0.07, 0.08),
    "steel": (0.55, 0.57, 0.62),
    "red": (0.95, 0.22, 0.25),
    "teal": (0.15, 0.78, 0.75),
    "screen": (0.03, 0.05, 0.14),
}


def args():
    """Arguments after `--` (works both with `blender --python x.py -- a b` and `python3 x.py -- a b`)."""
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


_mats = {}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()


def mat(name, color=None, emission=0.0, rough=0.6, metal=0.0):
    """One material per name (flat colour, optional glow)."""
    key = (name, emission)
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    c = PALETTE.get(name, color or (0.8, 0.8, 0.8)) if color is None else color
    b.inputs["Base Color"].default_value = (*c, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emission > 0:
        b.inputs["Emission Color"].default_value = (*c, 1)
        b.inputs["Emission Strength"].default_value = emission
    _mats[key] = m
    return m


def _finish(obj, material, name, parent=None):
    obj.name = name
    if material is not None:
        obj.data.materials.clear()
        obj.data.materials.append(material)
    if parent is not None:
        obj.parent = parent
    for p in obj.data.polygons:
        p.use_smooth = False
    return obj


def box(name, size, loc, material, parent=None, bevel=0.0):
    """Axis-aligned box: size (x, y, z) in metres, loc = centre."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=1, affect="EDGES")
        bm.to_mesh(o.data)
        bm.free()
    return _finish(o, material, name, parent)


def cyl(name, r, depth, loc, material, verts=16, rot=(0, 0, 0), parent=None, r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot)
    return _finish(bpy.context.active_object, material, name, parent)


def torus(name, major, minor, loc, material, rot=(0, 0, 0), parent=None, seg=20, mseg=8):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=seg, minor_segments=mseg, location=loc, rotation=rot)
    return _finish(bpy.context.active_object, material, name, parent)


def plane(name, w, h, loc, material, rot=(0, 0, 0), parent=None):
    """A flat w × h panel with clean 0..1 UVs (used for canvas-drawn screens)."""
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = (w, h, 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(o, material, name, parent)


def poly_prism(name, pts2d, z0, z1, material, parent=None):
    """Extrudes a 2D outline (x, y in metres) between heights z0 and z1."""
    bm = bmesh.new()
    vs0 = [bm.verts.new((x, y, z0)) for x, y in pts2d]
    vs1 = [bm.verts.new((x, y, z1)) for x, y in pts2d]
    bm.faces.new(vs0[::-1])
    bm.faces.new(vs1)
    n = len(pts2d)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((vs0[i], vs0[j], vs1[j], vs1[i]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    return _finish(o, material, name, parent)


def empty(name, loc=(0, 0, 0)):
    o = bpy.data.objects.new(name, None)
    o.location = loc
    bpy.context.collection.objects.link(o)
    return o


def join(name, objs):
    """Joins meshes into one object (keeps their materials as separate slots)."""
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    return o


def export(path, objs=None):
    """Exports the scene (or objs and their children) as a GLB, Y-up, transforms applied."""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    if objs:
        for o in objs:
            o.select_set(True)
            for c in o.children_recursive:
                c.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=bool(objs),
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_animations=False,
    )
    print(f"  wrote {path} ({os.path.getsize(path) / 1024:.1f} KB)")


def tri_count():
    n = 0
    for o in bpy.context.scene.objects:
        if o.type == "MESH":
            n += sum(len(p.vertices) - 2 for p in o.data.polygons)
    return n

"""Helpers for asset kit 2 (extends lib.py, which stays untouched).

Everything is built with bmesh straight into mesh datablocks (no bpy.ops per primitive), so a
model made of hundreds of parts still builds in a second. Conventions (Blender axes):
  Z up, -Y = the side facing the incoming karts (= +Z in glTF after export_yup),
  +Y = the direction of travel (= -Z in glTF). Origins at (0, 0, 0) unless a model says otherwise.

Colours are given as sRGB hex and converted to linear for the Principled BSDF, so the glTF
baseColorFactor renders as the intended hex in three.js.
"""
import math
import os
import random

import bpy
import bmesh
from mathutils import Euler, Matrix, Vector

import lib

# Bright cartoon palette (sRGB hex).
HEX = {
    "lavender": "8c78ff",
    "purple": "6a52e8",
    "lilac": "c9bfff",
    "orange": "ff8a1e",
    "yellow": "ffd23a",
    "mint": "3fd6b8",
    "pink": "ff7aa2",
    "sky": "4fc3ff",
    "cream": "f5f0e6",
    "white": "ffffff",
    "red": "ff5a3c",
    "barn_red": "e8473a",
    "green": "5cc94a",
    "green_dark": "35a24a",
    "green_light": "8ee05a",
    "pine": "2f9e6a",
    "pine_dark": "23805a",
    "sand": "f2d091",
    "wood": "c27c45",
    "wood_dark": "8a5530",
    "charcoal": "2e2b3d",
    "rubber": "232129",
    "steel": "b4b8c6",
    "rock": "9d98b8",
    "rock_dark": "7f7a9e",
    "gold": "ffc23a",
    "silver": "d3d8e6",
    "bronze": "d9874a",
    "desert_orange": "f08a3c",
    "desert_red": "d9583a",
    "desert_sand": "f6c88a",
    "desert_light": "fbe2b4",
    "night_body": "3b3170",
    "night_navy": "263266",
    "night_teal": "1f4f66",
    "night_trim": "8c78ff",
    "window_dark": "1a1830",
    "screen": "0c1230",
}


def lin(h):
    h = HEX.get(h, h).lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


_M = {}


def reset():
    lib.reset()
    _M.clear()


def M(name, col=None, rough=0.8, metal=0.0, emit=0.0, alpha=1.0, emit_col=None):
    """One material per name. col = palette key or hex (defaults to the palette entry `name`)."""
    if name in _M:
        return _M[name]
    c = lin(col or name)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*c, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit > 0:
        e = lin(emit_col) if emit_col else c
        b.inputs["Emission Color"].default_value = (*e, 1)
        b.inputs["Emission Strength"].default_value = emit
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"
    m.diffuse_color = (*c, alpha)
    _M[name] = m
    return m


def glow(name, col, strength=2.5):
    """Emissive material; the game keys bloom / pulsing off the glow_ prefix."""
    return M(name, col, rough=0.5, emit=strength)


def glass(name, col, alpha=0.42):
    return M(name, col, rough=0.15, alpha=alpha)


# ---------------------------------------------------------------- object plumbing


def xform(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    s = scale if hasattr(scale, "__len__") else (scale, scale, scale)
    return Matrix.LocRotScale(Vector(loc), Euler(rot), Vector(s))


def to_obj(name, bm, mats, shade="flat", matrix=None):
    """bm -> new mesh object. shade: 'flat', 'smooth' or an angle in degrees (auto-smooth)."""
    if matrix is not None:
        bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    if shade != "flat":
        for f in bm.faces:
            f.smooth = True
        if shade != "smooth":
            lim = math.radians(shade)
            for e in bm.edges:
                if len(e.link_faces) == 2:
                    if e.calc_face_angle(0) > lim:
                        e.smooth = False
                else:
                    e.smooth = False
    else:
        for f in bm.faces:
            f.smooth = False
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    mats = mats if isinstance(mats, (list, tuple)) else [mats]
    for m in mats:
        me.materials.append(m)
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    return o


def join(name, objs):
    objs = [o for o in objs if o is not None]
    if len(objs) == 1:
        objs[0].name = name
        return objs[0]
    return lib.join(name, objs)


def set_origin(o, loc):
    """Moves the object origin to loc (world) without moving its geometry."""
    loc = Vector(loc)
    o.data.transform(Matrix.Translation(-loc))
    o.location = loc


def tris(objs):
    n = 0
    for o in objs:
        for c in [o] + list(o.children_recursive):
            if c.type == "MESH":
                n += sum(len(p.vertices) - 2 for p in c.data.polygons)
    return n


def export(path, objs):
    lib.export(path, objs)
    mats = set()
    for o in objs:
        for c in [o] + list(o.children_recursive):
            if c.type == "MESH":
                mats.update(m.name for m in c.data.materials if m)
    print(f"    {os.path.basename(path)}: {tris(objs)} tris, {len(mats)} materials: {sorted(mats)}")


# ---------------------------------------------------------------- primitives (all return objects)


def rbox(name, size, loc, m, bevel=0.0, seg=1, rot=(0, 0, 0), shade=None):
    """Box with bevelled edges. seg >= 2 gives rounded edges (auto-smoothed)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=bevel, segments=seg, profile=0.5, affect="EDGES", clamp_overlap=True)
    if shade is None:
        shade = 40 if seg >= 2 else "flat"
    return to_obj(name, bm, m, shade, xform(loc, rot))


def beam(name, p0, p1, w, m, h=None, shade="flat", bevel=0.0):
    """Square bar from p0 to p1 (w × h cross-section)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector((w, h or w, d.length)), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=1, affect="EDGES", clamp_overlap=True)
    q = d.normalized().to_track_quat("Z", "Y")
    mat = Matrix.Translation((p0 + p1) / 2) @ q.to_matrix().to_4x4()
    return to_obj(name, bm, m, shade, mat)


def cyl(name, r, depth, loc, m, verts=12, r2=None, rot=(0, 0, 0), shade=40, caps=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=verts, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    return to_obj(name, bm, m, shade, xform(loc, rot))


def ico(name, r, loc, m, sub=1, scale=(1, 1, 1), rot=(0, 0, 0), shade="flat", jitter=0.0, seed=0, flat_z=None):
    """Icosphere; jitter displaces verts (rocks, canopies); flat_z clamps verts below a height (local)."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
    if jitter:
        rnd = random.Random(seed)
        for v in bm.verts:
            v.co += v.co.normalized() * rnd.uniform(-jitter, jitter) * r
    if flat_z is not None:
        for v in bm.verts:
            v.co.z = max(v.co.z, flat_z)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
        bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-4)
    return to_obj(name, bm, m, shade, xform(loc, rot, scale))


def uvs(name, r, loc, m, seg=12, rings=8, scale=(1, 1, 1), rot=(0, 0, 0), shade="smooth"):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    return to_obj(name, bm, m, shade, xform(loc, rot, scale))


def lathe(name, prof, mats, seg=16, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), shade=40, matfn=None, cap_bottom=False, cap_top=False, a0=0.0):
    """Revolves a profile [(r, z), ...] (bottom -> top) around Z. matfn(i_seg, j_band) -> material index."""
    bm = bmesh.new()
    rings = []
    for r, z in prof:
        if r < 1e-6:
            rings.append([bm.verts.new((0, 0, z))])
        else:
            rings.append([bm.verts.new((r * math.cos(a0 + 2 * math.pi * i / seg), r * math.sin(a0 + 2 * math.pi * i / seg), z)) for i in range(seg)])
    for j in range(len(rings) - 1):
        a, b = rings[j], rings[j + 1]
        for i in range(seg):
            i2 = (i + 1) % seg
            if len(a) == 1 and len(b) == 1:
                continue
            if len(a) == 1:
                f = bm.faces.new((a[0], b[i2], b[i]))
            elif len(b) == 1:
                f = bm.faces.new((a[i], a[i2], b[0]))
            else:
                f = bm.faces.new((a[i], a[i2], b[i2], b[i]))
            if matfn:
                f.material_index = matfn(i, j)
    if cap_bottom and len(rings[0]) > 1:
        f = bm.faces.new(rings[0][::-1])
        if matfn:
            f.material_index = matfn(-1, -1)
    if cap_top and len(rings[-1]) > 1:
        f = bm.faces.new(rings[-1])
        if matfn:
            f.material_index = matfn(-1, len(rings) - 1)
    return to_obj(name, bm, mats, shade, xform(loc, rot, scale))


def sweep(name, pts, radii, mats, sides=8, cap_start=True, cap_end=True, round_start=False, round_end=False, shade=40, profile=None, up=None, matfn=None, a0=0.0):
    """Sweeps a cross-section along a polyline (parallel-transport frames).
    radii: scalar or (rx, ry) tuple for all points, or a list (per point) of either. profile: unit 2D points (default: circle).
    up: initial frame normal (projected). matfn(i_ring, k_side) -> material index."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    if not isinstance(radii, list):  # a scalar or one (rx, ry) tuple for every point
        radii = [radii] * n
    radii = [(r, r) if not isinstance(r, (list, tuple)) else tuple(r) for r in radii]

    def capext(p_end, p_prev, r, rev):
        t = (p_end - p_prev).normalized()
        ext_p, ext_r = [], []
        for a in (35, 60, 80):
            ar = math.radians(a)
            ext_p.append(p_end + t * r[0] * math.sin(ar))
            ext_r.append((r[0] * math.cos(ar), r[1] * math.cos(ar)))
        ext_p.append(p_end + t * r[0])
        ext_r.append((0.0, 0.0))
        return (ext_p[::-1], ext_r[::-1]) if rev else (ext_p, ext_r)

    if round_end:
        ep, er = capext(pts[-1], pts[-2], radii[-1], False)
        pts, radii = pts + ep, radii + er
        cap_end = False
    if round_start:
        ep, er = capext(pts[0], pts[1], radii[0], True)
        pts, radii = ep + pts, er + radii
        cap_start = False
    n = len(pts)
    if profile is None:
        profile = [(math.cos(a0 + 2 * math.pi * k / sides), math.sin(a0 + 2 * math.pi * k / sides)) for k in range(sides)]
    tans = []
    for i in range(n):
        d = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        tans.append(d.normalized())
    t0 = tans[0]
    nv = Vector(up) if up is not None else (Vector((0, 0, 1)) if abs(t0.z) < 0.9 else Vector((1, 0, 0)))
    nv = (nv - t0 * nv.dot(t0)).normalized()
    bm = bmesh.new()
    rings = []
    prev_t = t0
    for i in range(n):
        t = tans[i]
        nv = prev_t.rotation_difference(t) @ nv
        nv = (nv - t * nv.dot(t)).normalized()
        prev_t = t
        b = t.cross(nv)
        rx, ry = radii[i]
        if rx < 1e-6 and ry < 1e-6:
            rings.append([bm.verts.new(pts[i])])
        else:
            rings.append([bm.verts.new(pts[i] + nv * (px * rx) + b * (py * ry)) for px, py in profile])
    k = len(profile)
    for i in range(n - 1):
        a, c = rings[i], rings[i + 1]
        for s in range(k):
            s2 = (s + 1) % k
            if len(a) == 1 and len(c) == 1:
                continue
            if len(a) == 1:
                f = bm.faces.new((a[0], c[s2], c[s]))
            elif len(c) == 1:
                f = bm.faces.new((a[s], a[s2], c[0]))
            else:
                f = bm.faces.new((a[s], a[s2], c[s2], c[s]))
            if matfn:
                f.material_index = matfn(i, s)
    if cap_start and len(rings[0]) > 1:
        f = bm.faces.new(rings[0][::-1])
        if matfn:
            f.material_index = matfn(-1, -1)
    if cap_end and len(rings[-1]) > 1:
        f = bm.faces.new(rings[-1])
        if matfn:
            f.material_index = matfn(n, -1)
    return to_obj(name, bm, mats, shade)


def prism(name, pts2d, d0, d1, m, axis="z", shade="flat", loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0):
    """Extrudes a 2D outline (CCW) between d0 and d1 along axis. axis 'y': outline in (x, z), extruded along +Y."""
    bm = bmesh.new()

    def P(u, v, w):
        if axis == "z":
            return (u, v, w)
        if axis == "y":
            return (u, w, v)
        return (w, u, v)

    v0 = [bm.verts.new(P(u, v, d0)) for u, v in pts2d]
    v1 = [bm.verts.new(P(u, v, d1)) for u, v in pts2d]
    nn = len(pts2d)
    bm.faces.new(v0[::-1])
    bm.faces.new(v1)
    for i in range(nn):
        j = (i + 1) % nn
        bm.faces.new((v0[i], v0[j], v1[j], v1[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=1, affect="EDGES", clamp_overlap=True)
    return to_obj(name, bm, m, shade, xform(loc, rot))


def quad(name, w, h, loc, m, rot=(math.pi / 2, 0, 0)):
    """Flat w × h panel; default rotation faces -Y (towards the karts)."""
    bm = bmesh.new()
    vs = [bm.verts.new((x * w / 2, y * h / 2, 0)) for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    bm.faces.new(vs)
    return to_obj(name, bm, m, "flat", xform(loc, rot))


def question_mark(name, h, depth, m, loc=(0, 0, 0), rot=(0, 0, 0), thick=0.17):
    """A chunky, bold "?" built from a swept hook + a bevelled dot. h = total height.
    Lies in XY facing +Z before rot (same convention as text())."""
    pts = []
    cy, R = 0.17, 0.2
    for i in range(13):
        a = math.radians(170 - 225 * i / 12)
        pts.append((R * math.cos(a), cy + R * math.sin(a), 0))
    pts += [(0.035, -0.06, 0), (0.0, -0.12, 0), (0.0, -0.2, 0)]
    prof = [(1, 0.6), (0.6, 1), (-0.6, 1), (-1, 0.6), (-1, -0.6), (-0.6, -1), (0.6, -1), (1, -0.6)]
    hook = sweep(name, [Vector(p) * h for p in pts], (depth / 2, thick * h / 2), m, profile=prof, up=(0, 0, 1), shade="flat")
    dot = rbox(name + "_dot", (thick * 1.05 * h, thick * 1.05 * h, depth), (0, -0.36 * h, 0), m, bevel=0.04 * h)
    o = join(name, [hook, dot])
    o.data.transform(xform(loc, rot))
    return o


def text(name, s, size, depth, m, loc=(0, 0, 0), rot=(0, 0, 0), offset=0.0, bevel=0.0, res=3, height=None):
    """Extruded text (Blender's built-in font), centred on loc, lying in XY facing +Z before rot."""
    cu = bpy.data.curves.new(name + "_crv", "FONT")
    cu.body = s
    cu.size = size
    cu.extrude = depth / 2
    cu.offset = offset
    cu.bevel_depth = bevel
    cu.bevel_resolution = 0
    cu.resolution_u = res
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    tmp = bpy.data.objects.new(name + "_tmp", cu)
    bpy.context.collection.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp)
    bpy.data.curves.remove(cu)
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    xs = [v.co.x for v in bm.verts]
    ys = [v.co.y for v in bm.verts]
    c = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, 0))
    bmesh.ops.translate(bm, vec=-c, verts=bm.verts)
    if height:
        k = height / (max(ys) - min(ys))
        bmesh.ops.scale(bm, vec=(k, k, 1), verts=bm.verts)
    return to_obj(name, bm, m, "flat", xform(loc, rot))


def empty(name, loc, parent=None):
    o = bpy.data.objects.new(name, None)
    o.empty_display_type = "PLAIN_AXES"
    o.location = loc
    bpy.context.collection.objects.link(o)
    if parent is not None:
        o.parent = parent
    return o


# ---------------------------------------------------------------- small composite helpers


def flat_bottom(o, z0=0.0):
    for v in o.data.vertices:
        v.co.z = max(v.co.z, z0)
    return o


def color_bands(o, edges, mats_idx):
    """Assigns material index per face by centroid height: edges = [z1, z2, ...] -> mats_idx[k]."""
    for p in o.data.polygons:
        z = p.center.z
        k = sum(1 for e in edges if z > e)
        p.material_index = mats_idx[k % len(mats_idx)]
    return o


def balloon(name, r, loc, m, seg=10, knot_m=None):
    """A party balloon (teardrop lathe) + its little knot; loc = balloon centre."""
    prof = [(0.0, -1.05), (0.42, -0.92), (0.78, -0.6), (0.98, -0.15), (0.97, 0.3), (0.78, 0.72), (0.42, 0.96), (0.0, 1.02)]
    prof = [(a * r, b * r * 1.12) for a, b in prof]
    b = lathe(name, prof, m, seg=seg, loc=loc, shade="smooth")
    k = cyl(name + "_knot", r * 0.12, r * 0.18, (loc[0], loc[1], loc[2] - r * 1.22), knot_m or m, verts=6, r2=r * 0.04, shade="flat")
    return [b, k]


def run(models):
    """CLI for the make_kit2_*.py scripts: `-- <out_dir> [model ...]`."""
    a = lib.args()
    out = a[0] if a else "blender/out2"
    for n in a[1:] or list(models):
        models[n](out)

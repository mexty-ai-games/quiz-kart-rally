"""Kit 2 — Desert theme (sunset): saguaro cacti, layered mesa, rocks, palm, stone arch.

  python3 blender/make_kit2_desert.py -- blender/out2 [model ...]

Blender axes while building: Z up, -Y = towards the road / incoming karts (= +Z in glTF).
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402,F401
import bmesh  # noqa: E402
from mathutils import Vector  # noqa: E402

import lib2  # noqa: E402
from lib2 import M, cyl, ico, join, sweep, uvs  # noqa: E402

PI = math.pi
MODELS = {}
BANDS = ["desert_orange", "desert_sand", "desert_red", "desert_light"]


def model(fn):
    MODELS[fn.__name__] = fn
    return fn


def ribbed(i, s):
    return s % 2


def cactus(name, h, r, arms, out, flower=False):
    lib2.reset()
    G, Gd = M("green"), M("green_dark")
    parts = [sweep("trunk", [(0, 0, -0.1), (0, 0, h * 0.5), (0, 0, h - r)], [r * 1.08, r, r * 0.96], [G, Gd], sides=10, round_end=True, cap_start=True, shade=60, matfn=ribbed)]
    for side, z, out_len, up, ar in arms:
        a = Vector((side * r * 0.6, 0, z))
        b = Vector((side * (r + out_len * 0.55), 0, z - 0.05))
        c = Vector((side * (r + out_len), 0, z + ar * 0.9))
        d = Vector((side * (r + out_len), 0, z + up))
        parts.append(sweep("arm", [a, b, c, d], ar, [G, Gd], sides=8, round_end=True, cap_start=True, shade=60, matfn=ribbed))
    if flower:
        top = Vector((0, 0, h + 0.02))
        for k in range(6):
            ang = k * PI / 3
            parts.append(ico("petal", 0.16, top + Vector((0.15 * math.cos(ang), 0.15 * math.sin(ang), -0.02)), M("pink"), sub=1, scale=(1.2, 1.2, 0.45), rot=(0, 0, ang)))
        parts.append(uvs("heart", 0.1, top + Vector((0, 0, 0.05)), M("yellow"), seg=8, rings=5))
    root = join(name, parts)
    lib2.flat_bottom(root, 0.0)
    lib2.export(os.path.join(out, name + ".glb"), [root])


@model
def cactus_a(out):
    cactus("cactus_a", 4.6, 0.46, [(1, 1.6, 0.95, 2.3, 0.3), (-1, 2.4, 0.8, 1.5, 0.27)], out, flower=True)


@model
def cactus_b(out):
    cactus("cactus_b", 3.2, 0.4, [(-1, 1.1, 0.75, 1.5, 0.26), (1, 1.5, 0.6, 1.0, 0.22)], out)


def outline(n, rx, ry, seed, amp=0.12):
    rnd = random.Random(seed)
    k = [rnd.uniform(-1, 1) for _ in range(6)]
    pts = []
    for i in range(n):
        a = 2 * PI * i / n
        w = 1 + amp * (k[0] * math.sin(2 * a + k[1]) + k[2] * math.sin(3 * a + k[3]) * 0.6 + k[4] * math.sin(5 * a + k[5]) * 0.4)
        pts.append((math.cos(a) * rx * w, math.sin(a) * ry * w))
    return pts


def stack(bm, base, layers, rnd, centre=(0, 0)):
    """Stratified butte: layers = [(z0, z1, scale0, scale1, ledge_inset, material_index), ...]."""
    cx, cy = centre
    prev, prev_m = None, 0
    n = len(base)

    def ring(sc, z, jit):
        return [bm.verts.new((cx + x * sc * j, cy + y * sc * j, z)) for (x, y), j in zip(base, jit)]

    def band(a, b, m):
        for i in range(n):
            i2 = (i + 1) % n
            bm.faces.new((a[i], a[i2], b[i2], b[i])).material_index = m

    for z0, z1, s0, s1, inset, m in layers:
        jit = [rnd.uniform(0.975, 1.025) for _ in base]
        r0 = ring(s0, z0, jit)
        if prev is not None:
            band(prev, r0, prev_m)
        r1 = ring(s1, z1, jit)
        band(r0, r1, m)
        prev, prev_m = r1, m
        if inset:
            inner = [bm.verts.new((cx + (v.co.x - cx) * (1 - inset), cy + (v.co.y - cy) * (1 - inset), z1)) for v in r1]
            band(r1, inner, m)
            prev = inner
    bm.faces.new(prev).material_index = 2


@model
def mesa(out):
    """Big stratified butte backdrop, ~36 × 24 m, 18 m tall, plus a smaller spire on its right."""
    lib2.reset()
    mats = [M(b) for b in BANDS]  # 0 orange, 1 sand, 2 red, 3 light
    O, S, R, L = 0, 1, 2, 3
    rnd = random.Random(2)
    bm = bmesh.new()
    base = outline(44, 14.6, 10.0, 5, amp=0.16)
    layers = [
        (0.0, 3.2, 1.2, 1.0, 0.0, S),  # talus apron
        (3.2, 5.0, 1.0, 0.985, 0.0, O),
        (5.0, 6.2, 0.985, 0.975, 0.0, L),
        (6.2, 8.6, 0.975, 0.96, 0.012, R),
        (8.6, 10.0, 0.948, 0.94, 0.0, O),
        (10.0, 11.0, 0.94, 0.935, 0.0, L),
        (11.0, 13.6, 0.935, 0.92, 0.0, O),
        (13.6, 15.2, 0.92, 0.91, 0.01, R),
        (15.2, 16.6, 0.9, 0.895, 0.0, L),
        (16.6, 18.0, 0.91, 0.925, 0.0, R),  # caprock, slightly overhanging
    ]
    stack(bm, base, layers, rnd)
    spire = outline(16, 3.2, 2.8, 9, amp=0.12)
    stack(bm, spire, [(0.0, 2.0, 1.35, 1.0, 0.0, S), (2.0, 4.6, 1.0, 0.95, 0.0, O), (4.6, 6.0, 0.95, 0.93, 0.0, L), (6.0, 8.8, 0.93, 0.85, 0.0, O), (8.8, 10.0, 0.85, 0.82, 0.0, R), (10.0, 11.0, 0.88, 0.9, 0.0, R)], rnd, centre=(16.6, -3.0))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    parts = [lib2.to_obj("mesa_body", bm, mats, "flat")]
    for k in range(9):
        a = rnd.uniform(0, 2 * PI)
        r = rnd.uniform(0.9, 1.8)
        parts.append(ico("talus", r, (math.cos(a) * 17.8, math.sin(a) * 12.2, r * 0.4), mats[(O, R, S)[k % 3]], sub=2, jitter=0.2, seed=k, scale=(1.2, 1, 0.7)))
    root = join("mesa", parts)
    lib2.flat_bottom(root, 0.0)
    lib2.export(os.path.join(out, "mesa.glb"), [root])


def drock(name, blobs, out):
    lib2.reset()
    mats = [M("desert_orange"), M("desert_red"), M("desert_sand")]
    parts = []
    for k, (c, r, sc, seed) in enumerate(blobs):
        parts.append(ico("rock", r, c, mats[0], sub=3 if k == 0 else 2, scale=sc, jitter=0.15, seed=seed, rot=(0, 0, seed)))
    root = join(name, parts)
    lib2.flat_bottom(root, 0.0)
    for m in mats[1:]:
        root.data.materials.append(m)
    top = max(v.co.z for v in root.data.vertices)
    lib2.color_bands(root, [top * 0.33, top * 0.62], [0, 1, 2])
    lib2.export(os.path.join(out, name + ".glb"), [root])


@model
def desert_rock_a(out):
    drock("desert_rock_a", [((0, 0, 1.0), 1.6, (1.3, 1.0, 0.9), 3)], out)


@model
def desert_rock_b(out):
    drock("desert_rock_b", [((0, 0, 1.6), 1.9, (0.9, 0.8, 1.15), 6), ((1.8, 0.4, 0.6), 0.9, (1, 1, 0.8), 7)], out)


@model
def palm(out):
    lib2.reset()
    Wd, Wk, G, Gd = M("wood"), M("wood_dark"), M("green"), M("green_dark")
    H, lean = 8.6, 1.7
    nseg = 9
    pts, radii = [], []

    def trunk_at(t):
        return Vector((lean * t * t, 0, H * t))

    for i in range(nseg):
        t0, t1 = i / nseg, (i + 1) / nseg
        r = 0.42 - 0.17 * t0
        p0, p1 = trunk_at(t0), trunk_at(t1)
        pts += [p0 + (p1 - p0) * 0.02, p0 + (p1 - p0) * 0.9, p0 + (p1 - p0) * 0.999]
        radii += [r * 0.86, r * 1.1, r * 0.86]
    parts = [sweep("trunk", pts, radii, [Wd, Wk], sides=7, shade="flat", matfn=lambda i, s: (i // 3) % 2 if i >= 0 else 0)]
    top = trunk_at(1.0)
    parts.append(ico("crown", 0.45, top, G, sub=2, scale=(1, 1, 0.7)))
    for k in range(3):
        a = k * 2 * PI / 3 + 0.4
        parts.append(uvs("coconut", 0.22, top + Vector((0.32 * math.cos(a), 0.32 * math.sin(a), -0.3)), Wk, seg=8, rings=6))
    # 7 fronds: creased, drooping, tapered strips
    rnd = random.Random(9)
    for k in range(7):
        a = k * 2 * PI / 7 + rnd.uniform(-0.15, 0.15)
        d = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-d.y, d.x, 0))
        L = rnd.uniform(3.4, 4.0)
        lift = rnd.uniform(0.6, 1.0)
        bm = bmesh.new()
        rows = []
        st = 7
        for j in range(st + 1):
            t = j / st
            c = top + d * (L * t) + Vector((0, 0, lift * 1.6 * t - 2.6 * t * t))
            w = 0.8 * math.sin(PI * min(1.0, t * 1.05) ** 0.75) + 0.02
            crease = Vector((0, 0, 0.16 * (1 - t)))
            rows.append([bm.verts.new(c - side * w), bm.verts.new(c + crease), bm.verts.new(c + side * w)])
        for j in range(st):
            a0, a1 = rows[j], rows[j + 1]
            bm.faces.new((a0[0], a1[0], a1[1], a0[1]))
            bm.faces.new((a0[1], a1[1], a1[2], a0[2]))
        parts.append(lib2.to_obj("frond", bm, G if k % 2 == 0 else Gd, "flat"))
    root = join("palm", parts)
    lib2.export(os.path.join(out, "palm.glb"), [root])


@model
def arch_rock(out):
    lib2.reset()
    mats = [M(b) for b in ("desert_orange", "desert_red", "desert_sand")]
    N = 30
    pts, radii = [], []
    for i in range(N + 1):
        a = PI - PI * i / N
        x = 7.8 * math.cos(a)
        z = 12.5 * math.sin(a) - 0.8
        foot = abs(math.cos(a)) ** 3
        pts.append((x, 0, z))
        radii.append((3.0 + 1.2 * foot, 1.9 + 1.6 * foot))
    rnd = random.Random(17)
    prof = []
    for k in range(10):
        ang = 2 * PI * k / 10
        w = rnd.uniform(0.88, 1.12)
        prof.append((math.cos(ang) * w, math.sin(ang) * w))
    body = sweep("arch", pts, radii, mats[0], profile=prof, up=(0, 1, 0), shade="flat")
    for v in body.data.vertices:
        v.co += Vector((rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), rnd.uniform(-0.25, 0.25)))
    parts = [body]
    for x, r, s in ((-9.6, 1.8, 21), (9.8, 1.5, 22), (-6.8, 1.1, 23), (7.4, 1.3, 24)):
        parts.append(ico("boulder", r, (x, rnd.uniform(-2.5, 2.5), r * 0.45), mats[0], sub=2, jitter=0.2, seed=s, scale=(1.2, 1, 0.75)))
    root = join("arch_rock", parts)
    for m in mats[1:]:
        root.data.materials.append(m)
    lib2.flat_bottom(root, 0.0)
    lib2.color_bands(root, [2.2, 4.4, 6.6, 8.8, 11.0], [0, 2, 1, 0, 2, 1])
    lib2.export(os.path.join(out, "arch_rock.glb"), [root])


lib2.run(MODELS)

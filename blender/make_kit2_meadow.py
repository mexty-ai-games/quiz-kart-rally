"""Kit 2 — Meadow theme (sunny day): round trees, bushes, flowers, windmill, barn, fence.

  python3 blender/make_kit2_meadow.py -- blender/out2 [model ...]

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
from lib2 import M, beam, cyl, ico, join, lathe, prism, rbox, sweep  # noqa: E402

PI = math.pi
MODELS = {}


def model(fn):
    MODELS[fn.__name__] = fn
    return fn


def trunk(h, r0, r1, m, parts, lean=(0, 0)):
    prof = [(r0 * 1.35, 0), (r0, 0.35), (r1, h)]
    parts.append(lathe("trunk", prof, m, seg=7, shade="flat", cap_top=True))


def canopy(blobs, mats, parts, seed=1):
    rnd = random.Random(seed)
    for k, (c, r, sub, sc) in enumerate(blobs):
        parts.append(ico("leaf", r, c, mats[k % len(mats)], sub=sub, scale=sc, jitter=0.08, seed=rnd.randint(0, 999), rot=(0, 0, rnd.uniform(0, 3))))


@model
def tree_round_a(out):
    lib2.reset()
    W, G1, G2 = M("wood"), M("green"), M("green_dark")
    parts = []
    trunk(4.6, 0.36, 0.24, W, parts)
    parts.append(beam("branch", (0, 0, 3.0), (0.9, 0.2, 4.1), 0.18, W))
    canopy([((0, 0, 5.2), 2.35, 3, (1, 1, 0.92)), ((1.35, 0.3, 4.4), 1.55, 3, (1, 1, 0.9)), ((-1.2, -0.4, 4.6), 1.45, 2, (1, 1, 0.9)), ((0.2, -0.3, 6.6), 1.4, 2, (1, 1, 0.9))], [G1, G2, G2, G1], parts, 2)
    root = join("tree_round_a", parts)
    lib2.export(os.path.join(out, "tree_round_a.glb"), [root])


@model
def tree_round_b(out):
    lib2.reset()
    W, G1, G2 = M("wood_dark"), M("green_light"), M("green")
    parts = []
    trunk(5.8, 0.34, 0.22, W, parts)
    canopy([((0, 0, 6.6), 2.0, 3, (1, 1, 1.05)), ((0.3, 0.2, 4.9), 2.1, 3, (1, 1, 0.8)), ((-0.2, -0.1, 8.0), 1.2, 2, (1, 1, 1)), ((1.6, -0.2, 6.0), 1.1, 2, (1, 1, 1)), ((-1.6, 0.3, 5.9), 1.15, 2, (1, 1, 1))], [G1, G2, G1, G2, G2], parts, 5)
    root = join("tree_round_b", parts)
    lib2.export(os.path.join(out, "tree_round_b.glb"), [root])


@model
def bush_a(out):
    lib2.reset()
    G1, G2 = M("green"), M("green_dark")
    parts = []
    canopy([((0, 0, 0.55), 0.75, 3, (1.1, 1, 0.85)), ((0.65, 0.15, 0.4), 0.5, 2, (1, 1, 0.9)), ((-0.6, -0.1, 0.38), 0.52, 2, (1, 1, 0.9)), ((0.1, 0.45, 0.42), 0.45, 2, (1, 1, 0.9))], [G1, G2, G2, G1], parts, 7)
    root = join("bush_a", parts)
    lib2.flat_bottom(root, 0.0)
    lib2.export(os.path.join(out, "bush_a.glb"), [root])


@model
def bush_b(out):
    lib2.reset()
    G1, G2, P, Y = M("green_dark"), M("green"), M("pink"), M("yellow")
    parts = []
    blobs = [((0, 0, 0.6), 0.72, 2, (1.15, 1, 0.95)), ((0.7, 0.1, 0.45), 0.55, 2, (1, 1, 0.9)), ((-0.65, 0.05, 0.45), 0.55, 2, (1, 1, 0.9)), ((0.0, -0.45, 0.5), 0.5, 2, (1, 1, 0.9))]
    canopy(blobs, [G1, G2, G2, G1], parts, 9)
    rnd = random.Random(4)
    n = 0
    while n < 13:
        c, r, _, sc = rnd.choice(blobs)
        th, ph = rnd.uniform(0, 2 * PI), rnd.uniform(0.15, 1.2)
        d = Vector((math.cos(th) * math.cos(ph), math.sin(th) * math.cos(ph), math.sin(ph)))
        p = Vector(c) + Vector((d.x * sc[0], d.y * sc[1], d.z * sc[2])) * r * 1.02
        if p.z < 0.35:
            continue
        parts.append(ico("flower", 0.085, p, P if n % 3 else Y, sub=1, scale=(1, 1, 0.7)))
        n += 1
    root = join("bush_b", parts)
    lib2.flat_bottom(root, 0.0)
    lib2.export(os.path.join(out, "bush_b.glb"), [root])


@model
def flower_patch(out):
    lib2.reset()
    St, Gl = M("green_dark"), M("green_light")
    petals = [M("pink"), M("yellow"), M("white"), M("sky"), M("orange")]
    rnd = random.Random(21)
    parts = []
    placed = []
    while len(placed) < 34:
        x, y = rnd.uniform(-1.5, 1.5), rnd.uniform(-1.5, 1.5)
        if x * x + y * y > 1.5 * 1.5 or any((x - a) ** 2 + (y - b) ** 2 < 0.09 for a, b in placed):
            continue
        placed.append((x, y))
    bm_stem = bmesh.new()
    for k, (x, y) in enumerate(placed):
        h = rnd.uniform(0.3, 0.72)
        tip = Vector((x + rnd.uniform(-0.05, 0.05), y + rnd.uniform(-0.05, 0.05), h))
        parts.append(sweep("stem", [(x, y, 0), tip], 0.03, St, sides=3, shade="flat", cap_start=False))
        r = rnd.uniform(0.15, 0.21)
        star = []
        for i in range(10):
            a = i * PI / 5
            rr = r if i % 2 == 0 else r * 0.55
            star.append((rr * math.cos(a), rr * math.sin(a)))
        tilt = (rnd.uniform(-0.35, 0.35), rnd.uniform(-0.35, 0.35), rnd.uniform(0, PI))
        bm = bmesh.new()
        bm.faces.new([bm.verts.new((u, v, 0)) for u, v in star])
        parts.append(lib2.to_obj("petals", bm, petals[k % len(petals)], matrix=lib2.xform(tip, tilt)))
        parts.append(cyl("heart", r * 0.32, 0.05, tip + Vector((0, 0, 0.012)), M("yellow") if k % len(petals) != 1 else M("orange"), verts=5, rot=tilt, shade="flat"))
    # grass tufts between the flowers
    for k in range(26):
        x, y = rnd.uniform(-1.5, 1.5), rnd.uniform(-1.5, 1.5)
        if x * x + y * y > 1.6 * 1.6:
            continue
        bm = bmesh.new()
        a = rnd.uniform(0, PI)
        dx, dy = 0.08 * math.cos(a), 0.08 * math.sin(a)
        h = rnd.uniform(0.18, 0.32)
        bm.faces.new([bm.verts.new(p) for p in ((x - dx, y - dy, 0), (x + dx, y + dy, 0), (x + rnd.uniform(-0.05, 0.05), y, h))])
        parts.append(lib2.to_obj("blade", bm, Gl))
    bm_stem.free()
    root = join("flower_patch", parts)
    lib2.export(os.path.join(out, "flower_patch.glb"), [root])


@model
def windmill(out):
    lib2.reset()
    Cr, Rd, Wd, Wk, Wh, Sk, C = M("cream"), M("red"), M("wood"), M("wood_dark"), M("white"), M("sky"), M("charcoal")
    parts = []
    body = [(2.75, 0.0), (2.75, 0.55), (2.6, 0.62), (2.15, 7.6), (2.15, 7.75)]
    parts.append(lathe("body", body, Cr, seg=8, shade="flat", a0=PI / 8))
    parts.append(lathe("plinth", [(2.95, 0), (2.95, 0.5), (2.75, 0.62)], Wk, seg=8, shade="flat", a0=PI / 8, cap_top=True))
    # gallery ring + railing posts
    parts.append(cyl("gallery", 2.9, 0.22, (0, 0, 7.7), Wd, verts=8, shade="flat", rot=(0, 0, PI / 8)))
    for k in range(8):
        a = PI / 8 + k * PI / 4 + PI / 8
        parts.append(rbox("rail_post", (0.12, 0.12, 0.55), (2.75 * math.cos(a), 2.75 * math.sin(a), 8.08), Wk))
    parts.append(lathe("rail", [(2.7, 8.32), (2.82, 8.32), (2.82, 8.42), (2.7, 8.42), (2.7, 8.32)], Wk, seg=8, shade="flat", a0=PI / 8))
    roof = [(2.45, 7.8), (2.5, 8.15), (1.9, 9.6), (1.0, 10.9), (0.0, 11.7)]
    parts.append(lathe("roof", roof, Rd, seg=8, shade="flat", a0=PI / 8, cap_bottom=True))
    parts.append(cyl("finial", 0.12, 0.6, (0, 0, 11.95), Wk, verts=6))
    parts.append(lib2.uvs("finial_ball", 0.2, (0, 0, 12.3), M("yellow"), seg=8, rings=5))
    # door and windows on the front (-Y) and the sides
    yb = -2.62
    parts.append(rbox("door", (1.3, 0.3, 2.0), (0, yb + 0.05, 1.15), Wd, bevel=0.06))
    parts.append(cyl("door_top", 0.65, 0.3, (0, yb + 0.05, 2.15), Wd, verts=12, rot=(PI / 2, 0, 0), shade="flat"))
    parts.append(rbox("door_frame", (1.55, 0.2, 0.18), (0, yb - 0.02, 0.15), Wh))
    for z, scale in ((3.6, 1.0), (5.6, 0.9)):
        r = 2.75 - (2.75 - 2.15) * (z / 7.6) - 0.05
        for a in (-PI / 2, 0.0, PI):
            x, y = r * math.cos(a), r * math.sin(a)
            parts.append(rbox("win_frame", (0.3, 0.95 * scale, 1.2 * scale), (x, y, z), Wh, bevel=0.04, rot=(0, 0, a)))
            parts.append(rbox("win", (0.3, 0.68 * scale, 0.92 * scale), (x * 1.025, y * 1.025, z), Sk, bevel=0.03, rot=(0, 0, a)))
    hub = Vector((0, -2.75, 8.9))
    parts.append(cyl("axle", 0.32, 1.2, (0, -2.15, 8.9), C, verts=10, rot=(PI / 2, 0, 0)))
    root = join("windmill", parts)
    # BLADES: separate child, origin exactly at the hub, sails in the local XZ plane (face -Y = +Z glTF)
    bl = []
    bl.append(cyl("hub", 0.55, 0.6, (0, 0, 0), C, verts=12, rot=(PI / 2, 0, 0)))
    bl.append(lathe("nose", [(0.42, 0.0), (0.3, 0.3), (0.0, 0.5)], Rd, seg=10, rot=(PI / 2, 0, 0), loc=(0, -0.28, 0), shade=50))
    RAD = 5.4
    for k in range(4):
        a = PI / 4 + k * PI / 2
        d = Vector((math.cos(a), 0, math.sin(a)))
        side = Vector((-math.sin(a), 0, math.cos(a)))
        bl.append(beam("spar", d * 0.3, d * RAD, 0.24, Wk, bevel=0.03))
        # sail panel on one side of the spar, with a wooden lattice
        c0, c1 = d * 1.2, d * (RAD - 0.15)
        mid = (c0 + c1) / 2 + side * 0.72
        L = (c1 - c0).length
        bl.append(rbox("sail", (L, 0.07, 1.25), mid + Vector((0, -0.08, 0)), Wh, rot=(0, -a, 0)))
        for t in (0.0, 0.25, 0.5, 0.75, 1.0):
            p = c0.lerp(c1, t)
            bl.append(beam("lath", p + Vector((0, -0.16, 0)), p + side * 1.38 + Vector((0, -0.16, 0)), 0.09, Wd))
        bl.append(beam("edge", c0 + side * 1.38 + Vector((0, -0.16, 0)), c1 + side * 1.38 + Vector((0, -0.16, 0)), 0.1, Wd))
    blades = join("BLADES", bl)
    blades.location = hub
    blades.parent = root
    lib2.export(os.path.join(out, "windmill.glb"), [root])


@model
def barn(out):
    lib2.reset()
    Rd, Wh, Rf, Wd, Hy = M("barn_red"), M("white"), M("charcoal"), M("wood_dark"), M("yellow")
    W2, D2 = 3.25, 4.0
    prof = [(-W2, 0), (W2, 0), (W2, 3.6), (2.25, 5.75), (0, 7.0), (-2.25, 5.75), (-W2, 3.6)]
    parts = [prism("walls", prof, -D2, D2, Rd, axis="y")]
    # gambrel roof slabs (overhanging)
    segs = [((-W2 - 0.35, 3.35), (-2.25, 5.75)), ((-2.25, 5.75), (0, 7.0)), ((0, 7.0), (2.25, 5.75)), ((2.25, 5.75), (W2 + 0.35, 3.35))]
    for (x0, z0), (x1, z1) in segs:
        a = Vector((x0, 0, z0))
        b = Vector((x1, 0, z1))
        n = Vector((-(z1 - z0), 0, x1 - x0)).normalized() * 0.16
        for y in (0,):
            parts.append(rbox("roof", ((b - a).length + 0.05, 2 * D2 + 0.7, 0.28), (a + b) / 2 + n, Rf, rot=(0, -math.atan2(z1 - z0, x1 - x0), 0)))
    parts.append(beam("ridge", (0, -D2 - 0.4, 7.25), (0, D2 + 0.4, 7.25), 0.3, Wh))
    # white trim along the gable outline (front and back), corners, base
    for y in (-D2 - 0.06, D2 + 0.06):
        pts = [(-W2, 3.6), (-2.25, 5.75), (0, 7.0), (2.25, 5.75), (W2, 3.6)]
        for (x0, z0), (x1, z1) in zip(pts, pts[1:]):
            parts.append(beam("gable_trim", (x0, y, z0), (x1, y, z1), 0.2, Wh, h=0.12))
        parts.append(beam("eave_trim", (-W2, y, 3.6), (W2, y, 3.6), 0.2, Wh, h=0.12))
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(rbox("corner", (0.24, 0.24, 3.6), (sx * (W2 + 0.02), sy * (D2 + 0.02), 1.8), Wh))
    # big front door with X braces
    yf = -D2 - 0.08
    parts.append(rbox("door", (2.6, 0.12, 2.9), (0, yf, 1.45), Rd))
    parts.append(rbox("door_frame_l", (0.2, 0.16, 3.0), (-1.35, yf - 0.02, 1.5), Wh))
    parts.append(rbox("door_frame_r", (0.2, 0.16, 3.0), (1.35, yf - 0.02, 1.5), Wh))
    parts.append(rbox("door_frame_t", (2.9, 0.16, 0.2), (0, yf - 0.02, 3.0), Wh))
    parts.append(rbox("door_mid", (0.14, 0.16, 2.9), (0, yf - 0.02, 1.45), Wh))
    for x0 in (-1.3, 0.05):
        parts.append(beam("brace", (x0, yf - 0.03, 0.1), (x0 + 1.25, yf - 0.03, 2.85), 0.14, Wh, h=0.1))
        parts.append(beam("brace", (x0 + 1.25, yf - 0.03, 0.1), (x0, yf - 0.03, 2.85), 0.14, Wh, h=0.1))
    # hay loft door with hay peeking out
    parts.append(rbox("loft", (1.4, 0.14, 1.2), (0, yf, 5.0), Wd))
    parts.append(rbox("loft_frame", (1.7, 0.1, 1.5), (0, yf + 0.03, 5.0), Wh))
    parts.append(rbox("hay", (1.1, 0.3, 0.4), (0, yf - 0.1, 4.62), Hy, bevel=0.08))
    # side windows
    for sx in (-1, 1):
        for y in (-1.6, 1.6):
            parts.append(rbox("win_frame", (0.12, 1.2, 1.2), (sx * (W2 + 0.04), y, 2.2), Wh))
            parts.append(rbox("win", (0.13, 0.9, 0.9), (sx * (W2 + 0.05), y, 2.2), Wd))
            parts.append(rbox("win_x", (0.14, 0.1, 1.1), (sx * (W2 + 0.06), y, 2.2), Wh, rot=(PI / 4, 0, 0)))
    root = join("barn", parts)
    lib2.export(os.path.join(out, "barn.glb"), [root])


@model
def fence_segment(out):
    lib2.reset()
    Wd, Wk = M("wood"), M("wood_dark")
    parts = []
    for x in (-2.0, 0.0, 2.0):
        parts.append(prism("post", [(-0.11, 0), (0.11, 0), (0.11, 1.0), (0, 1.15), (-0.11, 1.0)], -0.11, 0.11, Wk, axis="y", loc=(x, 0, 0)))
    for z in (0.42, 0.8):
        parts.append(rbox("rail", (4.0, 0.08, 0.2), (0, -0.14, z), Wd, bevel=0.025))
    root = join("fence_segment", parts)
    lib2.export(os.path.join(out, "fence_segment.glb"), [root])


lib2.run(MODELS)

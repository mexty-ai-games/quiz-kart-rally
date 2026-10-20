"""Kit 2 — shared track furniture (procedural, Kenney-style chunky low poly).

  python3 blender/make_kit2_track.py -- blender/out2            # every model
  python3 blender/make_kit2_track.py -- blender/out2 gantry_v2  # just some

Blender axes while building: Z up, -Y = towards the incoming karts (= +Z in glTF), +Y = travel.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import lib  # noqa: E402
import lib2  # noqa: E402
from lib2 import M, beam, cyl, empty, glass, glow, join, lathe, prism, quad, rbox, sweep, text, uvs  # noqa: E402

PI = math.pi
MODELS = {}


def model(fn):
    MODELS[fn.__name__] = fn
    return fn


# ---------------------------------------------------------------- 1. item box


@model
def item_box_v2(out):
    lib2.reset()
    S = 1.5
    shell = rbox("shell", (S, S, S), (0, 0, 0), glass("glass_box", "a995ff", 0.55), bevel=0.24, seg=3)
    q = glow("glow_question", "ffd84a", 1.3)
    parts = [shell]
    for k in range(4):
        t = lib2.question_mark(f"q{k}", 1.0, 0.16, q, rot=(PI / 2, 0, 0))
        t.data.transform(Matrix.Rotation(k * PI / 2, 4, "Z") @ Matrix.Translation((0, -0.6, 0.05)))
        parts.append(t)
    root = join("item_box_v2", parts)
    lib2.export(os.path.join(out, "item_box_v2.glb"), [root])


# ---------------------------------------------------------------- 2. question gantry


def truss_tower(x0, H, parts, w=1.6, levels=(1.2, 2.7, 4.2, 5.7, 7.2)):
    P, O, C = M("purple"), M("orange"), M("charcoal")
    h = w / 2 - 0.13
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(rbox("post", (0.28, 0.28, H), (x0 + sx * h, sy * h, H / 2), P, bevel=0.05))
    lv = [0.55] + list(levels)
    for z in levels:
        for a, b in (((-h, -h), (h, -h)), ((h, -h), (h, h)), ((h, h), (-h, h)), ((-h, h), (-h, -h))):
            parts.append(beam("ring", (x0 + a[0], a[1], z), (x0 + b[0], b[1], z), 0.15, O))
    for i in range(len(lv) - 1):
        z0, z1 = lv[i], lv[i + 1]
        flip = i % 2
        faces = (((-h, -h), (h, -h)), ((h, -h), (h, h)), ((h, h), (-h, h)), ((-h, h), (-h, -h)))
        for a, b in faces:
            if flip:
                a, b = b, a
            parts.append(beam("diag", (x0 + a[0], a[1], z0), (x0 + b[0], b[1], z1), 0.12, O))
    # chunky foot
    parts.append(rbox("foot", (w + 0.9, w + 0.9, 0.55), (x0, 0, 0.275), C, bevel=0.1, seg=2))
    parts.append(rbox("foot_band", (w + 0.6, w + 0.6, 0.14), (x0, 0, 0.6), M("orange"), bevel=0.04))


@model
def gantry_v2(out):
    lib2.reset()
    P, O, C, Y = M("purple"), M("orange"), M("charcoal"), M("yellow")
    parts = []
    X = 11.5
    HT = 8.9  # top of the beam
    for s in (-1, 1):
        truss_tower(s * X, HT - 1.3, parts)
    # top truss beam (z 7.6..8.9), spanning past both towers
    z0, z1, hy = HT - 1.3 + 0.15, HT - 0.15, 0.6
    xa, xb = -X - 0.8, X + 0.8
    for y in (-hy, hy):
        for z in (z0, z1):
            parts.append(rbox("chord", (xb - xa, 0.32, 0.32), (0, y, z), P, bevel=0.05))
    n = 14
    for i in range(n + 1):
        x = xa + (xb - xa) * i / n
        for y in (-hy, hy):
            parts.append(beam("vert", (x, y, z0), (x, y, z1), 0.14, O))
        parts.append(beam("rung", (x, -hy, z1), (x, hy, z1), 0.12, O))
        parts.append(beam("rung", (x, -hy, z0), (x, hy, z0), 0.12, O))
        if i < n:
            x2 = xa + (xb - xa) * (i + 1) / n
            a, b = (x, z0), (x2, z1)
            if i % 2:
                a, b = (x, z1), (x2, z0)
            for y in (-hy, hy):
                parts.append(beam("diag", (a[0], y, a[1]), (b[0], y, b[1]), 0.12, O))
    # end caps of the beam
    for s in (-1, 1):
        parts.append(rbox("cap", (0.5, 1.6, 1.6), (s * (X + 0.95), 0, (z0 + z1) / 2), P, bevel=0.1, seg=2))
    # screen housing hung in front of the truss (towards -Y = incoming karts)
    W, SH, ZC = 10.0, 3.1, 6.6
    yf = -1.0
    parts.append(rbox("housing", (W + 1.0, 0.55, SH + 0.9), (0, yf + 0.27, ZC), C, bevel=0.14, seg=2))
    for x in (-3.6, 3.6):
        parts.append(rbox("bracket", (0.5, 1.2, 0.5), (x, -0.25, z1 - 0.05), C, bevel=0.06))
    # spotlight cans on top of the beam, aimed at the road ahead of the gantry
    lamp = glow("glow_lamp", "fff2c4", 4.0)
    d = Vector((0, -0.8, -0.6)).normalized()
    th = math.atan2(-d.y, d.z)  # rotation about X that maps +Z onto d
    for x in (-9.6, -6.4, 6.4, 9.6):
        base = Vector((x, -0.45, z1 + 0.62))
        parts.append(rbox("yoke", (0.9, 0.18, 0.5), (x, -0.45, z1 + 0.32), C, bevel=0.04))
        parts.append(cyl("can", 0.36, 0.7, base, C, verts=12, r2=0.42, rot=(th, 0, 0)))
        parts.append(cyl("lens", 0.36, 0.06, base + d * 0.37, lamp, verts=12, rot=(th, 0, 0)))
    # round "?" badge on top of the beam
    parts.append(cyl("badge", 1.0, 0.3, (0, 0, z1 + 1.15), Y, verts=20, rot=(PI / 2, 0, 0)))
    parts.append(cyl("badge_rim", 1.12, 0.22, (0, 0, z1 + 1.15), O, verts=20, rot=(PI / 2, 0, 0)))
    parts.append(rbox("badge_post", (0.5, 0.3, 0.6), (0, 0, z1 + 0.2), C))
    for s in (-1, 1):
        parts.append(lib2.question_mark("badge_q", 1.25, 0.08, P, loc=(0, s * 0.17, z1 + 1.15), rot=(PI / 2, 0, 0 if s < 0 else PI)))
    # glowing frame around the screen
    fr = glow("glow_screen_frame", "ff8a1e", 2.5)
    t = 0.24
    yfr = yf - 0.04
    parts += [
        rbox("ft", (W + 2 * t, 0.16, t), (0, yfr, ZC + SH / 2 + t / 2), fr, bevel=0.04),
        rbox("fb", (W + 2 * t, 0.16, t), (0, yfr, ZC - SH / 2 - t / 2), fr, bevel=0.04),
        rbox("fl", (t, 0.16, SH), (-W / 2 - t / 2, yfr, ZC), fr, bevel=0.04),
        rbox("fr", (t, 0.16, SH), (W / 2 + t / 2, yfr, ZC), fr, bevel=0.04),
    ]
    root = join("gantry_v2", parts)
    scr = lib.plane("SCREEN", W, SH, (0, yf - 0.01, ZC), M("screen", "0c1230", rough=0.5, emit=0.25), rot=(PI / 2, 0, 0))
    scr.parent = root
    lib2.export(os.path.join(out, "gantry_v2.glb"), [root])


# ---------------------------------------------------------------- 3. start / finish arch


def bunting(pts, mats, size=0.55, parts=None, name="pennant"):
    """Little triangle pennants hanging along a polyline (each a single double-sided triangle)."""
    for i in range(len(pts) - 1):
        a, b = Vector(pts[i]), Vector(pts[i + 1])
        bm = bmesh.new()
        m = (a + b) / 2
        v = [bm.verts.new(a), bm.verts.new(b), bm.verts.new(m + Vector((0, 0, -size)))]
        bm.faces.new(v)
        o = lib2.to_obj(name, bm, mats[i % len(mats)])
        parts.append(o)


@model
def start_arch_v2(out):
    lib2.reset()
    P, O, Y, W, C, PK = M("purple"), M("orange"), M("yellow"), M("white"), M("charcoal"), M("pink")
    parts = []
    X = 12.5
    TH = 7.6
    for s in (-1, 1):
        x = s * X
        parts.append(rbox("foot", (2.9, 2.9, 0.6), (x, 0, 0.3), C, bevel=0.12, seg=2))
        parts.append(rbox("tower", (2.1, 2.1, TH - 0.6), (x, 0, 0.6 + (TH - 0.6) / 2), P, bevel=0.18, seg=2))
        for z in (1.6, 3.6, 5.6):
            parts.append(rbox("band", (2.24, 2.24, 0.5), (x, 0, z), O, bevel=0.06, seg=2))
        for z in (2.6, 4.6):
            parts.append(rbox("band_w", (2.2, 2.2, 0.16), (x, 0, z), W, bevel=0.03))
        parts.append(rbox("cap", (2.6, 2.6, 0.45), (x, 0, TH + 0.2), O, bevel=0.1, seg=2))
        # flag on the outer corner of the cap
        fx = x + s * 0.95
        parts.append(cyl("flagpole", 0.06, 3.4, (fx, 0.9, TH + 2.1), W, verts=8))
        parts.append(uvs("flagball", 0.14, (fx, 0.9, TH + 3.85), Y, seg=8, rings=5))
        pts = [(fx, 0.9, TH + 3.6), (fx + s * 1.5, 0.9, TH + 3.25), (fx, 0.9, TH + 2.85)]
        bm = bmesh.new()
        bm.faces.new([bm.verts.new(p) for p in pts])
        parts.append(lib2.to_obj("pennant", bm, Y))
        # balloon bunch on the tower top
        rnd = random.Random(3 + s)
        cols = [PK, Y, W, O]
        anchor = Vector((x - s * 0.2, -0.2, TH + 0.45))
        for k, (dx, dy, dz) in enumerate(((-0.55, -0.35, 1.7), (0.5, -0.25, 1.95), (0.0, 0.45, 2.25), (-0.15, -0.7, 2.6))):
            c = Vector((x + dx, dy, TH + dz))
            parts += lib2.balloon("balloon", 0.55, c, cols[k], seg=10)
            parts.append(sweep("string", [anchor, c + Vector((0, 0, -0.55 * 1.3))], 0.02, W, sides=3, shade="flat"))
    # arched top: circular arc through the tower tops and the apex
    zs, apex = TH + 0.1, 10.4
    sag = apex - zs
    R = (X * X + sag * sag) / (2 * sag)
    zc = apex - R
    amax = math.asin(X / R)
    N = 26
    arc = [(R * math.sin(-amax + 2 * amax * i / N), 0.0, zc + R * math.cos(-amax + 2 * amax * i / N)) for i in range(N + 1)]
    prof = [(1, 0.55), (0.7, 1), (-0.7, 1), (-1, 0.55), (-1, -0.55), (-0.7, -1), (0.7, -1), (1, -0.55)]
    # stripes: orange blocks on a purple band
    arch = sweep("arch", arc, (0.85, 0.6), [P, O], profile=prof, up=(0, 1, 0), shade=40, matfn=lambda i, s: 1 if (i % 4 in (0, 1) and i not in (-1, N)) else 0)
    parts.append(arch)
    # bunting hanging under the arch
    bpts = []
    for i in range(1, 22):
        a = -amax * 0.86 + 2 * amax * 0.86 * i / 22
        bpts.append((R * math.sin(a) * 0.985, -0.7, zc + (R - 0.75) * math.cos(a) - 0.05))
    bunting(bpts, [Y, PK, W, O], 0.55, parts)
    bunting([(p[0], 0.7, p[2]) for p in bpts], [Y, PK, W, O], 0.55, parts)
    # chequered banner between the towers (black core + white squares on both faces)
    BW, z0, z1 = 2 * X - 2.1, 5.9, 7.3
    parts.append(rbox("banner_core", (BW, 0.24, z1 - z0), (0, 0, (z0 + z1) / 2), C))
    cols, rows = 20, 2
    sw, sh = BW / cols, (z1 - z0) / rows
    for i in range(cols):
        for r in range(rows):
            if (i + r) % 2 == 0:
                x = -BW / 2 + sw * (i + 0.5)
                z = z0 + sh * (r + 0.5)
                parts.append(quad("chk", sw, sh, (x, -0.125, z), W))
                parts.append(quad("chk", sw, sh, (x, 0.125, z), W, rot=(-PI / 2, 0, 0)))
    for z in (z0 - 0.09, z1 + 0.09):
        parts.append(rbox("trim", (BW + 0.2, 0.36, 0.18), (0, 0, z), O, bevel=0.04))
    # lamp bar (charcoal) carrying the five countdown lamps
    LZ = 8.45
    parts.append(rbox("lamp_bar", (10.6, 0.7, 1.5), (0, 0, LZ), C, bevel=0.16, seg=2))
    for x in (-3.8, 3.8):
        parts.append(rbox("lamp_post", (0.3, 0.3, LZ - 0.75 - z1), (x, 0, (LZ - 0.75 + z1) / 2), C))
        top = zc + math.sqrt(R * R - x * x) - 0.6
        parts.append(rbox("lamp_hang", (0.25, 0.25, top - (LZ + 0.75) + 0.1), (x, 0, (top + LZ + 0.75) / 2), C))
    for k in range(5):
        x = (k - 2) * 2.0
        for y in (-0.38, 0.38):
            o = lib.torus("bezel", 0.66, 0.1, (x, y, LZ), Y, rot=(PI / 2, 0, 0), seg=14, mseg=4)
            parts.append(o)
    root = join("start_arch_v2", parts)
    for k in range(5):
        m = bpy.data.materials.new(f"lamp{k + 1}")
        m.use_nodes = True
        b = m.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = (*lib2.lin("5a1418"), 1)
        b.inputs["Roughness"].default_value = 0.35
        b.inputs["Emission Color"].default_value = (*lib2.lin("ff2a1a"), 1)
        b.inputs["Emission Strength"].default_value = 0.0
        x = (k - 2) * 2.0
        o = cyl(f"LAMP{k + 1}", 0.58, 0.86, (0, 0, 0), m, verts=16, rot=(PI / 2, 0, 0))
        o.location = (x, 0, LZ)
        o.parent = root
    lib2.export(os.path.join(out, "start_arch_v2.glb"), [root])


# ---------------------------------------------------------------- 4. boost pad


@model
def boost_pad_v2(out):
    lib2.reset()
    W, L = 3.6, 5.0
    C, O, Y = M("charcoal"), M("orange"), M("yellow")
    g = glow("glow_boost", "ffb21e", 3.0)
    parts = [rbox("base", (W, L, 0.05), (0, 0, 0.025), C, bevel=0.02)]
    parts.append(rbox("inset", (W - 0.7, L - 0.3, 0.012), (0, 0, 0.051), M("night_body", "3b3170")))
    for s in (-1, 1):
        parts.append(rbox("rail", (0.22, L, 0.1), (s * (W / 2 - 0.11), 0, 0.05), O, bevel=0.04, seg=2))
        for k in range(5):
            parts.append(rbox("stud", (0.2, 0.42, 0.11), (s * (W / 2 - 0.11), -2.0 + k * 1.0, 0.055), Y, bevel=0.04))
    for k in range(3):
        y0 = -2.05 + k * 1.45
        pts = [(-1.25, y0), (0, y0 + 0.9), (1.25, y0), (1.25, y0 + 0.55), (0, y0 + 1.45), (-1.25, y0 + 0.55)]
        parts.append(prism("chev", pts, 0.05, 0.062, g))
    root = join("boost_pad_v2", parts)
    lib2.export(os.path.join(out, "boost_pad_v2.glb"), [root])


# ---------------------------------------------------------------- 5. jump ramp


@model
def jump_ramp(out):
    lib2.reset()
    HW, L, H = 4.0, 7.0, 1.6  # driving surface half-width, length, lip height
    Y, K, P, O, C = M("yellow"), M("charcoal"), M("purple"), M("orange"), M("charcoal")
    G = glow("glow_ramp", "ffd23a", 3.0)
    # driving surface: built flat in (x, s), cut into chevron stripes, then tilted -> one clean plane
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in ((-HW, 0, 0), (HW, 0, 0), (HW, L, 0), (-HW, L, 0))]
    bm.faces.new(vs)

    def cut(co, no, side=None):
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        if side is not None:
            fs = [f for f in bm.faces if (f.calc_center_median().x * side) > 1e-6]
            es = list({e for f in fs for e in f.edges})
            vv = list({v for f in fs for v in f.verts})
            geom = vv + es + fs
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=co, plane_no=no)

    cut((0, 0, 0), (1, 0, 0))
    LIP = L - 0.35
    cut((0, LIP, 0), (0, 1, 0))
    a, P2 = 0.55, 0.62  # arm slope, stripe width
    k = 0
    while k * P2 < L + a * HW:
        c = k * P2
        cut((0, c, 0), (a, 1, 0), side=1)
        cut((0, c, 0), (-a, 1, 0), side=-1)
        k += 1
    for f in bm.faces:
        cx, cs, _ = f.calc_center_median()
        if cs > LIP:
            f.material_index = 2
        else:
            u = cs + a * abs(cx)
            f.material_index = 0 if int(math.floor(u / P2)) % 2 == 0 else 1
    for v in bm.verts:
        x, s, _ = v.co
        v.co = Vector((x, s - L / 2, H * s / L))
    surf = lib2.to_obj("RAMP_SURFACE", bm, [Y, K, G])
    # body: side walls, back, lip glow
    parts = []
    WT = 0.5
    for sx in (-1, 1):
        xw = sx * (HW + WT / 2)
        prof = [(-L / 2, 0), (L / 2, 0), (L / 2, H + 0.45), (-L / 2 + 0.35, 0.3), (-L / 2, 0.18)]
        parts.append(prism("wall", prof, xw - WT / 2, xw + WT / 2, P, axis="x", bevel=0.06))
        top0 = Vector((xw, -L / 2 + 0.3, 0.42))
        top1 = Vector((xw, L / 2 - 0.05, H + 0.58))
        parts.append(beam("wall_cap", top0, top1, WT + 0.12, O, h=0.22, bevel=0.05))
        for k2 in range(3):
            yy = -L / 2 + 1.6 + k2 * 1.9
            zz = H * (yy + L / 2) / L
            parts.append(rbox("wall_bolt", (0.08, 0.5, 0.5), (sx * (HW + WT + 0.02), yy, zz * 0.55), Y, bevel=0.06))
    parts.append(rbox("back", (2 * HW, 0.3, H), (0, L / 2 - 0.15, H / 2), C, bevel=0.03))
    parts.append(rbox("lip_glow", (2 * HW, 0.12, 0.2), (0, L / 2 + 0.04, H - 0.14), G))
    for x in (-2.6, 0, 2.6):
        parts.append(rbox("back_strut", (0.4, 0.2, H - 0.3), (x, L / 2 + 0.06, (H - 0.3) / 2), O, bevel=0.04))
    root = join("jump_ramp", parts)
    lib2.flat_bottom(root, 0.0)
    surf.parent = root
    lib2.export(os.path.join(out, "jump_ramp.glb"), [root])


# ---------------------------------------------------------------- 6. grandstand


def figure(x, y, z, shirt, skin, parts, rnd, scale=1.25):
    s = scale
    prof = [(0, 0), (0.15 * s, 0.02 * s), (0.23 * s, 0.12 * s), (0.22 * s, 0.46 * s), (0.15 * s, 0.6 * s), (0, 0.63 * s)]
    parts.append(lathe("body", prof, shirt, seg=7, loc=(x, y, z), shade="smooth"))
    parts.append(uvs("head", 0.2 * s, (x, y, z + 0.8 * s), skin, seg=8, rings=6))
    if rnd.random() < 0.4:
        side = rnd.choice((-1, 1))
        sh = Vector((x + side * 0.17 * s, y, z + 0.5 * s))
        hand = sh + Vector((side * 0.18 * s, -0.05, 0.42 * s))
        parts.append(sweep("arm", [sh, hand], 0.065 * s, shirt, sides=5, round_end=True, shade="flat"))


@model
def grandstand_v2(out):
    lib2.reset()
    rnd = random.Random(11)
    Cr, Lv, Or, Wh = M("cream"), M("lavender"), M("orange"), M("white")
    shirts = [M("orange"), M("yellow"), M("mint"), M("pink"), M("sky"), M("lavender")]
    L, rows, D, RISE = 24.0, 5, 1.25, 0.6
    parts = []
    y_back = 0.6 + rows * D
    for r in range(rows):
        zt = 0.9 + r * RISE
        y0 = 0.6 + r * D
        parts.append(rbox("step", (L, y_back - y0, zt), (0, (y0 + y_back) / 2, zt / 2), Cr))
        parts.append(rbox("step_edge", (L, 0.08, 0.14), (0, y0 - 0.02, zt - 0.07), Lv))
        parts.append(rbox("bench", (L - 0.6, 0.42, 0.3), (0, y0 + 0.95, zt + 0.15), Lv, bevel=0.05))
        n = 12
        for k in range(n):
            if rnd.random() < 0.08:
                continue
            x = -L / 2 + 1.0 + k * (L - 2.0) / (n - 1) + rnd.uniform(-0.3, 0.3)
            figure(x, y0 + 0.55, zt, rnd.choice(shirts), Cr, parts, rnd)
    ztop = 0.9 + rows * RISE
    parts.append(rbox("back", (L + 0.4, 0.4, ztop + 2.0), (0, y_back + 0.2, (ztop + 2.0) / 2), Lv, bevel=0.06))
    # sloped side walls
    for s in (-1, 1):
        prof = [(0.3, 0.0), (y_back + 0.4, 0.0), (y_back + 0.4, ztop + 2.0), (0.3, 1.25)]
        parts.append(prism("side", prof, s * L / 2 - 0.2, s * L / 2 + 0.2, Or, axis="x", bevel=0.05))
    # front parapet with a lavender / orange banner strip
    parts.append(rbox("parapet", (L + 0.4, 0.3, 1.2), (0, 0.42, 0.6), Cr, bevel=0.05))
    nb = 8
    for k in range(nb):
        x = -L / 2 + L / nb * (k + 0.5)
        parts.append(rbox("banner", (L / nb - 0.14, 0.08, 0.78), (x, 0.24, 0.62), Lv if k % 2 == 0 else Or, bevel=0.03))
        parts.append(lib2.ico("dot", 0.16, (x, 0.18, 0.62), Wh if k % 2 == 0 else M("yellow"), sub=1, scale=(1, 0.4, 1)))
    # curved roof on poles, orange / white awning stripes
    yb, yfront = y_back + 0.4, -1.6
    zb, zf, bulge = ztop + 3.4, ztop + 3.0, 1.1
    N = 10
    top = []
    for i in range(N + 1):
        t = i / N
        y = yb + (yfront - yb) * t
        z = zb + (zf - zb) * t + bulge * math.sin(PI * t)
        top.append((y, z))
    outline = [(y, z) for y, z in top] + [(y, z - 0.25) for y, z in reversed(top)]
    ns = 12
    for k in range(ns):
        x0 = -L / 2 - 0.5 + (L + 1.0) * k / ns
        x1 = -L / 2 - 0.5 + (L + 1.0) * (k + 1) / ns
        parts.append(prism("roof", outline, x0, x1, Or if k % 2 == 0 else Wh, axis="x"))
        # scalloped valance on the front edge
        xm = (x0 + x1) / 2
        rr = (x1 - x0) / 2
        semi = [(xm + rr * math.cos(PI + PI * i / 6), zf - 0.24 + 0.55 * rr * math.sin(PI + PI * i / 6)) for i in range(7)]
        parts.append(prism("valance", semi, yfront - 0.03, yfront + 0.05, Wh if k % 2 == 0 else Or, axis="y"))
    for x in (-L / 2 + 0.4, -L / 6, L / 6, L / 2 - 0.4):
        parts.append(cyl("pole", 0.16, zf - 0.1, (x, yfront + 0.5, (zf - 0.1) / 2), Wh, verts=8))
        parts.append(rbox("pole_foot", (0.6, 0.6, 0.3), (x, yfront + 0.5, 0.15), Or, bevel=0.05))
    root = join("grandstand_v2", parts)
    lib2.export(os.path.join(out, "grandstand_v2.glb"), [root])


# ---------------------------------------------------------------- 7-8. tyres, barrier


@model
def tire_stack(out):
    lib2.reset()
    R = M("rubber", rough=0.9)
    stripes = [M("white"), M("orange"), M("lavender")]
    prof = [(0.24, 0.03), (0.32, 0.0), (0.42, 0.02), (0.46, 0.09), (0.46, 0.21), (0.42, 0.28), (0.37, 0.295), (0.30, 0.295), (0.24, 0.27), (0.21, 0.15), (0.24, 0.03)]
    parts = []
    for k in range(3):
        z = k * 0.3
        dx = (0.03, -0.04, 0.02)[k]
        o = lathe("tyre", prof, [R, stripes[k]], seg=13, loc=(dx, (0.02, -0.02, 0.03)[k], z), rot=(0, 0, k * 0.5), shade=50, matfn=lambda i, j: 1 if j in (5, 6) else 0)
        parts.append(o)
    root = join("tire_stack", parts)
    lib2.export(os.path.join(out, "tire_stack.glb"), [root])


@model
def barrier_block(out):
    lib2.reset()
    red = M("barrier_red", "ff5a3c", rough=0.6)
    wht = M("barrier_white", "f7f5f0", rough=0.6)
    prof = [(-0.33, 0.0), (0.33, 0.0), (0.33, 0.12), (0.21, 0.3), (0.17, 0.8), (0.1, 0.9), (-0.1, 0.9), (-0.17, 0.8), (-0.21, 0.3), (-0.33, 0.12)]
    parts = []
    n = 4
    for k in range(n):
        x0 = -1.0 + 2.0 * k / n
        parts.append(prism("seg", prof, x0, x0 + 2.0 / n, red if k % 2 == 0 else wht, axis="x"))
    parts.append(cyl("cap", 0.07, 0.06, (0.6, 0, 0.92), wht, verts=8))
    for s in (-1, 1):
        parts.append(rbox("lug", (0.08, 0.18, 0.5), (s * 1.02, 0, 0.45), red if s < 0 else wht))
    root = join("barrier_block", parts)
    lib2.export(os.path.join(out, "barrier_block.glb"), [root])


# ---------------------------------------------------------------- 9-11. balloons, clouds


@model
def balloon_cluster(out):
    lib2.reset()
    cols = [M("pink"), M("yellow"), M("sky"), M("mint"), M("orange")]
    S = M("white")
    parts = [rbox("weight", (0.34, 0.34, 0.3), (0, 0, 0.15), M("lavender"), bevel=0.06, seg=2)]
    anchor = Vector((0, 0, 0.3))
    spots = [(-0.55, -0.1, 3.1), (0.5, 0.25, 3.3), (0.05, -0.45, 3.6), (-0.2, 0.55, 3.75), (0.6, -0.4, 2.85)]
    for k, p in enumerate(spots):
        c = Vector(p)
        parts += lib2.balloon("balloon", 0.45, c, cols[k], seg=12)
        knot = c + Vector((0, 0, -0.45 * 1.3))
        mid = anchor.lerp(knot, 0.55) + Vector((0.08 * (k - 2), 0.05, 0))
        parts.append(sweep("string", [anchor, mid, knot], 0.015, S, sides=3, shade="flat"))
    root = join("balloon_cluster", parts)
    lib2.export(os.path.join(out, "balloon_cluster.glb"), [root])


@model
def hot_air_balloon(out):
    lib2.reset()
    Rd, Yl, Sk, Lv = M("red"), M("yellow"), M("sky"), M("lavender")
    Wd, Wk, C = M("wood"), M("wood_dark"), M("charcoal")
    prof = [(0.6, 4.0), (0.9, 4.45), (1.7, 5.3), (2.6, 6.15), (3.2, 7.05), (3.42, 7.75), (3.38, 8.45), (3.05, 9.15), (2.4, 9.75), (1.4, 10.12), (0.0, 10.25)]
    seg = 20

    def gores(i, j):
        if j in (0,):
            return 3
        if j == 5:
            return 2
        return 0 if i % 2 == 0 else 1

    parts = [lathe("envelope", prof, [Rd, Yl, Sk, Lv], seg=seg, shade=60, matfn=gores)]
    parts.append(rbox("basket", (1.3, 1.3, 0.95), (0, 0, 0.475), Wd, bevel=0.1, seg=2))
    parts.append(rbox("basket_rim", (1.44, 1.44, 0.16), (0, 0, 0.98), Wk, bevel=0.05, seg=2))
    parts.append(rbox("basket_band", (1.34, 1.34, 0.12), (0, 0, 0.35), Wk, bevel=0.03))
    parts.append(cyl("burner", 0.26, 0.36, (0, 0, 2.6), C, verts=10))
    parts.append(cyl("flame_cup", 0.18, 0.12, (0, 0, 2.84), M("orange"), verts=10))
    for sx in (-1, 1):
        for sy in (-1, 1):
            c = Vector((sx * 0.62, sy * 0.62, 1.05))
            a = math.atan2(sy, sx)
            top = Vector((0.6 * math.cos(a), 0.6 * math.sin(a), 4.02))
            parts.append(sweep("rope", [c, top], 0.03, Wk, sides=4, shade="flat"))
            parts.append(beam("frame", c + Vector((0, 0, 1.4)), Vector((sx * 0.22, sy * 0.22, 2.55)), 0.05, C))
    root = join("hot_air_balloon", parts)
    lib2.export(os.path.join(out, "hot_air_balloon.glb"), [root])


def cloud(name, blobs, out):
    lib2.reset()
    m = M("cloud", "ffffff", rough=0.95)
    parts = [uvs("puff", r, c, m, seg=12, rings=8, scale=(1, 0.85, 0.9)) for c, r in blobs]
    root = join(name, parts)
    lib2.flat_bottom(root, 0.0)
    lib2.export(os.path.join(out, name + ".glb"), [root])


@model
def cloud_a(out):
    cloud("cloud_a", [((0, 0, 1.6), 3.0), ((-3.3, 0.2, 1.0), 2.3), ((3.4, -0.2, 1.1), 2.4), ((-1.4, 0.4, 3.1), 2.2), ((1.6, -0.1, 2.9), 2.0), ((-5.0, -0.1, 0.6), 1.3), ((5.1, 0.2, 0.6), 1.2)], out)


@model
def cloud_b(out):
    cloud("cloud_b", [((0, 0, 1.4), 2.6), ((-2.8, 0.3, 1.0), 2.2), ((2.5, -0.3, 1.5), 2.6), ((4.7, 0.0, 0.7), 1.6), ((-4.8, 0, 0.6), 1.4), ((0.9, 0.2, 3.0), 1.9)], out)


# ---------------------------------------------------------------- 12-14. podium, trophy, flag post


@model
def podium(out):
    lib2.reset()
    body, base, wht = M("lavender"), M("cream"), M("white")
    medals = {
        1: M("gold", "ffc23a", rough=0.3, metal=1.0),
        2: M("silver", "d3d8e6", rough=0.3, metal=1.0),
        3: M("bronze", "d9874a", rough=0.35, metal=1.0),
    }
    parts = [rbox("plinth", (9.8, 3.2, 0.14), (0, 0, 0.07), base, bevel=0.05)]
    spots = {}
    BW, BD = 3.0, 2.4
    for n, x, h in ((1, 0.0, 1.6), (2, -3.05, 1.1), (3, 3.05, 0.8)):
        m = medals[n]
        parts.append(rbox("block", (BW, BD, h - 0.14 - 0.16), (x, 0, 0.14 + (h - 0.3) / 2), body, bevel=0.1, seg=2))
        parts.append(rbox("trim", (BW + 0.08, BD + 0.08, 0.2), (x, 0, h - 0.1), m, bevel=0.06, seg=2))
        parts.append(rbox("foot_trim", (BW + 0.06, BD + 0.06, 0.1), (x, 0, 0.19), wht, bevel=0.03))
        dh = {1: 0.95, 2: 0.66, 3: 0.46}[n]
        zc = 0.24 + (h - 0.44) / 2
        parts.append(cyl("badge", dh * 0.72, 0.08, (x, -BD / 2 - 0.02, zc), M("purple"), verts=20, rot=(PI / 2, 0, 0)))
        if n == 1:  # the built-in font's "1" is a plain bar: draw a proper one with a flag and a foot
            one = [(-0.3, -0.5), (0.3, -0.5), (0.3, -0.34), (0.11, -0.34), (0.11, 0.5), (-0.06, 0.5), (-0.3, 0.3), (-0.3, 0.12), (-0.09, 0.24), (-0.09, -0.34), (-0.3, -0.34)]
            one = [(u * dh, v * dh) for u, v in one]
            parts.append(prism("digit", one, -0.07, 0.07, m, loc=(x, -BD / 2 - 0.1, zc), rot=(PI / 2, 0, 0)))
        else:
            parts.append(text("digit", str(n), 1.0, 0.14, m, loc=(x, -BD / 2 - 0.1, zc), rot=(PI / 2, 0, 0), offset=0.05, res=3, height=dh))
        spots[n] = (x, 0, h)
    root = join("podium", parts)
    for n, p in spots.items():
        empty(f"SPOT{n}", p, parent=root)
    lib2.export(os.path.join(out, "podium.glb"), [root])


@model
def trophy(out):
    lib2.reset()
    G = M("gold", "ffc23a", rough=0.25, metal=1.0)
    C = M("charcoal")
    parts = [rbox("base", (0.36, 0.36, 0.16), (0, 0, 0.08), C, bevel=0.03, seg=2)]
    parts.append(rbox("base2", (0.27, 0.27, 0.09), (0, 0, 0.205), C, bevel=0.02, seg=2))
    parts.append(rbox("plate", (0.2, 0.02, 0.08), (0, -0.181, 0.08), G, bevel=0.005))
    prof = [(0.1, 0.25), (0.1, 0.27), (0.06, 0.3), (0.035, 0.36), (0.06, 0.39), (0.06, 0.41), (0.035, 0.44), (0.05, 0.47), (0.12, 0.5), (0.19, 0.56), (0.225, 0.64), (0.24, 0.73), (0.25, 0.79), (0.235, 0.8), (0.215, 0.74), (0.18, 0.64), (0.1, 0.58), (0.0, 0.565)]
    parts.append(lathe("cup", prof, G, seg=20, shade=45))
    for s in (-1, 1):
        pts = [(s * 0.215, 0, 0.73), (s * 0.31, 0, 0.74), (s * 0.35, 0, 0.67), (s * 0.31, 0, 0.6), (s * 0.2, 0, 0.56)]
        parts.append(sweep("handle", pts, 0.022, G, sides=6, shade=50))
    # little star on the cup front
    star = []
    for i in range(10):
        a = PI / 2 + i * PI / 5
        r = 0.07 if i % 2 == 0 else 0.03
        star.append((r * math.cos(a), r * math.sin(a)))
    parts.append(prism("star", star, -0.01, 0.01, M("white"), loc=(0, -0.232, 0.66), rot=(PI / 2 + 0.25, 0, 0)))
    root = join("trophy", parts)
    lib2.export(os.path.join(out, "trophy.glb"), [root])


@model
def finish_banner_post(out):
    lib2.reset()
    St, Wh, K, G = M("steel", rough=0.4, metal=0.6), M("white"), M("charcoal"), M("gold", "ffc23a", rough=0.3, metal=1.0)
    H = 6.0
    parts = [cyl("base", 0.32, 0.22, (0, 0, 0.11), K, verts=10), cyl("collar", 0.14, 0.4, (0, 0, 0.4), K, verts=8)]
    parts.append(cyl("pole", 0.07, H, (0, 0, H / 2), St, verts=8))
    parts.append(uvs("ball", 0.15, (0, 0, H + 0.12), G, seg=10, rings=6))
    # waving chequered flag: 6 × 4 squares, each split into 2 columns for the wave
    cols, rows, sq = 6, 4, 0.32
    sub = 2
    bm = bmesh.new()
    grid = {}
    for i in range(cols * sub + 1):
        x = 0.07 + i * sq / sub
        wave = 0.13 * math.sin(i / sub * 1.2) * (i / (cols * sub))
        for j in range(rows + 1):
            z = H - 0.1 - rows * sq + j * sq - 0.05 * (i / (cols * sub)) ** 1.5
            grid[i, j] = bm.verts.new((x, wave, z))
    for i in range(cols * sub):
        for j in range(rows):
            f = bm.faces.new((grid[i, j], grid[i + 1, j], grid[i + 1, j + 1], grid[i, j + 1]))
            f.material_index = ((i // sub) + j) % 2
    parts.append(lib2.to_obj("flag", bm, [Wh, K], "smooth"))
    root = join("finish_banner_post", parts)
    lib2.export(os.path.join(out, "finish_banner_post.glb"), [root])


def main():
    a = lib.args()
    out = a[0] if a else "blender/out2"
    names = a[1:] or list(MODELS)
    for n in names:
        MODELS[n](out)


main()

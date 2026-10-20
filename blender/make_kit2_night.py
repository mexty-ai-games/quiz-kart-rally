"""Kit 2 — Night theme (moonlight, neon; a Sonic-style night stage): street lamp, neon ring arches,
glowing crystals, city blocks with lit windows.

  python3 blender/make_kit2_night.py -- blender/out2 [model ...]

Blender axes while building: Z up, -Y = towards the incoming karts (= +Z in glTF).
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402,F401
from mathutils import Vector  # noqa: E402

import lib2  # noqa: E402
from lib2 import M, beam, cyl, glow, ico, join, lathe, quad, rbox, sweep, uvs  # noqa: E402

PI = math.pi
MODELS = {}


def model(fn):
    MODELS[fn.__name__] = fn
    return fn


@model
def lamp_post(out):
    """Street lamp, 6 m. The arm reaches towards +X (glTF +X)."""
    lib2.reset()
    C, T = M("charcoal"), M("night_trim")
    L = glow("glow_lamp", "ffd27a", 4.0)
    parts = [rbox("base", (0.6, 0.6, 0.5), (0, 0, 0.25), C, bevel=0.08, seg=2)]
    parts.append(cyl("collar", 0.2, 0.5, (0, 0, 0.7), T, verts=8))
    parts.append(cyl("pole", 0.11, 5.2, (0, 0, 3.2), C, verts=8, r2=0.08))
    parts.append(cyl("ring", 0.16, 0.15, (0, 0, 2.6), T, verts=8))
    arm = [(0, 0, 5.6), (0.15, 0, 5.95), (0.55, 0, 6.1), (1.1, 0, 6.05), (1.45, 0, 5.92)]
    parts.append(sweep("arm", arm, 0.07, C, sides=6, shade=45))
    parts.append(uvs("cap", 0.14, (0, 0, 5.62), T, seg=8, rings=5))
    head = Vector((1.5, 0, 5.82))
    parts.append(lathe("hood", [(0.0, 0.32), (0.22, 0.28), (0.42, 0.06), (0.46, 0.0), (0.34, 0.0)], C, seg=10, loc=head, shade=40))
    parts.append(uvs("bulb", 0.26, head + Vector((0, 0, -0.04)), L, seg=10, rings=6, scale=(1, 1, 0.75)))
    root = join("lamp_post", parts)
    lib2.export(os.path.join(out, "lamp_post.glb"), [root])


def neon_ring(name, col, out):
    """Ring arch over the road: centreline radius 14.6 m (inner neon at ~14 m), centre 3 m above ground,
    clipped 1 m under ground. Inner neon at ~13.7 m; clear width at road level ~26.6 m."""
    lib2.reset()
    body, trim = M("night_body"), M("night_trim")
    neon = glow(name.replace("neon_ring_", "glow_neon_"), col, 3.5)
    R, HC = 14.6, 3.0
    th0 = math.asin((-1.0 - HC) / (R + 0.85))
    N = 48
    arc = lambda rad, y=0.0: [(rad * math.cos(th0 + (PI - 2 * th0) * i / N), y, HC + rad * math.sin(th0 + (PI - 2 * th0) * i / N)) for i in range(N + 1)]
    prof = [(1, 0.5), (0.75, 1), (-0.75, 1), (-1, 0.5), (-1, -0.5), (-0.75, -1), (0.75, -1), (1, -0.5)]
    parts = [sweep("ring", arc(R), (1.25, 0.85), [body, trim], profile=prof, up=(0, 1, 0), shade=35, matfn=lambda i, s: 1 if (i % 7 == 3 and i >= 0) else 0)]
    parts.append(sweep("neon_in", arc(R - 0.88), 0.3, neon, sides=8, shade="smooth"))
    for y in (-1.28, 1.28):
        parts.append(sweep("neon_face", arc(R + 0.4, y), 0.12, neon, sides=4, shade="smooth"))
    xg = math.sqrt(R * R - HC * HC)
    for s in (-1, 1):
        parts.append(rbox("foot", (3.6, 3.4, 0.9), (s * xg, 0, 0.45), body, bevel=0.15, seg=2))
        parts.append(rbox("foot_glow", (3.7, 3.5, 0.14), (s * xg, 0, 0.75), neon, bevel=0.04))
        parts.append(rbox("foot_trim", (3.8, 3.6, 0.2), (s * xg, 0, 0.1), trim, bevel=0.05))
    root = join(name, parts)
    lib2.export(os.path.join(out, name + ".glb"), [root])


@model
def neon_ring_pink(out):
    neon_ring("neon_ring_pink", "ff4fa8", out)


@model
def neon_ring_cyan(out):
    neon_ring("neon_ring_cyan", "38e8ff", out)


@model
def crystal_cluster(out):
    lib2.reset()
    rock = M("night_navy")
    cy = glow("glow_crystal", "3fe6ff", 2.2)
    vi = glow("glow_crystal_violet", "b47cff", 2.2)
    parts = [ico("base", 1.0, (0, 0, 0.25), rock, sub=3, scale=(1.3, 1.1, 0.55), jitter=0.15, seed=3)]
    rnd = random.Random(5)
    shards = [(0, 0, 2.4, 0.32, 0, 0), (0.55, 0.2, 1.6, 0.26, 0.35, 0.2), (-0.6, -0.1, 1.8, 0.28, -0.4, 0.1), (0.2, -0.55, 1.2, 0.2, 0.15, -0.45), (-0.3, 0.55, 1.4, 0.22, -0.2, 0.45), (0.85, -0.35, 0.9, 0.17, 0.6, -0.3), (-0.85, 0.4, 0.8, 0.16, -0.6, 0.35)]
    for k, (x, y, h, r, tx, ty) in enumerate(shards):
        prof = [(r * 0.9, -0.4), (r, h * 0.78), (0.0, h)]
        parts.append(lathe("shard", prof, cy if k % 3 != 1 else vi, seg=6, loc=(x, y, 0.3), rot=(ty, tx, rnd.uniform(0, 1)), shade="flat"))
    root = join("crystal_cluster", parts)
    lib2.flat_bottom(root, 0.0)
    lib2.export(os.path.join(out, "crystal_cluster.glb"), [root])


def windows(parts, cx, cy, w, d, z0, z1, floor_h, cols_x, cols_y, lit, dark, rnd, p_dark=0.22, ww=1.2, wh=1.25):
    """Window quads on the 4 faces of a box (centre cx, cy; size w × d) between heights z0..z1."""
    nf = int((z1 - z0) // floor_h)
    for f in range(nf):
        z = z0 + floor_h * (f + 0.55)
        for face, (nx, ny) in enumerate(((0, -1), (1, 0), (0, 1), (-1, 0))):
            span = w if ny else d
            n = cols_x if ny else cols_y
            for c in range(n):
                u = -span / 2 + span * (c + 0.5) / n
                if ny:
                    p = (cx + u, cy + ny * (d / 2 + 0.03), z)
                    rot = (PI / 2, 0, 0) if ny < 0 else (PI / 2, 0, PI)
                else:
                    p = (cx + nx * (w / 2 + 0.03), cy + u, z)
                    rot = (PI / 2, 0, -PI / 2) if nx < 0 else (PI / 2, 0, PI / 2)
                m = dark if rnd.random() < p_dark else lit
                parts.append(quad("win", ww, wh, p, m, rot=rot))


def antenna(parts, x, y, z, h, m, tip):
    parts.append(cyl("mast", 0.09, h, (x, y, z + h / 2), m, verts=6, r2=0.05))
    for k in range(3):
        parts.append(beam("spoke", (x - 0.6 + k * 0.15, y, z + h * (0.45 + 0.15 * k)), (x + 0.6 - k * 0.15, y, z + h * (0.45 + 0.15 * k)), 0.06, m))
    parts.append(uvs("beacon", 0.18, (x, y, z + h + 0.1), tip, seg=8, rings=5))


def water_tank(parts, x, y, z, wood, dark):
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(beam("leg", (x + sx * 0.9, y + sy * 0.9, z), (x + sx * 0.75, y + sy * 0.75, z + 1.6), 0.14, dark))
    parts.append(cyl("tank", 1.25, 2.0, (x, y, z + 2.6), wood, verts=12))
    parts.append(lathe("tank_roof", [(1.4, z + 3.6), (0.0, z + 4.4)], dark, seg=12, cap_bottom=True, shade="flat"))
    for dz in (2.0, 3.2):
        parts.append(cyl("hoop", 1.28, 0.1, (x, y, z + dz), dark, verts=12))


@model
def building_a(out):
    """Tall slab with a setback crown and an antenna, ~33 m."""
    lib2.reset()
    rnd = random.Random(1)
    B, T, C = M("night_body"), M("night_trim"), M("charcoal")
    lit, dark = glow("glow_window", "ffd98a", 2.2), M("window_dark")
    parts = [rbox("body", (10, 10, 25), (0, 0, 12.5), B, bevel=0.2)]
    parts.append(rbox("plinth", (10.8, 10.8, 3.0), (0, 0, 1.5), T, bevel=0.15))
    parts.append(rbox("crown", (7.5, 7.5, 4.5), (0, 0, 27.25), B, bevel=0.15))
    for z in (25.15, 29.6):
        parts.append(rbox("cornice", (10.5 if z < 26 else 8.0, 10.5 if z < 26 else 8.0, 0.35), (0, 0, z), T, bevel=0.06))
    windows(parts, 0, 0, 10, 10, 3.2, 24.6, 2.6, 3, 3, lit, dark, rnd)
    windows(parts, 0, 0, 7.5, 7.5, 25.4, 29.4, 2.0, 2, 2, lit, dark, rnd, p_dark=0.4, ww=1.4, wh=1.0)
    parts.append(rbox("door", (2.4, 0.2, 2.2), (0, -5.45, 1.1), lit))
    antenna(parts, 1.5, 1.0, 29.8, 4.5, C, glow("glow_beacon", "ff3a5a", 3.0))
    parts.append(rbox("ac", (1.4, 1.0, 0.8), (-2.0, -1.5, 30.2), C, bevel=0.08))
    root = join("building_a", parts)
    lib2.export(os.path.join(out, "building_a.glb"), [root])


@model
def building_b(out):
    """Wide mid-rise with a rooftop water tank and a pink neon sign band, ~17 m."""
    lib2.reset()
    rnd = random.Random(2)
    B, T, C, Wd = M("night_navy"), M("night_trim"), M("charcoal"), M("wood")
    lit, dark = glow("glow_window", "ffd98a", 2.2), M("window_dark")
    neon = glow("glow_neon_pink", "ff4fa8", 3.0)
    parts = [rbox("body", (16, 10, 15), (0, 0, 7.5), B, bevel=0.2)]
    parts.append(rbox("parapet", (16.4, 10.4, 0.8), (0, 0, 15.2), T, bevel=0.08))
    parts.append(rbox("shop", (16.3, 10.3, 3.0), (0, 0, 1.5), C, bevel=0.1))
    windows(parts, 0, 0, 16, 10, 3.6, 14.6, 2.75, 5, 3, lit, dark, rnd, p_dark=0.25, ww=1.6)
    for x in (-5, 0, 5):
        parts.append(rbox("shopfront", (3.6, 0.2, 2.0), (x, -5.2, 1.3), lit))
    parts.append(rbox("sign_band", (12.0, 0.3, 0.32), (0, -5.25, 3.3), neon, bevel=0.06))
    parts.append(rbox("sign_band2", (12.0, 0.3, 0.32), (0, 5.25, 3.3), neon, bevel=0.06))
    water_tank(parts, 4.5, 1.5, 15.6, Wd, C)
    parts.append(rbox("stair_hut", (3.0, 3.0, 2.4), (-4.5, 1.5, 16.8), B, bevel=0.1))
    root = join("building_b", parts)
    lib2.export(os.path.join(out, "building_b.glb"), [root])


@model
def building_c(out):
    """Stepped tower with cyan neon edges and a pointed top, ~35 m."""
    lib2.reset()
    rnd = random.Random(3)
    B, T, C = M("night_teal"), M("night_trim"), M("charcoal")
    lit, dark = glow("glow_window", "ffd98a", 2.2), M("window_dark")
    neon = glow("glow_neon_cyan", "38e8ff", 3.0)
    tiers = [(12, 0, 14), (9, 14, 24), (6, 24, 31)]
    parts = []
    for w, z0, z1 in tiers:
        parts.append(rbox("tier", (w, w, z1 - z0), (0, 0, (z0 + z1) / 2), B, bevel=0.15))
        parts.append(rbox("ledge", (w + 0.6, w + 0.6, 0.4), (0, 0, z1), T, bevel=0.06))
        for sx in (-1, 1):
            for sy in (-1, 1):
                parts.append(rbox("edge_neon", (0.18, 0.18, z1 - z0 - 0.6), (sx * (w / 2 + 0.04), sy * (w / 2 + 0.04), (z0 + z1) / 2), neon))
        windows(parts, 0, 0, w, w, z0 + 0.8, z1 - 0.4, 2.4, max(2, int(w / 3.2)), max(2, int(w / 3.2)), lit, dark, rnd, p_dark=0.2, ww=1.1, wh=1.2)
    parts.append(lathe("spire", [(3.2, 31.2), (0.0, 35.0)], T, seg=4, a0=PI / 4, cap_bottom=True, shade="flat"))
    parts.append(cyl("spike", 0.1, 2.2, (0, 0, 36.0), C, verts=6, r2=0.03))
    parts.append(uvs("tip", 0.16, (0, 0, 37.1), neon, seg=8, rings=5))
    root = join("building_c", parts)
    lib2.export(os.path.join(out, "building_c.glb"), [root])


lib2.run(MODELS)

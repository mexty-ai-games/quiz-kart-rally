"""Kit 2 — Hills theme (morning): stylised pines, low-poly rocks, a cottage.

  python3 blender/make_kit2_hills.py -- blender/out2 [model ...]

Blender axes while building: Z up, -Y = towards the road / incoming karts (= +Z in glTF).
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402,F401
from mathutils import Vector  # noqa: E402

import lib2  # noqa: E402
from lib2 import M, beam, cyl, ico, join, lathe, prism, rbox  # noqa: E402

PI = math.pi
MODELS = {}


def model(fn):
    MODELS[fn.__name__] = fn
    return fn


def pine(name, tiers, trunk_h, mats, trunk_m, seg=9, seed=0, out=None):
    """tiers: [(z_base, radius, height), ...] bottom -> top. Each tier is a drooping cone."""
    lib2.reset()
    mats, trunk_m = [M(m) for m in mats], M(trunk_m)
    rnd = random.Random(seed)
    parts = [lathe("trunk", [(0.48, 0), (0.34, 0.3), (0.26, trunk_h)], trunk_m, seg=6, shade="flat", cap_top=True)]
    for k, (z, r, h) in enumerate(tiers):
        prof = [(r * 0.3, z + 0.35), (r, z), (r * 0.62, z + h * 0.45), (0.0, z + h)]
        parts.append(lathe("tier", prof, mats[k % len(mats)], seg=seg, shade="flat", a0=rnd.uniform(0, 1)))
    root = join(name, parts)
    lib2.export(os.path.join(out, name + ".glb"), [root])


@model
def pine_a(out):
    pine("pine_a", [(2.0, 2.3, 3.2), (3.8, 1.85, 2.9), (5.4, 1.4, 2.6), (6.9, 0.95, 2.4)], 2.6, ["pine", "pine_dark"], "wood_dark", seed=1, out=out)


@model
def pine_b(out):
    pine("pine_b", [(2.4, 2.7, 3.6), (4.5, 2.2, 3.3), (6.4, 1.7, 3.0), (8.2, 1.2, 2.7), (9.8, 0.75, 2.3)], 3.0, ["pine_dark", "pine"], "wood_dark", seed=2, out=out)


@model
def pine_c(out):
    pine("pine_c", [(1.7, 2.2, 2.4), (3.3, 1.75, 2.3), (4.8, 1.25, 2.2), (6.1, 0.75, 1.9)], 2.2, ["green_dark", "pine"], "wood", seg=7, seed=3, out=out)


def rock(name, blobs, mats, out, moss=None):
    lib2.reset()
    mats = [M(m) for m in mats]
    moss = M(moss) if moss else None
    parts = []
    for k, (c, r, sc, seed) in enumerate(blobs):
        parts.append(ico("rock", r, c, mats[k % len(mats)], sub=3 if k == 0 else 2, scale=sc, jitter=0.16, seed=seed, rot=(0, 0, seed * 0.7)))
    root = join(name, parts)
    lib2.flat_bottom(root, 0.0)
    if moss is not None:
        mi = len(root.data.materials)
        root.data.materials.append(moss)
        for p in root.data.polygons:
            if p.normal.z > 0.8 and p.center.z > 0.6 * max(v.co.z for v in root.data.vertices):
                p.material_index = mi
    lib2.export(os.path.join(out, name + ".glb"), [root])


@model
def rock_a(out):
    rock("rock_a", [((0, 0, 0.55), 1.0, (1.25, 1.0, 0.85), 4)], ["rock"], out)


@model
def rock_b(out):
    rock("rock_b", [((0, 0, 1.2), 1.9, (1.1, 0.95, 0.8), 8), ((1.7, -0.6, 0.45), 0.8, (1, 1, 0.8), 9)], ["rock", "rock_dark"], out, moss="green")


@model
def rock_c(out):
    rock("rock_c", [((0, 0, 0.6), 1.2, (0.8, 0.8, 1.5), 12), ((0.95, 0.3, 0.35), 0.6, (1, 1, 0.9), 13), ((-0.8, -0.4, 0.3), 0.5, (1, 1, 0.8), 14)], ["rock_dark", "rock", "rock"], out)


@model
def cottage(out):
    lib2.reset()
    Cr, Rf, Wk, Wd, St, Sk, Wh, Pk = M("cream"), M("desert_red"), M("wood_dark"), M("wood"), M("rock"), M("sky"), M("white"), M("pink")
    W2, D2, HW = 2.4, 2.0, 2.7  # half width, half depth, wall height
    parts = [prism("walls", [(-W2, 0), (W2, 0), (W2, HW), (0, HW + 2.2), (-W2, HW)], -D2, D2, Cr, axis="y")]
    parts.append(rbox("base", (2 * W2 + 0.3, 2 * D2 + 0.3, 0.4), (0, 0, 0.2), St, bevel=0.06))
    # steep roof, two slabs overhanging the walls
    a = math.atan2(2.2, W2)
    L = math.hypot(W2, 2.2) + 0.55
    for s in (-1, 1):
        cx = s * (W2 / 2 + 0.12)
        parts.append(rbox("roof", (L, 2 * D2 + 0.7, 0.3), (cx, 0, HW + 1.1 + 0.2), Rf, bevel=0.05, rot=(0, s * a, 0)))
    parts.append(beam("ridge", (0, -D2 - 0.4, HW + 2.42), (0, D2 + 0.4, HW + 2.42), 0.3, Wk))
    # timber frame on the front
    yf = -D2 - 0.04
    for x in (-W2 + 0.08, W2 - 0.08):
        parts.append(rbox("post", (0.18, 0.1, HW), (x, yf, HW / 2), Wk))
    parts.append(rbox("beam", (2 * W2, 0.1, 0.18), (0, yf, HW - 0.05), Wk))
    # door, windows with flower box
    parts.append(rbox("door", (1.0, 0.14, 1.8), (-0.9, yf, 1.25), Wd, bevel=0.04))
    parts.append(rbox("knob", (0.1, 0.1, 0.1), (-0.6, yf - 0.1, 1.2), Wh))
    parts.append(rbox("win_frame", (1.15, 0.1, 1.0), (1.05, yf, 1.6), Wh))
    parts.append(rbox("win", (0.9, 0.14, 0.78), (1.05, yf, 1.6), Sk))
    parts.append(rbox("win_bar", (0.08, 0.16, 0.8), (1.05, yf, 1.6), Wh))
    parts.append(rbox("flower_box", (1.2, 0.3, 0.22), (1.05, yf - 0.12, 1.0), Wd))
    for k in range(5):
        parts.append(ico("bloom", 0.09, (0.65 + k * 0.2, yf - 0.14, 1.17), Pk if k % 2 == 0 else Wh, sub=1))
    parts.append(rbox("gable_win", (0.7, 0.14, 0.7), (0, yf, HW + 0.75), Sk, rot=(0, PI / 4, 0)))
    parts.append(rbox("gable_frame", (0.86, 0.1, 0.86), (0, yf + 0.03, HW + 0.75), Wh, rot=(0, PI / 4, 0)))
    for s in (-1, 1):
        parts.append(rbox("side_win", (0.14, 0.9, 0.8), (s * (W2 + 0.04), 0.3, 1.6), Sk))
        parts.append(rbox("side_frame", (0.1, 1.1, 1.0), (s * (W2 + 0.02), 0.3, 1.6), Wh))
    # chimney
    parts.append(rbox("chimney", (0.7, 0.7, 2.6), (1.35, 0.7, HW + 1.6), St, bevel=0.05))
    parts.append(rbox("chimney_cap", (0.9, 0.9, 0.22), (1.35, 0.7, HW + 2.95), Wk, bevel=0.04))
    root = join("cottage", parts)
    lib2.export(os.path.join(out, "cottage.glb"), [root])


lib2.run(MODELS)

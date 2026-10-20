"""
Builds the track furniture Kenney does not provide, procedurally, in the Kenney palette.
All models are in metres, origin at ground level. Facing convention (glTF / three.js axes):
  -Z = the direction of travel, +Z = towards the karts coming in.

  question_gantry  the bridge over each answer row; mesh SCREEN (faces +Z) shows the question
  start_arch       start/finish arch with five countdown lamps (materials lamp1..lamp5)
  boost_pad        turbo pad, chevrons point to -Z (glowing material boost_glow)
  tire_wall        4 m barrier segment of stacked tyres, along X
  grandstand       24 m stand facing +Z with a coloured crowd
  flag             6 m pole with a pennant

  python3 blender/make_props.py -- blender/out
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402

import lib  # noqa: E402
from lib import box, cyl, mat, plane, poly_prism, torus  # noqa: E402

# Blender axes: Z up, -Y here becomes +Z in glTF (towards the incoming karts).
HALF_SPAN = 11.5  # posts stand just outside the 20 m road + verge


def striped_post(name, x, height, parent_objs):
    """A square post in purple with orange bands."""
    parts = [box(f"{name}_core", (0.7, 0.7, height), (x, 0, height / 2), mat("purple"), bevel=0.06)]
    for k in range(3):
        z = 1.2 + k * (height - 2.4) / 2
        parts.append(box(f"{name}_band{k}", (0.78, 0.78, 0.35), (x, 0, z), mat("orange"), bevel=0.03))
    parts.append(box(f"{name}_foot", (1.2, 1.2, 0.3), (x, 0, 0.15), mat("charcoal"), bevel=0.05))
    parent_objs.extend(parts)


def question_gantry(out):
    lib.reset()
    parts = []
    H = 9.4
    for side in (-1, 1):
        striped_post(f"post{side}", side * HALF_SPAN, H, parts)
    # truss beam
    parts.append(box("beam", (2 * HALF_SPAN + 1.2, 0.9, 0.9), (0, 0, H - 0.45), mat("lavender"), bevel=0.08))
    parts.append(box("beam_under", (2 * HALF_SPAN + 0.4, 0.6, 0.25), (0, 0, H - 1.0), mat("orange")))
    # the screen housing hangs from the beam
    W, SH = 10.0, 3.1
    zc = H - 1.15 - SH / 2 - 0.3
    parts.append(box("housing", (W + 0.7, 0.55, SH + 0.7), (0, 0.15, zc), mat("charcoal"), bevel=0.12))
    for x in (-W / 3, W / 3):
        parts.append(box(f"hanger{x:.0f}", (0.18, 0.18, 0.9), (x, 0.15, H - 1.05), mat("steel")))
    # little lamps along the beam
    for k in range(-4, 5):
        parts.append(cyl(f"lamp{k}", 0.18, 0.12, (k * 2.3, -0.48, H - 0.45), mat("yellow", emission=2.5), verts=10, rot=(math.pi / 2, 0, 0)))
    lib.join("question_gantry", parts)
    # the screen itself stays a separate mesh named SCREEN (the game draws the question on it)
    plane("SCREEN", W, SH, (0, -0.14, zc), mat("screen", emission=0.2), rot=(math.pi / 2, 0, 0))
    lib.export(os.path.join(out, "question_gantry.glb"))


def start_arch(out):
    lib.reset()
    parts = []
    H = 10.0
    for side in (-1, 1):
        striped_post(f"post{side}", side * HALF_SPAN, H, parts)
    parts.append(box("beam", (2 * HALF_SPAN + 1.6, 1.4, 2.6), (0, 0, H - 1.0), mat("purple"), bevel=0.12))
    # chequered band on both faces
    n = 22
    w = (2 * HALF_SPAN) / n
    for i in range(n):
        for r in range(2):
            c = mat("white") if (i + r) % 2 == 0 else mat("charcoal")
            for face in (-1, 1):
                parts.append(box(f"chk{i}_{r}_{face}", (w, 0.06, 0.55), (-HALF_SPAN + w * (i + 0.5), face * 0.72, H - 0.55 - r * 0.55), c))
    lib.join("start_arch", parts)
    # countdown lamps: separate materials so the game can light them one by one
    for k in range(5):
        m = bpy.data.materials.new(f"lamp{k + 1}")
        m.use_nodes = True
        b = m.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = (0.25, 0.05, 0.06, 1)
        b.inputs["Emission Color"].default_value = (1, 0.15, 0.1, 1)
        b.inputs["Emission Strength"].default_value = 0.0
        x = (k - 2) * 1.6
        o = cyl(f"LAMP{k + 1}", 0.55, 0.25, (x, -0.78, H - 2.75), m, verts=16, rot=(math.pi / 2, 0, 0))
        o.data.materials.clear()
        o.data.materials.append(m)
    box("lamp_bar", (8.6, 0.4, 1.5), (0, -0.5, H - 2.75), mat("charcoal"), bevel=0.1)
    lib.export(os.path.join(out, "start_arch.glb"))


def boost_pad(out):
    lib.reset()
    L, W = 6.0, 4.2
    base = box("pad_base", (W, L, 0.06), (0, 0, 0.03), mat("charcoal"), bevel=0.02)
    rim = []
    for side in (-1, 1):
        rim.append(box(f"rim{side}", (0.18, L, 0.08), (side * (W / 2 - 0.09), 0, 0.04), mat("orange")))
    lib.join("boost_pad", [base] + rim)
    glow = mat("orange", emission=3.0)
    glow.name = "boost_glow"
    chev = []
    for k in range(3):
        y0 = -1.9 + k * 1.7
        # a chevron pointing to +Y in Blender (= -Z in glTF, the direction of travel)
        pts = [(-1.5, y0), (0, y0 + 1.0), (1.5, y0), (1.5, y0 + 0.55), (0, y0 + 1.55), (-1.5, y0 + 0.55)]
        chev.append(poly_prism(f"chev{k}", pts, 0.06, 0.09, glow))
    lib.join("boost_chevrons", chev)
    lib.export(os.path.join(out, "boost_pad.glb"))


def tire_wall(out):
    lib.reset()
    parts = []
    bands = [mat("white"), mat("orange"), mat("lavender")]
    for i in range(5):
        x = -1.6 + i * 0.8
        for lvl in range(2):
            z = 0.17 + lvl * 0.34
            parts.append(torus(f"tyre{i}_{lvl}", 0.36, 0.17, (x, 0, z), mat("rubber"), seg=12, mseg=6))
            parts.append(cyl(f"band{i}_{lvl}", 0.39, 0.08, (x, 0, z), bands[(i + lvl) % 3], verts=12))
    lib.join("tire_wall", parts)
    lib.export(os.path.join(out, "tire_wall.glb"))


def grandstand(out):
    lib.reset()
    random.seed(7)
    parts = []
    L, rows = 24.0, 5
    crowd = [mat("red"), mat("teal"), mat("yellow"), mat("orange"), mat("lavender"), mat("white")]
    for r in range(rows):
        depth = 1.3
        y = 1.0 + r * depth  # rows step back (+Y in Blender = away from the track)
        z = 0.5 + r * 0.75
        parts.append(box(f"step{r}", (L, depth, z * 2), (0, y, z), mat("cream")))
        parts.append(box(f"seat{r}", (L - 0.4, 0.5, 0.25), (0, y - 0.25, z * 2 + 0.12), mat("purple")))
        for k in range(16):
            if random.random() < 0.25:
                continue
            x = -L / 2 + 1.0 + k * (L - 2.0) / 15 + random.uniform(-0.2, 0.2)
            c = random.choice(crowd)
            parts.append(box(f"fan{r}_{k}_b", (0.5, 0.35, 0.6), (x, y - 0.2, z * 2 + 0.55), c))
            parts.append(box(f"fan{r}_{k}_h", (0.3, 0.3, 0.3), (x, y - 0.2, z * 2 + 1.02), mat("cream")))
    back_y = 1.0 + rows * 1.3
    parts.append(box("back", (L, 0.4, 7.5), (0, back_y, 3.75), mat("purple")))
    for x in (-L / 2 + 0.3, 0, L / 2 - 0.3):
        parts.append(box(f"pillar{x:.0f}", (0.35, 0.35, 8.6), (x, 0.4, 4.3), mat("steel")))
    parts.append(box("roof", (L + 1.0, back_y + 1.2, 0.3), (0, back_y / 2, 8.75), mat("orange"), bevel=0.05))
    parts.append(box("front", (L, 0.25, 1.1), (0, 0.15, 0.55), mat("orange")))
    lib.join("grandstand", parts)
    # front of the stand (where fans look) is -Y in Blender = +Z in glTF
    lib.export(os.path.join(out, "grandstand.glb"))


def flag(out):
    lib.reset()
    parts = [cyl("pole", 0.07, 6.0, (0, 0, 3.0), mat("steel"), verts=8), cyl("cap", 0.14, 0.2, (0, 0, 6.05), mat("orange"), verts=8)]
    parts.append(poly_prism("pennant", [(0, -0.03), (2.2, -0.03), (0, 0.03)], 4.6, 5.8, mat("purple")))
    # the pennant is a thin wedge standing in the XZ plane
    lib.join("flag", parts)
    lib.export(os.path.join(out, "flag.glb"))


def main():
    a = lib.args()
    out = a[0] if a else "blender/out"
    for fn in (question_gantry, start_arch, boost_pad, tire_wall, grandstand, flag):
        fn(out)
        print(f"    {fn.__name__}: {lib.tri_count()} tris")


main()

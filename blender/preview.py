"""Renders every GLB in a folder side by side into one preview image (Cycles, CPU).

  python3 blender/preview.py -- blender/out docs/kit-preview.png
"""
import glob
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import lib  # noqa: E402

LAYOUT = [
    # (file, x, y, rot_z)
    ("start_arch", 0, 18, 0),
    ("question_gantry", 0, 0, 0),
    ("grandstand", 0, 34, math.pi),
    ("boost_pad", -4, -8, 0),
    ("tire_wall", 14, -6, 0),
    ("tire_wall", 14, -2, 0),
    ("flag", 16, 6, 0),
    ("kart_oobi", -6, -1, 0.3),
    ("kart_oodi", -3, -2, 0.1),
    ("kart_ooli", 0, -3, 0),
    ("kart_oopi", 3, -2, -0.1),
    ("kart_oozi", 6, -1, -0.3),
    ("item_box", -3, 4, 0.5),
    ("item_box", 0, 4, 0.5),
    ("item_box", 3, 4, 0.5),
    ("coin", -6, 7, 0),
    ("banana", 6, 7, 0),
    ("cone", 9, 3, 0),
    ("tree", -16, 8, 0),
    ("tree_pine", -18, 14, 0),
    ("smoke", -9, -6, 0),
    ("debris_tire", 9, -5, 0),
]


def main():
    a = lib.args()
    src = a[0] if a else "blender/out"
    dst = a[1] if len(a) > 1 else "docs/kit-preview.png"
    lib.reset()
    sc = bpy.context.scene
    for name, x, y, rz in LAYOUT:
        p = os.path.join(src, name + ".glb")
        if not os.path.exists(p):
            continue
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=p)
        roots = [o for o in set(bpy.data.objects) - before if o.parent is None]
        for o in roots:
            o.location = Vector((x, y, 0)) + o.location
            o.rotation_euler.z += rz
    bpy.ops.mesh.primitive_plane_add(size=120, location=(0, 10, 0))
    g = bpy.context.active_object
    g.data.materials.append(lib.mat("ground", (0.45, 0.62, 0.36)))
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0.01))
    r = bpy.context.active_object
    r.scale = (20, 60, 1)
    r.data.materials.append(lib.mat("road", (0.32, 0.31, 0.38)))
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 4
    so = bpy.data.objects.new("sun", sun)
    so.rotation_euler = (math.radians(50), math.radians(10), math.radians(30))
    sc.collection.objects.link(so)
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.65, 0.78, 1.0, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    sc.world = w
    cam = bpy.data.cameras.new("cam")
    cam.lens = 30
    co = bpy.data.objects.new("cam", cam)
    co.location = (26, -30, 18)
    sc.collection.objects.link(co)
    tgt = bpy.data.objects.new("tgt", None)
    tgt.location = (0, 8, 2)
    sc.collection.objects.link(tgt)
    c = co.constraints.new("TRACK_TO")
    c.target = tgt
    sc.camera = co
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 24
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 1280, 720
    sc.render.filepath = os.path.abspath(dst)
    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    bpy.ops.render.render(write_still=True)
    print("rendered", dst)


main()

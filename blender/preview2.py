"""Preview sheets for kit 2 (Cycles CPU). Modelled on preview.py.

  python3 blender/preview2.py -- blender/out2 track docs/kit2-preview-track.png
  python3 blender/preview2.py -- blender/out2 meadow,hills,desert,night docs/kit2-preview-themes.png
  (optional 4th/5th args: samples, resolution percentage)

Several sheets in one call are rendered at half size each and tiled 2 × 2 into the output.
Layout coordinates are Blender axes (Z up, the road runs along +Y, model fronts face -Y).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import lib  # noqa: E402
import lib2  # noqa: E402

V1 = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
H = math.pi / 2

SHEETS = {
    "track": dict(
        ground="7cc95a", road=(26, 120, 0, 20), sky="a9dcff", sky_strength=1.0, sun=4.2, sun_rot=(48, 8, 35),
        cam=((25, -24, 15.5), (0, 15, 3.5), 26),
        items=[
            ("start_arch_v2", 0, 32, 0, 0),
            ("gantry_v2", 0, 10, 0, 0),
            ("grandstand_v2", -26, 30, H, 0),
            ("boost_pad_v2", -5, -6, 0, 0),
            ("jump_ramp", 5, -1, 0, 0),
            ("item_box_v2", -6, 3, 0.4, 1.35),
            ("item_box_v2", -2, 3, 0.4, 1.35),
            ("item_box_v2", 2, 3, 0.4, 1.35),
            ("item_box_v2", 6, 3, 0.4, 1.35),
            ("tire_stack", 14.0, -6, 0, 0),
            ("tire_stack", 14.0, -4.9, 0.5, 0),
            ("tire_stack", 14.9, -5.5, 1.0, 0),
            ("barrier_block", 13.6, 0, H, 0),
            ("barrier_block", 13.6, 2.1, H, 0),
            ("barrier_block", 13.6, 4.2, H, 0),
            ("barrier_block", 13.6, 6.3, H, 0),
            ("finish_banner_post", 14.5, 13, 0, 0),
            ("finish_banner_post", 14.5, 22, 0, 0),
            ("balloon_cluster", 16, 9, 0, 0),
            ("balloon_cluster", 17.5, 17, 1.0, 0),
            ("podium", 21, 30, H, 0),
            ("trophy", 21, 30, H, 1.62),
            ("hot_air_balloon", -12, 58, 0, 5),
            ("cloud_a", 18, 70, 0, 20),
            ("cloud_b", -30, 62, 0, 23),
            ("V1:kart_oobi", -3.5, -10, 0, 0),
            ("V1:kart_oozi", 2.5, -13, 0.1, 0),
        ],
    ),
    "meadow": dict(
        ground="7cc95a", road=(14, 120, 0, 10), sky="a9dcff", sky_strength=1.0, sun=4.2, sun_rot=(48, 8, 35),
        cam=((24, -22, 13), (0, 10, 3), 28),
        items=[
            ("tree_round_a", -12, 6, 0, 0), ("tree_round_b", -15, 14, 1, 0), ("tree_round_a", -11, 22, 2, 0),
            ("tree_round_b", 13, 26, 0.5, 0), ("bush_a", -9, -2, 0, 0), ("bush_b", -8.5, 1.5, 0.6, 0),
            ("bush_b", 9, 3, 0, 0), ("bush_a", 10, 12, 1, 0), ("flower_patch", -10.5, -6, 0, 0), ("flower_patch", 11, -3, 1, 0),
            ("windmill", 16, 14, 0.3, 0), ("barn", -20, 28, -0.4, 0),
            ("fence_segment", 8.5, -10, H, 0), ("fence_segment", 8.5, -6, H, 0), ("fence_segment", -8.5, 8, H, 0), ("fence_segment", -8.5, 12, H, 0),
            ("V1:kart_ooli", 0, -8, 0, 0), ("cloud_a", -8, 60, 0, 22),
        ],
    ),
    "hills": dict(
        ground="88c97a", road=(14, 120, 0, 10), sky="ffd9c2", sky_strength=1.0, sun=3.4, sun_rot=(68, 0, -60), sun_col="ffe2c0",
        cam=((24, -22, 13), (0, 10, 3), 28),
        items=[
            ("pine_a", -11, 4, 0, 0), ("pine_b", -14, 12, 1, 0), ("pine_c", -10, 18, 2, 0), ("pine_a", 12, 20, 0.5, 0),
            ("pine_b", 15, 28, 0, 0), ("pine_c", 11, 8, 1.5, 0), ("pine_a", -18, 26, 1, 0),
            ("rock_a", -9, -4, 0, 0), ("rock_b", 9.5, -2, 1, 0), ("rock_c", 10, 2, 2, 0), ("rock_b", -9, 9, 0.4, 0),
            ("cottage", 18, 12, -0.5, 0), ("V1:kart_oopi", 0, -8, 0, 0),
        ],
    ),
    "desert": dict(
        ground="f6d39c", road=(14, 120, 0, 10), sky="ffbf9a", sky_strength=0.9, sun=3.6, sun_rot=(66, 0, -120), sun_col="ffc89a",
        cam=((24, -22, 13), (0, 14, 4), 28),
        items=[
            ("mesa", -32, 52, 0.3, 0), ("arch_rock", 16, 46, -0.3, 0), ("cactus_a", -10, 2, 0, 0), ("cactus_b", 10, 6, 1, 0),
            ("cactus_a", 11, 16, 2, 0), ("cactus_b", -12, 14, 0.5, 0), ("desert_rock_a", -9, -5, 0, 0), ("desert_rock_b", 9.5, -3, 1, 0),
            ("desert_rock_a", -13, 22, 2, 0), ("palm", -16, 6, 0, 0), ("palm", 16, 10, 1.5, 0), ("V1:kart_oodi", 0, -8, 0, 0),
        ],
    ),
    "night": dict(
        ground="343a70", road=(26, 120, 0, 20), sky="2a3070", sky_strength=0.7, sun=1.3, sun_rot=(55, 0, 140), sun_col="9fb4ff",
        cam=((24, -26, 12), (0, 16, 6), 26), bloom=True,
        items=[
            ("neon_ring_pink", 0, 8, 0, 0), ("neon_ring_cyan", 0, 30, 0, 0), ("lamp_post", -14, 0, -H, 0), ("lamp_post", 14, 12, H, 0),
            ("lamp_post", -14, 24, -H, 0), ("crystal_cluster", -15.5, -2, 0, 0), ("crystal_cluster", 16, -4, 1, 0),
            ("building_a", -26, 34, 0, 0), ("building_b", 26, 30, 0.3, 0), ("building_c", -24, 12, 0.5, 0), ("building_a", 30, 54, 1.2, 0),
            ("V1:kart_oobi", -2, -6, 0, 0),
        ],
    ),
}


def load(src, name):
    if name.startswith("V1:"):
        return os.path.join(V1, name[3:] + ".glb")
    return os.path.join(src, name + ".glb")


def render_sheet(src, key, dst, samples, pct):
    S = SHEETS[key]
    lib2.reset()
    sc = bpy.context.scene
    for name, x, y, rz, z in S["items"]:
        p = load(src, name)
        if not os.path.exists(p):
            print("  (missing)", p)
            continue
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=p)
        roots = [o for o in set(bpy.data.objects) - before if o.parent is None]
        for o in roots:
            o.location = Vector((x, y, z)) + o.location
            o.rotation_euler.z += rz
    bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 40, 0))
    bpy.context.active_object.data.materials.append(lib2.M("_ground", S["ground"], rough=0.95))
    rw, rl, rx, ry = S["road"]
    bpy.ops.mesh.primitive_plane_add(size=1, location=(rx, ry, 0.005))
    r = bpy.context.active_object
    r.scale = (rw, rl, 1)
    r.data.materials.append(lib2.M("_road", "5d5a73" if key != "desert" else "b7876a", rough=0.9))
    for s in (-1, 1):
        bpy.ops.mesh.primitive_plane_add(size=1, location=(rx + s * (rw / 2 + 0.4), ry, 0.006))
        k = bpy.context.active_object
        k.scale = (0.8, rl, 1)
        k.data.materials.append(lib2.M("_kerb", "f5f0e6", rough=0.9))
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = S["sun"]
    sun.color = lib2.lin(S.get("sun_col", "fff6e8"))
    sun.angle = math.radians(3)
    so = bpy.data.objects.new("sun", sun)
    so.rotation_euler = tuple(math.radians(a) for a in S["sun_rot"])
    sc.collection.objects.link(so)
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (*lib2.lin(S["sky"]), 1)
    bg.inputs["Strength"].default_value = S["sky_strength"]
    sc.world = w
    (cx, cy, cz), tgt_p, lens = S["cam"]
    cam = bpy.data.cameras.new("cam")
    cam.lens = lens
    cam.clip_end = 600
    co = bpy.data.objects.new("cam", cam)
    co.location = (cx, cy, cz)
    sc.collection.objects.link(co)
    tgt = bpy.data.objects.new("tgt", None)
    tgt.location = tgt_p
    sc.collection.objects.link(tgt)
    c = co.constraints.new("TRACK_TO")
    c.target = tgt
    sc.camera = co
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 4
    sc.view_settings.view_transform = "AgX"
    try:
        sc.view_settings.look = "AgX - Punchy"
    except TypeError:
        pass
    sc.render.resolution_x, sc.render.resolution_y = 1600, 1000
    sc.render.resolution_percentage = pct
    sc.render.film_transparent = False
    sc.render.filepath = os.path.abspath(dst)
    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    bpy.ops.render.render(write_still=True)
    print("rendered", dst)


def render_solo(src, name, dst, samples, night=False):
    """One model alone, auto-framed from the front-right (used for close-up QA sheets)."""
    lib2.reset()
    sc = bpy.context.scene
    bpy.ops.import_scene.gltf(filepath=load(src, name))
    objs = [o for o in bpy.data.objects if o.type == "MESH"]
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    ctr, rad = (lo + hi) / 2, (hi - lo).length / 2
    bpy.ops.mesh.primitive_plane_add(size=max(60, rad * 8), location=(ctr.x, ctr.y, min(0, lo.z)))
    bpy.context.active_object.data.materials.append(lib2.M("_ground", "2a2f5a" if night else "b9d99a", rough=0.95))
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 0.6 if night else 4.0
    so = bpy.data.objects.new("sun", sun)
    so.rotation_euler = (math.radians(50), math.radians(10), math.radians(30))
    sc.collection.objects.link(so)
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (*lib2.lin("1a1f4a" if night else "cfe8ff"), 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.4 if night else 1.0
    sc.world = w
    cam = bpy.data.cameras.new("cam")
    cam.lens = 40
    co = bpy.data.objects.new("cam", cam)
    d = Vector((0.75, -1.5, 0.75)).normalized()
    co.location = ctr + d * (rad / math.sin(math.radians(19)) * 1.02)
    sc.collection.objects.link(co)
    tgt = bpy.data.objects.new("tgt", None)
    tgt.location = ctr
    sc.collection.objects.link(tgt)
    c = co.constraints.new("TRACK_TO")
    c.target = tgt
    sc.camera = co
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = "AgX"
    try:
        sc.view_settings.look = "AgX - Punchy"
    except TypeError:
        pass
    sc.render.resolution_x, sc.render.resolution_y = 520, 400
    sc.render.filepath = os.path.abspath(dst)
    bpy.ops.render.render(write_still=True)


def solo_sheet(src, names, dst, samples, night=False):
    from PIL import Image, ImageDraw

    tiles = []
    for n in names:
        p = os.path.splitext(dst)[0] + f"-solo-{n}.png"
        render_solo(src, n, p, samples, night)
        im = Image.open(p).convert("RGB")
        ImageDraw.Draw(im).text((8, 6), n, fill=(255, 255, 255) if night else (20, 20, 40))
        tiles.append(im)
        os.remove(p)
    cols = 4
    w, h = tiles[0].size
    sheet = Image.new("RGB", (w * cols, h * ((len(tiles) + cols - 1) // cols)), "white")
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % cols) * w, (i // cols) * h))
    sheet.save(dst)
    print("solo sheet", dst)


def main():
    a = lib.args()
    src, keys, dst = a[0], a[1].split(","), a[2]
    samples = int(a[3]) if len(a) > 3 else 28
    pct = int(a[4]) if len(a) > 4 else 100
    if keys[0].startswith("solo"):
        night = keys[0].startswith("solonight")
        solo_sheet(src, [keys[0].split(":", 1)[1]] + keys[1:], dst, samples, night)
        return
    if len(keys) == 1:
        render_sheet(src, keys[0], dst, samples, pct)
        return
    from PIL import Image

    tiles = []
    for k in keys:
        p = os.path.splitext(dst)[0] + f"-{k}.png"
        render_sheet(src, k, p, samples, pct)
        tiles.append(Image.open(p).convert("RGB"))
    w, h = tiles[0].size
    sheet = Image.new("RGB", (w, h) if len(tiles) == 1 else (w * 2, h * ((len(tiles) + 1) // 2)), "white")
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % 2) * w, (i // 2) * h))
    sheet = sheet.resize((1600, int(1600 * sheet.size[1] / sheet.size[0])))
    sheet.save(dst)
    print("tiled", dst)


main()

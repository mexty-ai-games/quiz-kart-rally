"""
Packs the Kenney CC0 models the game uses (vendor/kenney/) into self-contained GLBs:
the shared colormap texture is embedded, and a uniform scale is baked in so every model
is in game metres (a kart ≈ 2.4 m long, an item box ≈ 1.5 m).
Node names are kept (the karts' wheel-* and character nodes are animated in the game).

  python3 blender/pack_kenney.py -- vendor/kenney blender/out
  (or: blender --background --factory-startup --python blender/pack_kenney.py -- vendor/kenney blender/out)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from mathutils import Matrix  # noqa: E402

import lib  # noqa: E402

# source (kit/file) -> (output name, scale)
MODELS = {
    "car/kart-oobi.glb": ("kart_oobi", 1.7),
    "car/kart-oodi.glb": ("kart_oodi", 1.7),
    "car/kart-ooli.glb": ("kart_ooli", 1.7),
    "car/kart-oopi.glb": ("kart_oopi", 1.7),
    "car/kart-oozi.glb": ("kart_oozi", 1.7),
    "car/debris-tire.glb": ("debris_tire", 1.7),
    "car/cone.glb": ("cone", 1.6),
    "toy/item-box.glb": ("item_box", 3.3),
    "toy/item-banana.glb": ("banana", 3.2),
    "toy/item-coin-gold.glb": ("coin", 3.4),
    "toy/tree.glb": ("tree", 8.0),
    "toy/tree-pine.glb": ("tree_pine", 9.0),
    "toy/smoke.glb": ("smoke", 2.0),
}


def pack(src, dst, s):
    lib.reset()
    bpy.ops.import_scene.gltf(filepath=src)
    S = Matrix.Scale(s, 4)
    for o in bpy.context.scene.objects:
        if o.type == "MESH":
            o.data.transform(S)
        o.location = o.location * s
    # every image must travel inside the GLB
    for img in bpy.data.images:
        if img.source == "FILE" and not img.packed_file:
            img.pack()
    lib.export(dst)
    print(f"    {os.path.basename(dst)}: {lib.tri_count()} tris")


def main():
    a = lib.args()
    src_dir = a[0] if a else "vendor/kenney"
    out_dir = a[1] if len(a) > 1 else "blender/out"
    os.makedirs(out_dir, exist_ok=True)
    for rel, (name, s) in MODELS.items():
        pack(os.path.join(src_dir, rel), os.path.join(out_dir, f"{name}.glb"), s)


main()

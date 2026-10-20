"""Validates the kit 2 GLBs straight from their glTF JSON + binary buffers (glTF axes: +Y up, +Z faces
the incoming karts). Prints one line per model and fails loudly on a broken naming / origin contract.

  python3 blender/validate_kit2.py blender/out2 [--json blender/out2/kit2_stats.json]
"""
import glob
import json
import os
import struct
import sys

import numpy as np

BUDGET = {
    "item_box_v2": 3000, "gantry_v2": 8000, "start_arch_v2": 10000, "boost_pad_v2": 1500, "jump_ramp": 2000,
    "grandstand_v2": 15000, "tire_stack": 800, "barrier_block": 300, "balloon_cluster": 2000, "hot_air_balloon": 3000,
    "cloud_a": 1500, "cloud_b": 1500, "podium": 3000, "trophy": 2000, "finish_banner_post": 600,
    "tree_round_a": 1200, "tree_round_b": 1200, "bush_a": 600, "bush_b": 600, "flower_patch": 1500, "windmill": 3000,
    "barn": 1500, "fence_segment": 400, "pine_a": 600, "pine_b": 600, "pine_c": 600, "rock_a": 500, "rock_b": 500,
    "rock_c": 500, "cottage": 1500, "cactus_a": 1000, "cactus_b": 1000, "mesa": 3000, "desert_rock_a": 500,
    "desert_rock_b": 500, "palm": 1500, "arch_rock": 3000, "lamp_post": 600, "neon_ring_pink": 3000,
    "neon_ring_cyan": 3000, "crystal_cluster": 800, "building_a": 2500, "building_b": 2500, "building_c": 2500,
}
CTYPE = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def load(path):
    d = open(path, "rb").read()
    jl = struct.unpack("<I", d[12:16])[0]
    j = json.loads(d[20 : 20 + jl])
    off = 20 + jl
    bl = struct.unpack("<I", d[off : off + 4])[0]
    return j, d[off + 8 : off + 8 + bl]


def accessor(j, buf, i):
    a = j["accessors"][i]
    bv = j["bufferViews"][a["bufferView"]]
    n = NCOMP[a["type"]]
    arr = np.frombuffer(buf, dtype=CTYPE[a["componentType"]], count=a["count"] * n, offset=bv.get("byteOffset", 0) + a.get("byteOffset", 0))
    return arr.reshape(-1, n) if n > 1 else arr


def quat_mat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def node_mats(j):
    """World 4×4 matrix per node index."""
    out = {}

    def walk(i, parent):
        n = j["nodes"][i]
        m = np.eye(4)
        if "matrix" in n:
            m = np.array(n["matrix"]).reshape(4, 4).T
        else:
            m[:3, :3] = quat_mat(n.get("rotation", [0, 0, 0, 1])) @ np.diag(n.get("scale", [1, 1, 1]))
            m[:3, 3] = n.get("translation", [0, 0, 0])
        out[i] = parent @ m
        for c in n.get("children", []):
            walk(c, out[i])

    for r in j["scenes"][j.get("scene", 0)]["nodes"]:
        walk(r, np.eye(4))
    return out


def inspect(path):
    j, buf = load(path)
    W = node_mats(j)
    info = {"file": os.path.basename(path), "kb": os.path.getsize(path) / 1024, "nodes": {}, "tris": 0}
    mats = j.get("materials", [])
    info["materials"] = [m["name"] for m in mats]
    allpts = []
    for i, n in enumerate(j["nodes"]):
        rec = {"translation": [round(v, 3) for v in W[i][:3, 3]], "mesh": "mesh" in n, "mats": [], "parent": None}
        if "mesh" in n:
            pts = []
            for p in j["meshes"][n["mesh"]]["primitives"]:
                pos = accessor(j, buf, p["attributes"]["POSITION"]).astype(np.float64)
                cnt = j["accessors"][p["indices"]]["count"] if "indices" in p else len(pos)
                info["tris"] += cnt // 3
                rec["mats"].append(mats[p["material"]]["name"] if "material" in p else None)
                wp = (W[i] @ np.c_[pos, np.ones(len(pos))].T).T[:, :3]
                pts.append(wp)
                rec.setdefault("local", []).append(pos)
            pts = np.vstack(pts)
            rec["bbox"] = (pts.min(0), pts.max(0))
            rec["pts"] = pts
            allpts.append(pts)
        info["nodes"][n.get("name", f"node{i}")] = rec
    for i, n in enumerate(j["nodes"]):
        for c in n.get("children", []):
            info["nodes"][j["nodes"][c]["name"]]["parent"] = n["name"]
    allpts = np.vstack(allpts)
    info["bbox"] = (allpts.min(0), allpts.max(0))
    info["alpha"] = {m["name"]: m.get("alphaMode", "OPAQUE") for m in mats}
    info["emissive"] = {m["name"]: max(m.get("emissiveFactor", [0, 0, 0])) * m.get("extensions", {}).get("KHR_materials_emissive_strength", {}).get("emissiveStrength", 1) for m in mats}
    return info


def check(name, I):
    errs = []
    N = I["nodes"]
    lo, hi = I["bbox"]
    for m, a in I["alpha"].items():
        if m.startswith("glass_") and a != "BLEND":
            errs.append(f"{m} alphaMode {a}")
        if m.startswith("glow_") and I["emissive"][m] <= 0:
            errs.append(f"{m} has no emission")
    if name in BUDGET and I["tris"] > BUDGET[name]:
        errs.append(f"over budget {I['tris']} > {BUDGET[name]}")
    if abs(lo[1]) > 0.02 and name not in ("item_box_v2", "neon_ring_pink", "neon_ring_cyan", "arch_rock"):
        errs.append(f"ground not at y=0 (min y {lo[1]:.3f})")
    if name == "item_box_v2":
        c = (lo + hi) / 2
        if np.abs(c).max() > 0.02 or abs((hi - lo)[0] - 1.5) > 0.02:
            errs.append(f"not a 1.5 m cube centred on the origin: {lo} {hi}")
    if name == "gantry_v2":
        s = N.get("SCREEN")
        if not s or s["mats"] != ["screen"]:
            errs.append("SCREEN mesh with material 'screen' missing")
        else:
            a, b = s["bbox"]
            sz, ctr = b - a, (a + b) / 2
            if abs(sz[0] - 10) > 0.01 or abs(sz[1] - 3.1) > 0.01 or sz[2] > 0.01 or abs(ctr[0]) > 0.01 or abs(ctr[1] - 6.6) > 0.05:
                errs.append(f"SCREEN geometry off: size {sz} centre {ctr}")
            # facing +Z: everything else of the gantry must be behind the screen plane
            others = np.vstack([r["pts"] for k, r in N.items() if r["mesh"] and k != "SCREEN"])
            near = others[(np.abs(others[:, 0]) < 4.9) & (np.abs(others[:, 1] - 6.6) < 1.5)]
            if (near[:, 2] > ctr[2] + 1e-3).any():
                errs.append("geometry in front of SCREEN")
    if name == "start_arch_v2":
        for k in range(1, 6):
            r = N.get(f"LAMP{k}")
            if not r or r["mats"] != [f"lamp{k}"]:
                errs.append(f"LAMP{k} / lamp{k} missing")
        xs = [N[f"LAMP{k}"]["translation"][0] for k in range(1, 6) if f"LAMP{k}" in N]
        if xs != sorted(xs):
            errs.append("LAMP1..5 not ordered left -> right (-X -> +X)")
    if name == "windmill":
        b = N.get("BLADES")
        if not b or b["parent"] != "windmill":
            errs.append("BLADES child missing")
        else:
            loc = np.vstack(b["local"])
            c = (loc.min(0) + loc.max(0)) / 2
            if np.abs(c[:2]).max() > 0.15:
                errs.append(f"BLADES not centred on its origin (local centre {c})")
            if (loc.max(0) - loc.min(0))[2] > 1.2:
                errs.append("BLADES not lying in the local XY plane")
    if name == "podium":
        for k in (1, 2, 3):
            if f"SPOT{k}" not in N:
                errs.append(f"SPOT{k} missing")
    if name == "jump_ramp":
        r = N.get("RAMP_SURFACE")
        if not r:
            errs.append("RAMP_SURFACE missing")
        else:
            p = r["pts"]
            exp = 1.6 * (3.5 - p[:, 2]) / 7.0
            if np.abs(p[:, 1] - exp).max() > 1e-3 or abs(p[:, 2].max() - 3.5) > 1e-3 or abs(p[:, 2].min() + 3.5) > 1e-3:
                errs.append("ramp surface is not the y = 1.6 * (3.5 - z) / 7 plane")
    if name == "boost_pad_v2":
        if abs(hi[0] - lo[0] - 3.6) > 0.02 or abs(hi[2] - lo[2] - 5.0) > 0.02:
            errs.append(f"pad size {hi - lo}")
    return errs


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "blender/out2"
    jout = sys.argv[sys.argv.index("--json") + 1] if "--json" in sys.argv else None
    rows, bad, total = {}, 0, 0
    for p in sorted(glob.glob(os.path.join(src, "*.glb"))):
        name = os.path.splitext(os.path.basename(p))[0]
        I = inspect(p)
        e = check(name, I)
        lo, hi = I["bbox"]
        sz = hi - lo
        total += I["kb"]
        named = {k: v for k, v in I["nodes"].items() if k.isupper() or k[:4] in ("LAMP", "SPOT") or k in ("SCREEN", "BLADES", "RAMP_SURFACE")}
        print(f"{name:20s} {I['tris']:6d} tris {len(I['materials']):2d} mats {I['kb']:7.1f} KB  size x{sz[0]:6.2f} y{sz[1]:6.2f} z{sz[2]:6.2f}  "
              f"y[{lo[1]:6.2f},{hi[1]:6.2f}] z[{lo[2]:6.2f},{hi[2]:6.2f}]  {' '.join(sorted(named))}  {'OK' if not e else 'FAIL: ' + '; '.join(e)}")
        bad += bool(e)
        rows[name] = {"tris": I["tris"], "kb": round(I["kb"], 1), "materials": I["materials"], "size": [round(float(v), 2) for v in sz],
                      "min": [round(float(v), 2) for v in lo], "max": [round(float(v), 2) for v in hi],
                      "named": {k: {"translation": v["translation"], "mats": v["mats"], "parent": v["parent"]} for k, v in named.items()}}
    print(f"\n{len(rows)} models, {total / 1024:.2f} MB total, {bad} failing")
    if jout:
        json.dump(rows, open(jout, "w"), indent=1)
    sys.exit(1 if bad else 0)


main()

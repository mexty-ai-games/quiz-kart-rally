# Asset kit 2 — Quiz Kart Rally

All procedural (bpy + bmesh, no generated or downloaded models). Build, check and preview:

```
python3 blender/make_kit2_track.py  -- blender/out2      # shared track kit
python3 blender/make_kit2_meadow.py -- blender/out2
python3 blender/make_kit2_hills.py  -- blender/out2
python3 blender/make_kit2_desert.py -- blender/out2
python3 blender/make_kit2_night.py  -- blender/out2      # any script: add model names to build only those
python3 blender/validate_kit2.py blender/out2 --json blender/out2/kit2_stats.json
python3 blender/preview2.py -- blender/out2 track docs/kit2-preview-track.png   (stored as .jpg in the repo)
python3 blender/preview2.py -- blender/out2 meadow,hills,desert,night docs/kit2-preview-themes.png  (stored as .jpg in the repo)
```

Conventions (glTF / three.js): metres, +Y up, karts drive towards -Z, so +Z faces the incoming karts. Origin is on
the ground (y = 0) at the centre of the footprint unless a line says otherwise. Every model is one mesh node named
after the file (one primitive per material) plus the named child nodes listed. Emissive materials start with
`glow_`, transparent ones with `glass_` (alphaMode BLEND). Colours are sRGB hex values stored as linear factors.
Size = bounding box x × y × z.

## Track kit
- `item_box_v2.glb` — 1.50 × 1.50 × 1.50, 1372 tris. Origin at the **cube centre** (y from -0.75 to 0.75). Materials `glass_box` (alpha 0.55), `glow_question` (four "?" emblems, one per side face).
- `gantry_v2.glb` — 25.5 × 11.0 × 2.5, 4722 tris. Towers at x = ±11.5, truss beam 7.6–8.9 m. Child mesh **`SCREEN`**: one 10 × 3.1 quad, centre (0, 6.6, 1.01), faces +Z, UVs 0..1 (U → +X, V → up), material **`screen`**. Also `glow_screen_frame` (orange frame), `glow_lamp` (4 spotlight lenses).
- `start_arch_v2.glb` — 29.9 × 11.6 × 2.9, 5066 tris. Towers at x = ±12.5, arch apex 10.4 m. Child meshes **`LAMP1`..`LAMP5`** (x = -4, -2, 0, 2, 4; y = 8.45; node origin at the lamp centre; the disc shows on both faces) with materials **`lamp1`..`lamp5`** (dark red base, emission 0 — the game drives emissive).
- `boost_pad_v2.glb` — 3.6 × 0.11 × 5.0, 772 tris. Pad top at y ≈ 0.06 (side rails 0.11). `glow_boost` = the 3 chevrons, pointing -Z.
- `jump_ramp.glb` — 9.1 × 2.3 × 7.2, 732 tris. Driving surface is the child mesh **`RAMP_SURFACE`**: exactly the plane y = 1.6 · (3.5 − z) / 7 for x ∈ [-4, 4], z ∈ [-3.5, 3.5] (y = 0 at z = +3.5, lip y = 1.6 at z = -3.5); yellow/charcoal chevrons are coplanar faces of it, last 0.35 m is `glow_ramp`. Side walls at |x| 4.0–4.5 rise 0.45 m above the slope.
- `grandstand_v2.glb` — 25.0 × 8.2 × 8.9, 11116 tris. Faces +Z; front parapet at z ≈ -0.4, roof poles at z ≈ +1.1, roof overhang to z = +1.6, back wall at z ≈ -7.0. 5 rows, ~56 fans.
- `tire_stack.glb` — 0.98 × 0.89 × 0.96, 780 tris. Material `rubber` + three stripe colours.
- `barrier_block.glb` — 2.12 × 0.95 × 0.66, 196 tris. Along X, four 0.5 m sections `barrier_red` / `barrier_white`.
- `balloon_cluster.glb` — 2.0 × 4.3 × 1.9, 998 tris. Origin = the string anchor (weight) on the ground.
- `hot_air_balloon.glb` — 6.8 × 10.3 × 6.8, 808 tris. Origin = basket bottom.
- `cloud_a.glb` / `cloud_b.glb` — 12.6 × 5.1 × 5.1 / 12.5 × 4.7 × 4.7, 1176 / 1008 tris. Material `cloud`. Origin at the centre of the flat bottom (place at any sky height).
- `podium.glb` — 9.8 × 1.6 × 3.2, 1344 tris. Empty nodes **`SPOT1`** (0, 1.6, 0), **`SPOT2`** (-3.05, 1.1, 0), **`SPOT3`** (3.05, 0.8, 0) on the top surfaces. Digits on the +Z faces; `gold` / `silver` / `bronze` metallic trims.
- `trophy.glb` — 0.74 × 0.80 × 0.51, 1068 tris. Metallic `gold` cup on a `charcoal` base, star on the +Z side.
- `finish_banner_post.glb` — 2.3 × 6.3 × 0.6, 288 tris. Pole at the origin, chequered flag flies towards +X.

## Meadow (sunny)
- `tree_round_a.glb` — 5.6 × 7.9 × 4.9, 845 tris. `tree_round_b.glb` — 5.4 × 9.3 × 4.5, 913 tris.
- `bush_a.glb` — 2.2 × 1.2 × 1.7, 560 tris. `bush_b.glb` — 2.4 × 1.3 × 1.7, 580 tris (pink/yellow flowers).
- `flower_patch.glb` — 3.1 × 0.8 × 3.0, 1076 tris (34 flowers + grass blades, one mesh).
- `windmill.glb` — 9.5 × 13.6 × 6.3, 1686 tris. Child mesh **`BLADES`**, node at the hub (0, 8.9, 2.75), identity rotation; the sails lie in its local XY plane facing +Z, so spin it with `BLADES.rotation.z`.
- `barn.glb` — 7.8 × 7.4 × 8.8, 572 tris. Big door on the +Z gable.
- `fence_segment.glb` — 4.2 × 1.15 × 0.3, 136 tris. Runs along X from -2 to +2 (posts at -2, 0, +2; tile every 4 m), rails on the +Z side.

## Hills (morning)
- `pine_a.glb` — 4.5 × 9.3 × 4.5, 208 tris. `pine_b.glb` — 5.3 × 12.1 × 5.3, 253 tris. `pine_c.glb` — 4.3 × 8.0 × 4.2, 168 tris.
- `rock_a.glb` — 2.7 × 1.5 × 2.2, 320 tris. `rock_b.glb` — 4.7 × 2.8 × 4.2, 400 tris (moss top). `rock_c.glb` — 2.8 × 2.6 × 2.2, 480 tris.
- `cottage.glb` — 5.6 × 5.8 × 4.8, 560 tris. Door and flower box on +Z.

## Desert (sunset)
- `cactus_a.glb` — 3.2 × 4.8 × 0.9, 522 tris (pink flower on top). `cactus_b.glb` — 2.6 × 3.2 × 0.8, 338 tris.
- `mesa.glb` — 39.9 × 18.0 × 26.3, 2976 tris. Stratified butte + small spire on +X; backdrop.
- `desert_rock_a.glb` — 4.4 × 2.6 × 3.5, 320 tris. `desert_rock_b.glb` — 4.4 × 4.0 × 3.3, 400 tris.
- `palm.glb` — 6.8 × 8.9 × 6.6, 890 tris. Trunk leans towards +X.
- `arch_rock.glb` — 23.8 × 13.8 × 8.9, 936 tris. Arch spans X (opening ~8.5 m wide at the ground, ~9.5 m high at the centre).

## Night (neon)
- `lamp_post.glb` — 2.3 × 6.2 × 0.9, 482 tris. `glow_lamp` (warm bulb); arm reaches towards +X.
- `neon_ring_pink.glb` / `neon_ring_cyan.glb` — 32.4 × 19.4 × 3.6, 2728 tris each. Ring in the XY plane, centreline radius 14.6 m around (0, 3, 0), clipped 1 m under the ground (y ≥ -0.97). Inner neon tube (`glow_neon_pink` / `glow_neon_cyan`) at r ≈ 13.7, clear width at road level ≈ 26.2 m. Feet at x = ±14.3.
- `crystal_cluster.glb` — 2.7 × 2.7 × 2.4, 446 tris. `glow_crystal` (cyan), `glow_crystal_violet`.
- `building_a.glb` — 10.8 × 34.6 × 11.0, 620 tris (antenna, `glow_beacon`). `building_b.glb` — 16.4 × 20.0 × 10.8, 630 tris (water tank, `glow_neon_pink` sign bands). `building_c.glb` — 12.6 × 37.3 × 12.6, 698 tris (stepped, `glow_neon_cyan` edges). All: `glow_window` (lit) and `window_dark` (unlit) window quads.

Total: 44 GLBs, 2.36 MB.

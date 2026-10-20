/**
 * Builds a cup's world from its track: road ribbon, kerbs, barrier rail, embankment and lawn,
 * start line + arch, boost pads, question gantries, answer rows (boxes, cards, lane stripes),
 * coins, and the scenery (trees, stands, flags, tyre walls).
 */
import * as THREE from "three";
import { BuiltTrack, VERGE, pointAt, sampleAt } from "./track";
import { Kit, cloneModel, instanceModel } from "./assets";
import { canvasTexture, CanvasTex, roadTexture, kerbTexture, checkerTexture, grassTexture, answerSprite, laneColor } from "./labels";

const KERB = 0.9;
const RAIL_H = 0.75;

export interface RowVis {
  group: THREE.Group;
  boxes: THREE.Object3D[];
  cards: { sprite: THREE.Sprite; ct: CanvasTex }[];
  stripes: THREE.Mesh[];
  screen: CanvasTex | null;
  /** seconds until each box reappears after being hit */
  respawn: number[];
  lanes: number;
}

export interface CoinVis {
  mesh: THREE.InstancedMesh[];
  locals: THREE.Matrix4[];
  base: THREE.Matrix4[];
  hidden: number[]; // seconds until visible again (0 = visible)
}

export interface WorldVis {
  root: THREE.Group;
  rows: RowVis[];
  coins: CoinVis;
  lamps: THREE.MeshStandardMaterial[];
  boostGlow: THREE.MeshStandardMaterial[];
  dispose: () => void;
}

function ribbon(track: BuiltTrack, latA: number, latB: number, yA: number, yB: number, vScale: number, mat: THREE.Material, flipU = false): THREE.Mesh {
  const S = track.samples;
  const N = S.length;
  const pos = new Float32Array((N + 1) * 2 * 3);
  const uv = new Float32Array((N + 1) * 2 * 2);
  const idx: number[] = [];
  const v = new THREE.Vector3();
  for (let k = 0; k <= N; k++) {
    const sm = S[k % N];
    const s = k === N ? track.length : sm.s;
    v.copy(sm.p).addScaledVector(sm.R, latA);
    pos.set([v.x, sm.p.y + yA, v.z], k * 6);
    v.copy(sm.p).addScaledVector(sm.R, latB);
    pos.set([v.x, sm.p.y + yB, v.z], k * 6 + 3);
    uv.set([flipU ? 1 : 0, s / vScale, flipU ? 0 : 1, s / vScale], k * 4);
    if (k < N) {
      // counter-clockwise seen from above (normals up)
      const a = k * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}

/** Vertical strip (barrier rail) at a lateral offset. */
function wall(track: BuiltTrack, lat: number, h: number, mat: THREE.Material): THREE.Mesh {
  const S = track.samples;
  const N = S.length;
  const pos = new Float32Array((N + 1) * 2 * 3);
  const uv = new Float32Array((N + 1) * 2 * 2);
  const idx: number[] = [];
  const v = new THREE.Vector3();
  for (let k = 0; k <= N; k++) {
    const sm = S[k % N];
    const s = k === N ? track.length : sm.s;
    v.copy(sm.p).addScaledVector(sm.R, lat);
    pos.set([v.x, sm.p.y, v.z, v.x, sm.p.y + h, v.z], k * 6);
    uv.set([0, s / 3, 1, s / 3], k * 4);
    if (k < N) {
      const a = k * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function railTexture(): THREE.CanvasTexture {
  const { tex, ctx } = canvasTexture(64, 64);
  ctx.fillStyle = "#8b72f0";
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = "#f3f0ff";
  ctx.fillRect(0, 20, 64, 22);
  ctx.fillStyle = "#ff8a1e";
  ctx.fillRect(0, 0, 4, 64);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.flipY = false;
  return tex;
}

/** Planar 0..1 UVs (top-left origin) for the gantry screen, whatever the GLB carried. */
function screenUV(m: THREE.Mesh) {
  const g = m.geometry as THREE.BufferGeometry;
  g.computeBoundingBox();
  const b = g.boundingBox!;
  const pos = g.getAttribute("position");
  const w = Math.max(1e-6, b.max.x - b.min.x);
  const flatY = b.max.y - b.min.y < 1e-3;
  const h = Math.max(1e-6, flatY ? b.max.z - b.min.z : b.max.y - b.min.y);
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - b.min.x) / w;
    uv[i * 2 + 1] = flatY ? (pos.getZ(i) - b.min.z) / h : (b.max.y - pos.getY(i)) / h;
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

export interface WorldOptions {
  ground: string;
  seed: number;
  quality: "low" | "high";
}

export function buildWorld(track: BuiltTrack, kit: Kit, opt: WorldOptions): WorldVis {
  const root = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const hw = track.halfW;
  const rnd = rng(opt.seed);

  // --- ground
  const b = track.bounds;
  const cx = (b.min.x + b.max.x) / 2,
    cz = (b.min.z + b.max.z) / 2;
  const size = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) + 900;
  const gtex = grassTexture(opt.ground);
  gtex.repeat.set(size / 14, size / 14);
  const groundMat = new THREE.MeshStandardMaterial({ map: gtex, roughness: 1 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, -0.06, cz);
  ground.receiveShadow = true;
  root.add(ground);
  disposables.push(ground.geometry, groundMat, gtex);

  // --- road, kerbs, embankment, rail
  const rtex = roadTexture();
  const roadMat = new THREE.MeshStandardMaterial({ map: rtex, roughness: 0.92 });
  root.add(ribbon(track, -hw, hw, 0.03, 0.03, 10, roadMat));
  const ktex = kerbTexture();
  ktex.repeat.set(1, 1);
  const kerbMat = new THREE.MeshStandardMaterial({ map: ktex, roughness: 0.8 });
  root.add(ribbon(track, -hw - KERB, -hw, 0.05, 0.05, 2.4, kerbMat));
  root.add(ribbon(track, hw, hw + KERB, 0.05, 0.05, 2.4, kerbMat));
  const vergeTex = grassTexture(new THREE.Color(opt.ground).offsetHSL(0, 0, 0.03).getStyle());
  vergeTex.repeat.set(1, 1);
  const vergeMat = new THREE.MeshStandardMaterial({ map: vergeTex, roughness: 1, side: THREE.DoubleSide });
  // embankment down to the lawn (flat tracks: it simply lies on the lawn)
  for (const side of [-1, 1]) {
    const S = track.samples;
    const N = S.length;
    const pos = new Float32Array((N + 1) * 3 * 3);
    const uv = new Float32Array((N + 1) * 3 * 2);
    const idx: number[] = [];
    const v = new THREE.Vector3();
    for (let k = 0; k <= N; k++) {
      const sm = S[k % N];
      const lats = [hw + KERB, hw + VERGE + 0.6, hw + VERGE + 0.6 + Math.max(2, sm.p.y * 2.2)];
      const ys = [sm.p.y + 0.04, sm.p.y + 0.0, Math.min(sm.p.y, 0) - 0.03];
      for (let j = 0; j < 3; j++) {
        v.copy(sm.p).addScaledVector(sm.R, side * lats[j]);
        pos.set([v.x, ys[j], v.z], (k * 3 + j) * 3);
        uv.set([v.x / 14, v.z / 14], (k * 3 + j) * 2);
      }
      if (k < N) {
        const a = k * 3;
        for (let j = 0; j < 2; j++) {
          if (side > 0) idx.push(a + j, a + 3 + j, a + j + 1, a + j + 1, a + 3 + j, a + 4 + j);
          else idx.push(a + j, a + j + 1, a + 3 + j, a + j + 1, a + 4 + j, a + 3 + j);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, vergeMat);
    m.receiveShadow = true;
    root.add(m);
  }
  const railTex = railTexture();
  const railMat = new THREE.MeshStandardMaterial({ map: railTex, roughness: 0.6, side: THREE.DoubleSide });
  root.add(wall(track, -(hw + VERGE + 0.3), RAIL_H, railMat));
  root.add(wall(track, hw + VERGE + 0.3, RAIL_H, railMat));
  disposables.push(rtex, roadMat, ktex, kerbMat, vergeTex, vergeMat, railTex, railMat);

  // --- start line + arch
  const chk = checkerTexture();
  const chkMat = new THREE.MeshStandardMaterial({ map: chk, roughness: 0.7 });
  const s0 = sampleAt(track, 0);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 2.4), chkMat);
  line.rotation.set(-Math.PI / 2, 0, 0);
  const lineHolder = new THREE.Group();
  lineHolder.add(line);
  lineHolder.position.copy(s0.p).setY(s0.p.y + 0.045);
  lineHolder.rotation.y = s0.yaw;
  line.receiveShadow = true;
  root.add(lineHolder);
  disposables.push(chk, chkMat);
  const lamps: THREE.MeshStandardMaterial[] = [];
  const arch = cloneModel(kit, "startArch");
  if (arch) {
    arch.position.copy(s0.p);
    arch.rotation.y = s0.yaw;
    const found: Record<string, THREE.MeshStandardMaterial> = {};
    arch.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        const mt = m.material as THREE.MeshStandardMaterial;
        if (/^lamp\d$/.test(mt.name)) {
          const c = mt.clone();
          m.material = c;
          found[mt.name] = c;
        }
      }
    });
    for (let k = 1; k <= 5; k++) if (found[`lamp${k}`]) lamps.push(found[`lamp${k}`]);
    root.add(arch);
  }

  // --- boost pads
  const boostGlow: THREE.MeshStandardMaterial[] = [];
  track.boosts.forEach((bp) => {
    const pad = cloneModel(kit, "boostPad");
    if (!pad) return;
    const sm = sampleAt(track, bp.s);
    pad.position.copy(sm.p).addScaledVector(sm.R, bp.lat);
    pad.position.y += 0.04;
    pad.rotation.y = sm.yaw;
    pad.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = false;
        const mt = m.material as THREE.MeshStandardMaterial;
        if (mt.name === "boost_glow") {
          const c = mt.clone();
          m.material = c;
          boostGlow.push(c);
        }
      }
    });
    root.add(pad);
  });

  // --- answer rows: gantry with its screen, boxes, cards and lane stripes
  const rows: RowVis[] = track.rows.map((row) => {
    const group = new THREE.Group();
    const sm = sampleAt(track, row.s);
    let screen: CanvasTex | null = null;
    const gantry = cloneModel(kit, "gantry");
    if (gantry) {
      const gs = sampleAt(track, row.s - 22);
      gantry.position.copy(gs.p);
      gantry.rotation.y = gs.yaw;
      gantry.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && /SCREEN/i.test(m.name)) {
          m.geometry = m.geometry.clone();
          screenUV(m);
          screen = canvasTexture(1024, 320, false);
          m.material = new THREE.MeshBasicMaterial({ map: screen.tex, toneMapped: false });
          m.castShadow = false;
        }
      });
      group.add(gantry);
    }
    const boxes: THREE.Object3D[] = [];
    const cards: { sprite: THREE.Sprite; ct: CanvasTex }[] = [];
    const stripes: THREE.Mesh[] = [];
    for (let k = 0; k < 4; k++) {
      const holder = new THREE.Group();
      const box = cloneModel(kit, "itemBox");
      if (box) {
        box.position.y = -0.75;
        holder.add(box);
      } else {
        const fb = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), new THREE.MeshStandardMaterial({ color: "#8b6cf0" }));
        holder.add(fb);
      }
      holder.position.copy(sm.p);
      holder.visible = false;
      group.add(holder);
      boxes.push(holder);
      const card = answerSprite();
      card.sprite.visible = false;
      group.add(card.sprite);
      cards.push(card);
      // lane stripe leading into the row
      const st = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ color: laneColor(k), transparent: true, opacity: 0.32, depthWrite: false })
      );
      st.rotation.x = -Math.PI / 2;
      const sh = new THREE.Group();
      sh.add(st);
      sh.visible = false;
      group.add(sh);
      stripes.push(st);
    }
    root.add(group);
    return { group, boxes, cards, stripes, screen, respawn: [0, 0, 0, 0], lanes: 0 };
  });

  // --- coins (instanced, hidden one by one when collected)
  const coinMats = track.coinLines.map((c) => {
    const sm = sampleAt(track, c.s);
    const p = pointAt(track, c.s, c.lat);
    return new THREE.Matrix4().compose(p.setY(sm.p.y + 0.9), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), sm.yaw), new THREE.Vector3(1, 1, 1));
  });
  const ci = instanceModel(kit, "coin", coinMats, false);
  root.add(ci.group);
  const coins: CoinVis = { mesh: ci.meshes, locals: ci.locals, base: coinMats, hidden: coinMats.map(() => 0) };

  // --- scenery
  const S = track.samples;
  const N = S.length;
  const cell = 24;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < N; i += 2) {
    const key = `${Math.floor(S[i].p.x / cell)},${Math.floor(S[i].p.z / cell)}`;
    const l = grid.get(key);
    if (l) l.push(i);
    else grid.set(key, [i]);
  }
  const clearOf = (x: number, z: number, r: number) => {
    const gx = Math.floor(x / cell),
      gz = Math.floor(z / cell);
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        const l = grid.get(`${gx + dx},${gz + dz}`);
        if (!l) continue;
        for (let q = 0; q < l.length; q++) {
          const p = S[l[q]].p;
          if ((p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) < r * r) return false;
        }
      }
    return true;
  };
  const treeA: THREE.Matrix4[] = [];
  const treeB: THREE.Matrix4[] = [];
  const nTrees = opt.quality === "high" ? 320 : 170;
  const spanX = b.max.x - b.min.x + 260,
    spanZ = b.max.z - b.min.z + 260;
  for (let t = 0, tries = 0; t < nTrees && tries < nTrees * 8; tries++) {
    const x = cx + (rnd() - 0.5) * spanX;
    const z = cz + (rnd() - 0.5) * spanZ;
    if (!clearOf(x, z, hw + VERGE + 6)) continue;
    const sc = 0.8 + rnd() * 0.7;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, -0.05, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28), new THREE.Vector3(sc, sc * (0.9 + rnd() * 0.3), sc));
    (rnd() < 0.5 ? treeA : treeB).push(m);
    t++;
  }
  root.add(instanceModel(kit, "tree", treeA, opt.quality === "high").group);
  root.add(instanceModel(kit, "treePine", treeB, opt.quality === "high").group);

  // tyre walls outside the tight corners, flags along the straights
  const tyres: THREE.Matrix4[] = [];
  const flags: THREE.Matrix4[] = [];
  for (let i = 0; i < N; i += 4) {
    const sm = S[i];
    if (Math.abs(sm.curv) > 1 / 55) {
      const side = sm.curv > 0 ? 1 : -1; // turning left → outside is the right
      const p = sm.p.clone().addScaledVector(sm.R, side * (hw + VERGE + 1.1));
      tyres.push(new THREE.Matrix4().compose(p.setY(sm.p.y), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-sm.T.z, sm.T.x)), new THREE.Vector3(1, 1, 1)));
    } else if (i % 48 === 0) {
      for (const side of [-1, 1]) {
        const p = sm.p.clone().addScaledVector(sm.R, side * (hw + VERGE + 2.2));
        flags.push(new THREE.Matrix4().compose(p.setY(sm.p.y), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), sm.yaw + Math.PI / 2), new THREE.Vector3(1, 1, 1)));
      }
    }
  }
  root.add(instanceModel(kit, "tireWall", tyres, false).group);
  root.add(instanceModel(kit, "flag", flags, false).group);

  // grandstands by the start straight, facing the road
  for (const [ds, side] of [
    [-40, 1],
    [10, 1],
    [-20, -1],
  ] as [number, number][]) {
    const st = cloneModel(kit, "grandstand");
    if (!st) break;
    const sm = sampleAt(track, ds);
    const lat = side * (hw + VERGE + 4.5);
    const p = sm.p.clone().addScaledVector(sm.R, lat);
    if (!clearOf(p.x, p.z, hw + VERGE + 3)) continue;
    st.position.copy(p).setY(sm.p.y - 0.05);
    const toward = sm.R.clone().multiplyScalar(-side);
    st.rotation.y = Math.atan2(toward.x, toward.z);
    root.add(st);
  }

  return {
    root,
    rows,
    coins,
    lamps,
    boostGlow,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
      rows.forEach((r) => {
        r.cards.forEach((c) => c.ct.tex.dispose());
        if (r.screen) r.screen.tex.dispose();
      });
    },
  };
}

/** Lays out a row for a question with `lanes` answers: boxes, cards and lane stripes. */
export function layoutRow(track: BuiltTrack, vis: RowVis, rowS: number, lanes: number) {
  const hw = track.halfW;
  const w = (hw * 2) / lanes;
  const centers: number[] = [];
  for (let k = 0; k < lanes; k++) centers.push(-hw + w * (k + 0.5));
  const sm = sampleAt(track, rowS);
  vis.lanes = lanes;
  for (let k = 0; k < 4; k++) {
    const on = k < lanes;
    const box = vis.boxes[k];
    box.visible = on;
    vis.cards[k].sprite.visible = on;
    (vis.stripes[k].parent as THREE.Object3D).visible = on;
    if (!on) continue;
    box.position.copy(sm.p).addScaledVector(sm.R, centers[k]).setY(sm.p.y + 1.2);
    box.userData.baseY = box.position.y;
    vis.cards[k].sprite.position.copy(box.position).setY(sm.p.y + 4.1);
    // stripe: 28 m long, ending at the row
    const ss = sampleAt(track, rowS - 15);
    const holder = vis.stripes[k].parent as THREE.Object3D;
    holder.position.copy(ss.p).addScaledVector(ss.R, centers[k]).setY(ss.p.y + 0.06);
    holder.rotation.y = ss.yaw;
    vis.stripes[k].scale.set(w - 0.9, 28, 1);
  }
  return centers;
}

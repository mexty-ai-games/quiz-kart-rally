/**
 * Builds a cup's world from its track and theme:
 *  - track: road, raised kerbs, verges, barriers (glowing at night), embankments, start grid, jump ramps,
 *    boost pads, question gantries and answer rows (boxes, cards, lane stripes), coins;
 *  - scenery: themed scatter (trees, rocks, cacti, crystals...), landmarks (windmills, mesas, city),
 *    roadside furniture (fences, street lamps with light pools, neon arches), lakes, a layered backdrop,
 *    clouds and hot air balloons, grandstands and the winners' podium.
 * Static copies are instanced (one draw call per mesh) and animated parts are updated in update().
 */
import * as THREE from "three";
import { BuiltTrack, VERGE, RAMP_LEN, pointAt, sampleAt, sectionPoint } from "./track";
import { Kit, cloneModel, instanceModel, pick, findNode, has } from "./assets";
import { canvasTexture, CanvasTex, checkerTexture, answerSprite, laneColor } from "./labels";
import { Theme } from "./themes";

const KERB = 1.1;

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

export interface PodiumVis {
  group: THREE.Object3D;
  spots: THREE.Vector3[];
  yaw: number;
  camPos: THREE.Vector3;
  look: THREE.Vector3;
  trophy: THREE.Object3D | null;
}

export interface WorldVis {
  root: THREE.Group;
  rows: RowVis[];
  coins: CoinVis;
  lamps: THREE.MeshStandardMaterial[];
  boostGlow: THREE.MeshStandardMaterial[];
  podium: PodiumVis | null;
  boxV2: boolean;
  update: (t: number, dt: number) => void;
  dispose: () => void;
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

// ------------------------------------------------------------------ textures
function roadTexture(th: Theme): THREE.CanvasTexture {
  const { tex, ctx } = canvasTexture(512, 512);
  const w = 512,
    h = 512;
  ctx.fillStyle = th.road;
  ctx.fillRect(0, 0, w, h);
  const g = new THREE.Color(th.roadGrain);
  for (let k = 0; k < 9000; k++) {
    const c = g.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.12);
    ctx.globalAlpha = 0.25 + Math.random() * 0.35;
    ctx.fillStyle = `#${c.getHexString()}`;
    const r = Math.random() < 0.9 ? 2 : 3;
    ctx.fillRect(Math.random() * w, Math.random() * h, r, r);
  }
  // faint racing-line wear in the middle of each half
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = "#000";
  ctx.fillRect(w * 0.22, 0, w * 0.12, h);
  ctx.fillRect(w * 0.66, 0, w * 0.12, h);
  ctx.globalAlpha = 1;
  ctx.fillStyle = th.edge;
  ctx.fillRect(10, 0, 12, h);
  ctx.fillRect(w - 22, 0, 12, h);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.flipY = false;
  tex.anisotropy = 8;
  return tex;
}

function stripeTexture(a: string, b: string, n = 2): THREE.CanvasTexture {
  const { tex, ctx } = canvasTexture(16, 64);
  for (let k = 0; k < n; k++) {
    ctx.fillStyle = k % 2 ? b : a;
    ctx.fillRect(0, (k * 64) / n, 16, 64 / n);
  }
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.flipY = false;
  return tex;
}

function noiseGrass(base: string, alt: string): THREE.CanvasTexture {
  const { tex, ctx } = canvasTexture(256, 256);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  const c = new THREE.Color(base);
  const c2 = new THREE.Color(alt);
  for (let k = 0; k < 2600; k++) {
    const t = (Math.random() < 0.5 ? c : c2).clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.07);
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = `#${t.getHexString()}`;
    const r = 1 + Math.random() * 3;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, r, r * (1 + Math.random()));
  }
  ctx.globalAlpha = 1;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function radialTexture(color: string): THREE.CanvasTexture {
  const { tex, ctx } = canvasTexture(128, 128);
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 63);
  const c = new THREE.Color(color);
  const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
  g.addColorStop(0, `rgba(${rgb},0.9)`);
  g.addColorStop(0.45, `rgba(${rgb},0.35)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return tex;
}

function laneTexture(): THREE.CanvasTexture {
  // soft-edged stripe with chevrons pointing along the travel direction
  const { tex, ctx } = canvasTexture(64, 256);
  const gr = ctx.createLinearGradient(0, 0, 64, 0);
  gr.addColorStop(0, "rgba(255,255,255,0)");
  gr.addColorStop(0.15, "rgba(255,255,255,0.75)");
  gr.addColorStop(0.85, "rgba(255,255,255,0.75)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, 64, 256);
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  for (let y = 0; y < 256; y += 64) {
    ctx.beginPath();
    ctx.moveTo(14, y + 40);
    ctx.lineTo(32, y + 18);
    ctx.lineTo(50, y + 40);
    ctx.lineTo(50, y + 52);
    ctx.lineTo(32, y + 30);
    ctx.lineTo(14, y + 52);
    ctx.closePath();
    ctx.fill();
  }
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ------------------------------------------------------------------ swept meshes
interface ProfilePt {
  lat: number;
  h: number;
  u: number;
}

/** Sweeps a cross-section (left → right) along the whole track, banking included. */
function sweep(track: BuiltTrack, prof: ProfilePt[], vScale: number, mat: THREE.Material, every = 1): THREE.Mesh {
  const S = track.samples;
  const N = S.length;
  const rowsN = Math.ceil(N / every) + 1;
  const P = prof.length;
  const pos = new Float32Array(rowsN * P * 3);
  const uv = new Float32Array(rowsN * P * 2);
  const idx: number[] = [];
  const v = new THREE.Vector3();
  for (let r = 0; r < rowsN; r++) {
    const k = Math.min(N, r * every);
    const sm = S[k % N];
    const s = k >= N ? track.length : sm.s;
    for (let j = 0; j < P; j++) {
      sectionPoint(sm, prof[j].lat, prof[j].h, v);
      pos.set([v.x, v.y, v.z], (r * P + j) * 3);
      uv.set([prof[j].u, s / vScale], (r * P + j) * 2);
    }
    if (r < rowsN - 1)
      for (let j = 0; j < P - 1; j++) {
        const a = r * P + j;
        idx.push(a, a + 1, a + P, a + 1, a + P + 1, a + P);
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

/** Slopes from the outer barrier down to the lawn (banked / raised sections). */
function embankment(track: BuiltTrack, side: number, mat: THREE.Material): THREE.Mesh {
  const S = track.samples;
  const N = S.length;
  const pos = new Float32Array((N + 1) * 3 * 3);
  const uv = new Float32Array((N + 1) * 3 * 2);
  const idx: number[] = [];
  const v = new THREE.Vector3();
  const edge = track.halfW + VERGE + 1.0;
  for (let k = 0; k <= N; k++) {
    const sm = S[k % N];
    sectionPoint(sm, side * edge, 0, v);
    const top = v.clone();
    const height = Math.max(0, top.y);
    const run = Math.max(2.5, height * 2.4);
    const mid = top.clone().addScaledVector(sm.R, side * run * 0.45);
    mid.y = top.y * 0.45 - 0.02;
    const foot = top.clone().addScaledVector(sm.R, side * run);
    foot.y = -0.08;
    [top, mid, foot].forEach((p, j) => {
      pos.set([p.x, p.y, p.z], (k * 3 + j) * 3);
      uv.set([p.x / 10, p.z / 10], (k * 3 + j) * 2);
    });
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
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
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

// ------------------------------------------------------------------ shader tweaks
const windUniform = { value: 0 };
const patched = new WeakSet<THREE.Material>();
/** Sway in the wind: vertices move with their height above the model's base. */
function windify(mat: THREE.Material, amount: number) {
  if (patched.has(mat)) return;
  patched.add(mat);
  const m = mat as THREE.MeshStandardMaterial;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = windUniform;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uWind;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          float hgt = max(0.0, position.y);
          vec3 basePos = vec3(0.0);
          #ifdef USE_INSTANCING
            basePos = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          #endif
          float ph = basePos.x * 0.071 + basePos.z * 0.053;
          float sway = sin(uWind * 1.7 + ph) * 0.6 + sin(uWind * 2.9 + ph * 1.7) * 0.25;
          transformed.x += sway * hgt * hgt * ${(0.0035 * amount).toFixed(5)};
          transformed.z += cos(uWind * 1.3 + ph) * hgt * hgt * ${(0.0025 * amount).toFixed(5)};
        }`
      );
  };
  m.customProgramCacheKey = () => "wind" + amount.toFixed(2);
  m.needsUpdate = true;
}

/** Lawn with large soft colour patches so it never looks like a flat sheet. */
function groundMaterial(th: Theme, tex: THREE.Texture) {
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
  const c1 = new THREE.Color(th.ground);
  const c2 = new THREE.Color(th.ground2);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.gA = { value: c1 };
    sh.uniforms.gB = { value: c2 };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vWxz;").replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWxz = (modelMatrix * vec4(transformed, 1.0)).xz;");
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec2 vWxz; uniform vec3 gA; uniform vec3 gB;
        float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gn(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(gh(i), gh(i+vec2(1,0)), f.x), mix(gh(i+vec2(0,1)), gh(i+vec2(1,1)), f.x), f.y); }`
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        float pn = gn(vWxz * 0.012) * 0.65 + gn(vWxz * 0.045) * 0.35;
        diffuseColor.rgb *= mix(vec3(1.0), gB / max(gA, vec3(0.05)), smoothstep(0.35, 0.75, pn));`
      );
  };
  return m;
}

const WATER_V = /* glsl */ `
varying vec2 vUv; varying vec3 vW;
void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const WATER_F = /* glsl */ `
varying vec2 vUv; varying vec3 vW;
uniform float t; uniform vec3 deep; uniform vec3 shallow; uniform vec3 sky; uniform vec3 sunDir;
void main(){
  vec2 p = vW.xz * 0.15;
  float w1 = sin(p.x * 3.1 + t * 1.3) * cos(p.y * 2.7 - t * 1.1);
  float w2 = sin(p.x * 7.3 - t * 2.1 + p.y * 5.1) * 0.5;
  vec3 n = normalize(vec3((w1 + w2) * 0.12, 1.0, (w1 - w2) * 0.12));
  vec3 v = normalize(cameraPosition - vW);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  float r = length(vUv - 0.5) * 2.0;
  vec3 col = mix(deep, shallow, smoothstep(0.55, 1.0, r));
  col = mix(col, sky, fres * 0.6);
  vec3 h = normalize(sunDir + v);
  col += vec3(1.0) * pow(max(dot(n, h), 0.0), 120.0) * 2.5;
  float edge = 1.0 - smoothstep(0.92, 1.0, r);
  gl_FragColor = vec4(col, edge * 0.92);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface WorldOptions {
  theme: Theme;
  seed: number;
  scatter: number;
  shadows: boolean;
  sunDir: THREE.Vector3;
  skyColor: string;
  /** how far from the road scenery is scattered (0..1 of each set's max) */
  reach: number;
}

export function buildWorld(track: BuiltTrack, kit: Kit, opt: WorldOptions): WorldVis {
  const th = opt.theme;
  const root = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const hw = track.halfW;
  const rnd = rng(opt.seed);
  const S = track.samples;
  const N = S.length;
  const add = (o: THREE.Object3D) => {
    root.add(o);
    return o;
  };

  // --- spatial queries: distance to the centre line, and space taken by big pieces
  const cell = 24;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < N; i += 2) {
    const key = `${Math.floor(S[i].p.x / cell)},${Math.floor(S[i].p.z / cell)}`;
    const l = grid.get(key);
    if (l) l.push(i);
    else grid.set(key, [i]);
  }
  const distTrack = (x: number, z: number, reach = 3) => {
    const gx = Math.floor(x / cell),
      gz = Math.floor(z / cell);
    let best = Infinity;
    for (let dx = -reach; dx <= reach; dx++)
      for (let dz = -reach; dz <= reach; dz++) {
        const l = grid.get(`${gx + dx},${gz + dz}`);
        if (!l) continue;
        for (let q = 0; q < l.length; q++) {
          const p = S[l[q]].p;
          const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
          if (d < best) best = d;
        }
      }
    return Math.sqrt(best);
  };
  const taken: { x: number; z: number; r: number }[] = [];
  const free = (x: number, z: number, r: number) => {
    for (let i = 0; i < taken.length; i++) {
      const t = taken[i];
      const dx = t.x - x,
        dz = t.z - z;
      if (dx * dx + dz * dz < (t.r + r) * (t.r + r)) return false;
    }
    return true;
  };
  const take = (x: number, z: number, r: number) => taken.push({ x, z, r });

  // --- the winners' podium spot (reserved first: nothing may stand between it and its camera)
  const podSm = sampleAt(track, 58);
  const podSide = -1;
  const podP = podSm.p.clone().addScaledVector(podSm.R, podSide * (hw + VERGE + 24));
  const podMid = podSm.p.clone().addScaledVector(podSm.R, podSide * (hw + VERGE + 14));
  take(podP.x, podP.z, 9);
  take(podMid.x, podMid.z, 9);

  // --- ground
  const b = track.bounds;
  const cx = (b.min.x + b.max.x) / 2,
    cz = (b.min.z + b.max.z) / 2;
  const ext = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
  const size = ext + 1400;
  const gtex = noiseGrass(th.ground, th.ground2);
  gtex.repeat.set(size / 16, size / 16);
  const groundMat = groundMaterial(th, gtex);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, -0.08, cz);
  ground.receiveShadow = true;
  add(ground);
  disposables.push(ground.geometry, groundMat, gtex);

  // --- road, kerbs, verges, barriers, embankments
  const rtex = roadTexture(th);
  const roadMat = new THREE.MeshStandardMaterial({ map: rtex, roughness: 0.88, metalness: 0.0 });
  add(sweep(track, [{ lat: -hw, h: 0.03, u: 0 }, { lat: 0, h: 0.03, u: 0.5 }, { lat: hw, h: 0.03, u: 1 }], 14, roadMat));
  const ktex = stripeTexture(th.kerbA, th.kerbB);
  const kerbMat = new THREE.MeshStandardMaterial({ map: ktex, roughness: 0.7 });
  const kerbProf = (side: number): ProfilePt[] => {
    const pts = [
      { lat: hw, h: 0.03 },
      { lat: hw + 0.25, h: 0.11 },
      { lat: hw + KERB - 0.25, h: 0.11 },
      { lat: hw + KERB, h: 0.0 },
    ].map((p, j) => ({ lat: p.lat * side, h: p.h, u: j / 3 }));
    return side < 0 ? pts.reverse() : pts;
  };
  add(sweep(track, kerbProf(-1), 3.2, kerbMat));
  add(sweep(track, kerbProf(1), 3.2, kerbMat));
  const vtex = noiseGrass(th.verge, th.ground);
  vtex.repeat.set(1, 1);
  const vergeMat = new THREE.MeshStandardMaterial({ map: vtex, roughness: 1 });
  add(sweep(track, [{ lat: -(hw + VERGE + 1.0), h: -0.02, u: 0 }, { lat: -(hw + KERB), h: 0.0, u: 1 }], 6, vergeMat));
  add(sweep(track, [{ lat: hw + KERB, h: 0.0, u: 0 }, { lat: hw + VERGE + 1.0, h: -0.02, u: 1 }], 6, vergeMat));
  const embMat = new THREE.MeshStandardMaterial({ map: gtex, roughness: 1 });
  add(embankment(track, -1, embMat));
  add(embankment(track, 1, embMat));
  // barrier: a chunky rounded wall with a striped face
  const btex = stripeTexture(th.barrierA, th.barrierB, 2);
  const barMat = new THREE.MeshStandardMaterial({ map: btex, roughness: 0.55, side: THREE.DoubleSide });
  const B = hw + VERGE + 0.3;
  const barProf = (side: number): ProfilePt[] => {
    const pts = [
      { lat: B, h: -0.05, u: 0 },
      { lat: B, h: 0.72, u: 0.35 },
      { lat: B + 0.18, h: 0.92, u: 0.5 },
      { lat: B + 0.5, h: 0.92, u: 0.6 },
      { lat: B + 0.68, h: 0.72, u: 0.8 },
      { lat: B + 0.68, h: -0.05, u: 1 },
    ].map((p) => ({ lat: p.lat * side, h: p.h, u: p.u }));
    return side < 0 ? pts.reverse() : pts;
  };
  const barL = add(sweep(track, barProf(-1), 4, barMat)) as THREE.Mesh;
  const barR = add(sweep(track, barProf(1), 4, barMat)) as THREE.Mesh;
  barL.castShadow = barR.castShadow = true;
  disposables.push(rtex, roadMat, ktex, kerbMat, vtex, vergeMat, embMat, btex, barMat);
  if (th.barrierGlow) {
    const gm = new THREE.MeshStandardMaterial({ color: th.barrierGlow, emissive: th.barrierGlow, emissiveIntensity: 2.6, roughness: 0.4 });
    add(sweep(track, [{ lat: -(B + 0.48), h: 0.95, u: 0 }, { lat: -(B + 0.2), h: 0.95, u: 1 }], 4, gm, 2));
    add(sweep(track, [{ lat: B + 0.2, h: 0.95, u: 0 }, { lat: B + 0.48, h: 0.95, u: 1 }], 4, gm, 2));
    disposables.push(gm);
  }
  if (th.roadGlow) {
    const gm = new THREE.MeshStandardMaterial({ color: th.roadGlow, emissive: th.roadGlow, emissiveIntensity: 2.2, roughness: 0.5 });
    add(sweep(track, [{ lat: -hw + 0.4, h: 0.045, u: 0 }, { lat: -hw + 0.62, h: 0.045, u: 1 }], 4, gm, 2));
    add(sweep(track, [{ lat: hw - 0.62, h: 0.045, u: 0 }, { lat: hw - 0.4, h: 0.045, u: 1 }], 4, gm, 2));
    disposables.push(gm);
  }

  // --- start line, grid boxes
  const chk = checkerTexture();
  const chkMat = new THREE.MeshStandardMaterial({ map: chk, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const s0 = sampleAt(track, 0);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 2.4), chkMat);
  line.rotation.set(-Math.PI / 2, 0, 0);
  const lineHolder = new THREE.Group();
  lineHolder.add(line);
  lineHolder.position.copy(s0.p).setY(s0.p.y + 0.05);
  lineHolder.rotation.set(0, s0.yaw, 0);
  line.receiveShadow = true;
  add(lineHolder);
  disposables.push(chk, chkMat);
  {
    const gm = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const bar = new THREE.PlaneGeometry(1, 1);
    for (let k = 0; k < 8; k++) {
      const s = track.length - 7 - k * 5.5;
      const lat = (k % 2 ? 1 : -1) * hw * 0.42;
      const sm = sampleAt(track, s);
      const p = pointAt(track, s, lat);
      const hold = new THREE.Group();
      hold.position.copy(p).setY(p.y + 0.055);
      hold.rotation.y = sm.yaw;
      // a "[" shaped slot: front bar + two sides
      [
        [2.6, 0.22, 0, -1.5],
        [0.22, 2.2, -1.2, -0.4],
        [0.22, 2.2, 1.2, -0.4],
      ].forEach(([w, l, ox, oz]) => {
        const m = new THREE.Mesh(bar, gm);
        m.rotation.x = -Math.PI / 2;
        m.scale.set(w, l, 1);
        m.position.set(ox, 0, oz);
        hold.add(m);
      });
      add(hold);
    }
    disposables.push(gm, bar);
  }

  // --- start arch, grandstands, balloons, banner posts around the start
  const lamps: THREE.MeshStandardMaterial[] = [];
  const archId = pick(kit, ["start_arch_v2", "start_arch"]);
  const arch = cloneModel(kit, archId);
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
    add(arch);
    take(s0.p.x, s0.p.z, 16);
  }
  const standId = pick(kit, ["grandstand_v2", "grandstand"]);
  const stands: [number, number][] = [
    [-34, 1],
    [-6, 1],
    [22, 1],
    [-20, -1],
    [10, -1],
  ];
  stands.forEach(([ds, side]) => {
    const st = cloneModel(kit, standId);
    if (!st) return;
    const sm = sampleAt(track, ds);
    const lat = side * (hw + VERGE + 6.5);
    const p = sm.p.clone().addScaledVector(sm.R, lat);
    if (distTrack(p.x, p.z) < hw + VERGE + 4 || !free(p.x, p.z, 10)) return;
    st.position.copy(p).setY(Math.max(-0.05, sm.p.y - Math.abs(Math.sin(sm.bank)) * 8));
    const toward = sm.R.clone().multiplyScalar(-side);
    st.rotation.y = Math.atan2(toward.x, toward.z);
    add(st);
    take(p.x, p.z, 12);
  });
  const balloonId = pick(kit, ["balloon_cluster"]);
  const postId = pick(kit, ["finish_banner_post", "flag"]);
  {
    const mats: THREE.Matrix4[] = [];
    const posts: THREE.Matrix4[] = [];
    for (let k = -3; k <= 3; k++) {
      const sm = sampleAt(track, k * 16 + 4);
      [-1, 1].forEach((side) => {
        const p = sectionPoint(sm, side * (hw + VERGE + 1.6), 0, new THREE.Vector3());
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), sm.yaw + (side > 0 ? Math.PI / 2 : -Math.PI / 2));
        if ((k + side + 10) % 3 === 0) mats.push(new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)));
        else posts.push(new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)));
      });
    }
    add(instanceModel(kit, balloonId, mats, false).group);
    add(instanceModel(kit, postId, posts, false).group);
  }

  // --- answer rows: gantry with its screen, boxes, cards and lane stripes
  const boxId = pick(kit, ["item_box_v2", "item_box"]);
  const boxV2 = boxId === "item_box_v2";
  const glassMats: THREE.MeshStandardMaterial[] = [];
  if (boxId)
    kit.models[boxId].traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        const mt = m.material as THREE.MeshStandardMaterial;
        if (mt.name.indexOf("glass_") === 0 && glassMats.indexOf(mt) < 0) glassMats.push(mt);
      }
    });
  const gantryId = pick(kit, ["gantry_v2", "question_gantry"]);
  const ltex = laneTexture();
  disposables.push(ltex);
  const rows: RowVis[] = track.rows.map((row) => {
    const group = new THREE.Group();
    let screen: CanvasTex | null = null;
    const gantry = cloneModel(kit, gantryId);
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
      const box = cloneModel(kit, boxId);
      if (box) {
        if (!boxV2) box.position.y = -0.75;
        holder.add(box);
      } else {
        holder.add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), new THREE.MeshStandardMaterial({ color: "#8b6cf0" })));
      }
      holder.visible = false;
      group.add(holder);
      boxes.push(holder);
      const card = answerSprite();
      card.sprite.visible = false;
      group.add(card.sprite);
      cards.push(card);
      const lt = ltex.clone();
      lt.needsUpdate = true;
      disposables.push(lt);
      const st = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ color: laneColor(k), map: lt, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
      );
      st.rotation.x = -Math.PI / 2;
      const sh = new THREE.Group();
      sh.add(st);
      sh.visible = false;
      group.add(sh);
      stripes.push(st);
    }
    add(group);
    return { group, boxes, cards, stripes, screen, respawn: [0, 0, 0, 0], lanes: 0 };
  });

  // --- boost pads and jump ramps
  const boostGlow: THREE.MeshStandardMaterial[] = [];
  const padId = pick(kit, ["boost_pad_v2", "boost_pad"]);
  track.boosts.forEach((bp) => {
    const pad = cloneModel(kit, padId);
    if (!pad) return;
    const sm = sampleAt(track, bp.s);
    pad.position.copy(pointAt(track, bp.s, bp.lat));
    pad.position.y += 0.04;
    pad.rotation.set(0, sm.yaw, 0);
    pad.rotateZ(sm.bank);
    pad.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = false;
        const mt = m.material as THREE.MeshStandardMaterial;
        if (/glow|boost/.test(mt.name)) {
          const c = mt.clone();
          m.material = c;
          boostGlow.push(c);
        }
      }
    });
    add(pad);
  });
  const rampId = pick(kit, ["jump_ramp"]);
  track.ramps.forEach((r) => {
    const sm = sampleAt(track, r.s - RAMP_LEN / 2);
    const ramp = cloneModel(kit, rampId);
    if (ramp) {
      ramp.position.copy(sm.p).addScaledVector(sm.R, r.lat);
      ramp.position.y += 0.03;
      ramp.rotation.y = sm.yaw;
      add(ramp);
    } else {
      // fallback wedge
      const g = new THREE.BufferGeometry();
      const W = 4.5,
        Lh = RAMP_LEN / 2;
      const v = new Float32Array([-W, 0, Lh, W, 0, Lh, -W, 1.6, -Lh, W, 1.6, -Lh, -W, 0, -Lh, W, 0, -Lh]);
      g.setAttribute("position", new THREE.BufferAttribute(v, 3));
      g.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 0, 2, 4, 1, 5, 3]);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: "#ffd23a", side: THREE.DoubleSide }));
      m.position.copy(sm.p);
      m.rotation.y = sm.yaw;
      add(m);
    }
  });

  // --- coins (instanced, hidden one by one when collected)
  const coinMats = track.coinLines.map((c) => {
    const sm = sampleAt(track, c.s);
    const p = pointAt(track, c.s, c.lat);
    return new THREE.Matrix4().compose(p.setY(p.y + 0.9), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), sm.yaw), new THREE.Vector3(1, 1, 1));
  });
  const ci = instanceModel(kit, "coin", coinMats, false);
  add(ci.group);
  const coins: CoinVis = { mesh: ci.meshes, locals: ci.locals, base: coinMats, hidden: coinMats.map(() => 0) };

  // --- tyre stacks outside the tight corners
  {
    const tyres: THREE.Matrix4[] = [];
    const tyreId = pick(kit, ["tire_stack", "tire_wall"]);
    for (let i = 0; i < N; i += 5) {
      const sm = S[i];
      if (Math.abs(sm.curv) > 1 / 60) {
        const side = sm.curv > 0 ? 1 : -1;
        const p = sectionPoint(sm, side * (hw + VERGE + 1.6), 0, new THREE.Vector3());
        tyres.push(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28), new THREE.Vector3(1, 1, 1)));
      }
    }
    add(instanceModel(kit, tyreId, tyres, false).group);
  }

  // --- roadside furniture (fences, street lamps + light pools) and neon arches
  th.roadside.forEach((rs) => {
    const id = pick(kit, rs.ids);
    if (!id) return;
    const mats: THREE.Matrix4[] = [];
    const pools: THREE.Matrix4[] = [];
    const every = Math.max(2, Math.round(rs.every / track.step));
    for (let i = 0; i < N; i += every) {
      const sm = S[i];
      if (sm.s < 30 || track.length - sm.s < 30) continue;
      const sides = rs.both ? [-1, 1] : [((i / every) | 0) % 18 < 9 ? 1 : -1];
      sides.forEach((side) => {
        const p = sectionPoint(sm, side * (hw + VERGE + 1.0 + rs.offset), 0, new THREE.Vector3());
        const yaw = sm.yaw + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
        mats.push(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1).multiplyScalar(rs.scale ?? 1)));
        if (rs.lightPool) {
          const q = sectionPoint(sm, side * (hw - 1.5), 0.06, new THREE.Vector3());
          pools.push(new THREE.Matrix4().compose(q, new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), new THREE.Vector3(11, 11, 1)));
        }
      });
    }
    add(instanceModel(kit, id, mats, false).group);
    if (pools.length && rs.lightPool) {
      const tex = radialTexture(rs.lightPool);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.22, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, pools.length);
      pools.forEach((M, k) => im.setMatrixAt(k, M));
      im.frustumCulled = false;
      im.renderOrder = 2;
      add(im);
      disposables.push(tex, mat);
    }
  });
  if (th.arches) {
    const ids = th.arches.ids.filter((id) => has(kit, id));
    if (ids.length) {
      const per: { [id: string]: THREE.Matrix4[] } = {};
      let k = 0;
      for (let s = 60; s < track.length - 40; s += th.arches.every) {
        const sm = sampleAt(track, s);
        if (Math.abs(sm.curv) > 1 / 50) continue;
        let near = false;
        track.rows.forEach((r) => {
          if (Math.abs(r.s - s) < 45) near = true;
        });
        track.ramps.forEach((r) => {
          if (Math.abs(r.s - s) < 30) near = true;
        });
        if (near) continue;
        const id = ids[k++ % ids.length];
        (per[id] = per[id] || []).push(new THREE.Matrix4().compose(sm.p.clone(), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sm.yaw, sm.bank, "YXZ")), new THREE.Vector3(1, 1, 1)));
      }
      Object.keys(per).forEach((id) => add(instanceModel(kit, id, per[id], false).group));
    }
  }

  // --- lakes
  const sky = new THREE.Color(opt.skyColor);
  const waters: THREE.ShaderMaterial[] = [];
  for (let w = 0, tries = 0; w < th.water && tries < 400; tries++) {
    const r = 26 + rnd() * 30;
    const x = cx + (rnd() - 0.5) * (ext + 300);
    const z = cz + (rnd() - 0.5) * (ext + 300);
    if (distTrack(x, z, 5) < r + hw + VERGE + 14 || !free(x, z, r + 6)) continue;
    const mat = new THREE.ShaderMaterial({
      vertexShader: WATER_V,
      fragmentShader: WATER_F,
      uniforms: {
        t: { value: 0 },
        deep: { value: new THREE.Color(th.waterColor).multiplyScalar(0.55) },
        shallow: { value: new THREE.Color(th.waterColor).lerp(new THREE.Color("#ffffff"), 0.35) },
        sky: { value: sky.clone() },
        sunDir: { value: opt.sunDir.clone() },
      },
      transparent: true,
      depthWrite: false,
    });
    const lake = new THREE.Mesh(new THREE.CircleGeometry(r, 48), mat);
    lake.rotation.x = -Math.PI / 2;
    lake.scale.set(1, 0.6 + rnd() * 0.5, 1);
    lake.position.set(x, 0.03, z);
    lake.renderOrder = 1;
    add(lake);
    const shoreMat = new THREE.MeshStandardMaterial({ color: "#e8d6a0", roughness: 1 });
    const shore = new THREE.Mesh(new THREE.RingGeometry(r * 0.97, r * 1.12, 48), shoreMat);
    shore.rotation.x = -Math.PI / 2;
    shore.scale.copy(lake.scale);
    shore.position.set(x, 0.02, z);
    add(shore);
    take(x, z, r + 4);
    waters.push(mat);
    disposables.push(mat, lake.geometry, shore.geometry, shoreMat);
    w++;
  }

  // --- landmarks (windmills, barns, mesas, city blocks...)
  const blades: THREE.Object3D[] = [];
  th.landmarks.forEach((lm) => {
    const ids = lm.ids.filter((id) => has(kit, id));
    if (!ids.length) return;
    const count = Math.max(1, Math.round(lm.count * Math.max(0.5, opt.scatter)));
    for (let k = 0, tries = 0; k < count && tries < 600; tries++) {
      const id = ids[k % ids.length];
      const src = kit.models[id];
      const bb = new THREE.Box3().setFromObject(src);
      const rad = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.55 * (lm.scale ? lm.scale[1] : 1);
      const a = rnd() * Math.PI * 2;
      const dist = lm.min + rnd() * (lm.max - lm.min);
      // pick a track point and go outwards from it
      const sm = S[Math.floor(rnd() * N)];
      const side = rnd() < 0.5 ? -1 : 1;
      const x = sm.p.x + sm.R.x * side * dist + Math.cos(a) * 6;
      const z = sm.p.z + sm.R.z * side * dist + Math.sin(a) * 6;
      if (distTrack(x, z, 6) < Math.max(lm.min, rad + hw + VERGE + 6) || !free(x, z, rad)) continue;
      const o = cloneModel(kit, id)!;
      const sc = lm.scale ? lm.scale[0] + rnd() * (lm.scale[1] - lm.scale[0]) : 1;
      o.scale.setScalar(sc);
      o.position.set(x, -0.06, z);
      // face the track
      o.rotation.y = Math.atan2(sm.p.x - x, sm.p.z - z) + (rnd() - 0.5) * 0.6;
      if (lm.animated) {
        const bl = findNode(o, "BLADES");
        if (bl) blades.push(bl);
      }
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh) m.castShadow = opt.shadows && rad < 30;
      });
      add(o);
      take(x, z, rad);
      k++;
    }
  });

  // --- scatter sets (instanced per model)
  const spanX = b.max.x - b.min.x + 520,
    spanZ = b.max.z - b.min.z + 520;
  th.scatter.forEach((set) => {
    const ids = set.ids.filter((id) => has(kit, id));
    if (!ids.length) return;
    const per: { [id: string]: THREE.Matrix4[] } = {};
    const c = set.cell / Math.sqrt(Math.max(0.15, opt.scatter));
    for (let gx = 0; gx < spanX / c; gx++)
      for (let gz = 0; gz < spanZ / c; gz++) {
        if (rnd() > set.prob) continue;
        const x = b.min.x - 260 + (gx + rnd()) * c;
        const z = b.min.z - 260 + (gz + rnd()) * c;
        const d = distTrack(x, z, 4);
        if (d < Math.max(set.min, hw + VERGE + 2.5) || d > set.max * opt.reach) continue;
        if (set.clear && !free(x, z, set.clear)) continue;
        const id = ids[Math.floor(rnd() * ids.length)];
        const sc = set.scale[0] + rnd() * (set.scale[1] - set.scale[0]);
        (per[id] = per[id] || []).push(new THREE.Matrix4().compose(new THREE.Vector3(x, -0.06, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28), new THREE.Vector3(sc, sc * (0.92 + rnd() * 0.2), sc)));
        if (set.clear) take(x, z, set.clear * 0.6);
      }
    Object.keys(per).forEach((id) => {
      const inst = instanceModel(kit, id, per[id], !!set.shadows && opt.shadows);
      if (set.wind) inst.meshes.forEach((m) => windify(m.material as THREE.Material, set.wind!));
      add(inst.group);
    });
  });

  // --- backdrop: layered silhouettes far away (fog blends them into the sky)
  {
    const R0 = ext / 2 + 520;
    const layers = th.backdrop.kind === "city" ? 1 : 2;
    for (let Lr = 0; Lr < layers; Lr++) {
      const R = R0 + Lr * 260;
      const H = th.backdrop.height * (1 + Lr * 0.7);
      const seg = 180;
      const pos = new Float32Array((seg + 1) * 3 * 3);
      const col = new Float32Array((seg + 1) * 3 * 3);
      const idx: number[] = [];
      const ca = new THREE.Color(th.backdrop.a).lerp(new THREE.Color(opt.skyColor), Lr * 0.35);
      const cb = new THREE.Color(th.backdrop.b).lerp(new THREE.Color(opt.skyColor), 0.25 + Lr * 0.3);
      const snow = new THREE.Color("#f4f7ff");
      const ph = rnd() * 10;
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        const n =
          th.backdrop.kind === "mesas"
            ? Math.max(0.25, Math.round((0.5 + 0.5 * Math.sin(a * 7 + ph) * Math.sin(a * 3 + ph * 2)) * 3) / 3)
            : 0.45 + 0.3 * Math.sin(a * 5 + ph) + 0.18 * Math.sin(a * 13 + ph * 3) + 0.07 * Math.sin(a * 31 + ph);
        const h = Math.max(0.1, n) * H;
        const dx = Math.sin(a),
          dz = Math.cos(a);
        const pts = [
          [cx + dx * R, -10, cz + dz * R],
          [cx + dx * (R + 30), h * 0.55, cz + dz * (R + 30)],
          [cx + dx * (R + 60), h, cz + dz * (R + 60)],
        ];
        pts.forEach((p, j) => {
          pos.set(p, (k * 3 + j) * 3);
          const c = j === 0 ? ca : j === 1 ? ca.clone().lerp(cb, 0.5) : th.backdrop.snow && n > 0.62 ? snow : cb;
          col.set([c.r, c.g, c.b], (k * 3 + j) * 3);
        });
        if (k < seg) {
          const q = k * 3;
          for (let j = 0; j < 2; j++) idx.push(q + j, q + j + 1, q + 3 + j, q + j + 1, q + 4 + j, q + 3 + j);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      g.setIndex(idx);
      const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true });
      const mesh = new THREE.Mesh(g, m);
      mesh.renderOrder = -1;
      add(mesh);
      disposables.push(g, m);
    }
  }

  // --- clouds and hot air balloons
  const sky3 = new THREE.Group();
  add(sky3);
  {
    const ids = ["cloud_a", "cloud_b"].filter((id) => has(kit, id));
    if (ids.length) {
      const per: { [id: string]: THREE.Matrix4[] } = {};
      const n = Math.round(th.clouds * Math.max(0.5, opt.scatter));
      for (let k = 0; k < n; k++) {
        const a = rnd() * Math.PI * 2;
        const r = 120 + rnd() * (ext / 2 + 500);
        const sc = 1.5 + rnd() * 2.5;
        const id = ids[k % ids.length];
        (per[id] = per[id] || []).push(new THREE.Matrix4().compose(new THREE.Vector3(Math.sin(a) * r, 90 + rnd() * 110, Math.cos(a) * r), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28), new THREE.Vector3(sc, sc * 0.8, sc)));
      }
      Object.keys(per).forEach((id) => sky3.add(instanceModel(kit, id, per[id], false).group));
      sky3.position.set(cx, 0, cz);
    }
  }
  const balloons: { o: THREE.Object3D; y: number; ph: number }[] = [];
  if (has(kit, "hot_air_balloon")) {
    for (let k = 0, tries = 0; k < th.balloons && tries < 100; tries++) {
      const x = cx + (rnd() - 0.5) * (ext + 200);
      const z = cz + (rnd() - 0.5) * (ext + 200);
      if (distTrack(x, z, 4) < 40) continue;
      const o = cloneModel(kit, "hot_air_balloon")!;
      const y = 35 + rnd() * 45;
      o.position.set(x, y, z);
      o.scale.setScalar(1.6 + rnd() * 0.8);
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh) m.castShadow = false;
      });
      add(o);
      balloons.push({ o, y, ph: rnd() * 6 });
      k++;
    }
  }

  // --- winners' podium beside the start straight (results)
  let podium: PodiumVis | null = null;
  {
    const pid = pick(kit, ["podium"]);
    const sm = podSm;
    const side = podSide;
    const p = podP;
    const g = cloneModel(kit, pid) || new THREE.Group();
    g.position.set(p.x, Math.max(-0.06, sm.p.y - 0.2), p.z);
    const toward = sm.R.clone().multiplyScalar(-side);
    const yaw = Math.atan2(toward.x, toward.z);
    g.rotation.y = yaw;
    add(g);
    g.updateMatrixWorld(true);
    const spots: THREE.Vector3[] = [];
    ["SPOT1", "SPOT2", "SPOT3"].forEach((nm, k) => {
      const n = findNode(g, nm);
      if (n) spots.push(n.getWorldPosition(new THREE.Vector3()));
      else spots.push(g.localToWorld(new THREE.Vector3([0, -3.2, 3.2][k], [1.6, 1.1, 0.8][k], 0)));
    });
    // framed to the left of the screen: the results card sits on the right
    const right = new THREE.Vector3(toward.z, 0, -toward.x);
    const camPos = g.position.clone().addScaledVector(toward, 11.5).setY(g.position.y + 3.4);
    const look = g.position.clone().addScaledVector(right, 3.8).setY(g.position.y + 1.8);
    const trophy: THREE.Object3D | null = cloneModel(kit, "trophy");
    if (trophy) {
      trophy.visible = false;
      add(trophy);
    }
    podium = { group: g, spots, yaw, camPos, look, trophy };
  }

  let boxHue = 0;
  return {
    root,
    rows,
    coins,
    lamps,
    boostGlow,
    podium,
    boxV2,
    update: (t: number, dt: number) => {
      windUniform.value = t;
      blades.forEach((bl) => (bl.rotation.z -= dt * 0.9));
      balloons.forEach((bb) => {
        bb.o.position.y = bb.y + Math.sin(t * 0.3 + bb.ph) * 3;
        bb.o.rotation.y += dt * 0.03;
      });
      sky3.rotation.y += dt * 0.004;
      waters.forEach((w) => (w.uniforms.t.value = t));
      boxHue = (boxHue + dt * 0.25) % 1;
      glassMats.forEach((m) => {
        m.emissive.setHSL(boxHue, 0.9, 0.55);
        m.emissiveIntensity = 0.55;
      });
    },
    dispose: () => {
      disposables.forEach((d) => d.dispose());
      // free every geometry this world built (the kit's own meshes stay loaded for the next cup)
      const keep = new Set<THREE.BufferGeometry>();
      Object.keys(kit.models).forEach((id) =>
        kit.models[id].traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) keep.add(m.geometry as THREE.BufferGeometry);
        })
      );
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        if ((m as THREE.InstancedMesh).isInstancedMesh) (m as THREE.InstancedMesh).dispose();
        if (!keep.has(m.geometry as THREE.BufferGeometry)) m.geometry.dispose();
      });
      rows.forEach((r) => {
        r.cards.forEach((c) => c.ct.tex.dispose());
        if (r.screen) r.screen.tex.dispose();
      });
    },
  };
}

/** Lays out a row for a question with `lanes` answers: boxes, cards and lane stripes. */
export function layoutRow(track: BuiltTrack, vis: RowVis, rowS: number, lanes: number, boxV2: boolean) {
  const hw = track.halfW;
  const w = (hw * 2) / lanes;
  const centers: number[] = [];
  for (let k = 0; k < lanes; k++) centers.push(-hw + w * (k + 0.5));
  vis.lanes = lanes;
  for (let k = 0; k < 4; k++) {
    const on = k < lanes;
    const box = vis.boxes[k];
    box.visible = on;
    vis.cards[k].sprite.visible = on;
    (vis.stripes[k].parent as THREE.Object3D).visible = on;
    if (!on) continue;
    const p = pointAt(track, rowS, centers[k]);
    box.position.copy(p).setY(p.y + (boxV2 ? 1.25 : 1.2));
    box.userData.baseY = box.position.y;
    vis.cards[k].sprite.position.copy(box.position).setY(p.y + 4.2);
    // stripe: 28 m long, ending at the row
    const ss = sampleAt(track, rowS - 15);
    const holder = vis.stripes[k].parent as THREE.Object3D;
    const sp = pointAt(track, rowS - 15, centers[k]);
    holder.position.copy(sp).setY(sp.y + 0.07);
    holder.rotation.set(0, ss.yaw, 0);
    holder.rotateZ(ss.bank);
    vis.stripes[k].scale.set(w - 0.9, 28, 1);
    const map = (vis.stripes[k].material as THREE.MeshBasicMaterial).map;
    if (map) map.repeat.set(1, 6);
  }
  return centers;
}

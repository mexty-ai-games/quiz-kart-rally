/**
 * One pooled particle system (GPU points) for every effect: drift sparks, mini-turbo flames,
 * dust on the grass, confetti on right answers, stars on a spin-out, coin glints.
 */
import * as THREE from "three";

const MAX = 1400;

const vert = /* glsl */ `
attribute float size;
attribute vec3 color;
attribute float alpha;
varying vec3 vColor;
varying float vAlpha;
uniform float scale;
void main() {
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // particles right in front of the lens fade out instead of becoming big blurry blobs
  vAlpha = alpha * smoothstep(1.2, 4.5, -mv.z);
  gl_PointSize = min(size * scale / max(0.5, -mv.z), 96.0);
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  float a = smoothstep(0.5, 0.0, r) * vAlpha;
  gl_FragColor = vec4(vColor * (1.0 + (1.0 - r * 2.0) * GLOW), a);
}`;

interface P {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  grav: number;
  drag: number;
  r: number;
  g: number;
  b: number;
}

class Particles {
  points: THREE.Points;
  private geo = new THREE.BufferGeometry();
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 3);
  private siz = new Float32Array(MAX);
  private alp = new Float32Array(MAX);
  private ps: P[] = [];
  private mat: THREE.ShaderMaterial;
  private c = new THREE.Color();
  budget = 1;

  constructor(additive: boolean) {
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("size", new THREE.BufferAttribute(this.siz, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("alpha", new THREE.BufferAttribute(this.alp, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { scale: { value: 300 } },
      defines: { GLOW: additive ? "1.6" : "0.0" },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 4;
  }

  setViewport(h: number) {
    this.mat.uniforms.scale.value = h * 0.6;
  }

  emit(n: number, at: THREE.Vector3, o: { color: string | string[]; speed?: number; up?: number; spread?: number; size?: number; life?: number; grav?: number; drag?: number; dir?: THREE.Vector3 }) {
    const count = Math.max(1, Math.round(n * this.budget));
    const cols = Array.isArray(o.color) ? o.color : [o.color];
    for (let k = 0; k < count; k++) {
      if (this.ps.length >= MAX) this.ps.shift();
      const sp = (o.speed ?? 4) * (0.5 + Math.random() * 0.8);
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.3) * (o.spread ?? 1);
      let vx = Math.cos(a) * sp * Math.cos(e),
        vz = Math.sin(a) * sp * Math.cos(e);
      let vy = (o.up ?? 2) * (0.5 + Math.random());
      if (o.dir) {
        vx = vx * 0.35 + o.dir.x * sp;
        vy = vy * 0.6 + o.dir.y * sp;
        vz = vz * 0.35 + o.dir.z * sp;
      }
      this.c.set(cols[k % cols.length]);
      const life = (o.life ?? 0.7) * (0.6 + Math.random() * 0.7);
      this.ps.push({
        x: at.x + (Math.random() - 0.5) * 0.4,
        y: at.y + (Math.random() - 0.5) * 0.3,
        z: at.z + (Math.random() - 0.5) * 0.4,
        vx,
        vy,
        vz,
        life,
        max: life,
        size: (o.size ?? 0.35) * (0.6 + Math.random() * 0.8),
        grav: o.grav ?? 9,
        drag: o.drag ?? 1.5,
        r: this.c.r,
        g: this.c.g,
        b: this.c.b,
      });
    }
  }

  update(dt: number) {
    const ps = this.ps;
    let w = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vz *= k;
      p.vy = p.vy * k - p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      ps[w++] = p;
    }
    ps.length = w;
    for (let i = 0; i < w; i++) {
      const p = ps[i];
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      this.col[i * 3] = p.r;
      this.col[i * 3 + 1] = p.g;
      this.col[i * 3 + 2] = p.b;
      this.siz[i] = p.size;
      this.alp[i] = Math.min(1, (p.life / p.max) * 2);
    }
    this.geo.setDrawRange(0, w);
    (["position", "color", "size", "alpha"] as const).forEach((a) => ((this.geo.getAttribute(a) as THREE.BufferAttribute).needsUpdate = true));
  }

  clear() {
    this.ps.length = 0;
    this.geo.setDrawRange(0, 0);
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

export type EmitOpts = { color: string | string[]; speed?: number; up?: number; spread?: number; size?: number; life?: number; grav?: number; drag?: number; dir?: THREE.Vector3; add?: boolean };

/** Two pooled layers: normal (dust, confetti, smoke) and additive (sparks, flames, glints). */
export class Fx {
  private normal = new Particles(false);
  private glow = new Particles(true);
  objects: THREE.Object3D[] = [this.normal.points, this.glow.points];
  set budget(b: number) {
    this.normal.budget = b;
    this.glow.budget = b;
  }
  setViewport(h: number) {
    this.normal.setViewport(h);
    this.glow.setViewport(h);
  }
  emit(n: number, at: THREE.Vector3, o: EmitOpts) {
    (o.add ? this.glow : this.normal).emit(n, at, o);
  }
  update(dt: number) {
    this.normal.update(dt);
    this.glow.update(dt);
  }
  clear() {
    this.normal.clear();
    this.glow.clear();
  }
  dispose() {
    this.normal.dispose();
    this.glow.dispose();
  }
}

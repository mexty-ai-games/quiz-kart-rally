/**
 * Tyre marks: a pooled ribbon of quads laid on the road behind drifting / braking karts,
 * fading out over a few seconds. One draw call for every kart.
 */
import * as THREE from "three";

const MAX = 1600;
const LIFE = 7;

export class Skids {
  mesh: THREE.Mesh;
  private pos = new Float32Array(MAX * 4 * 3);
  private alpha = new Float32Array(MAX * 4);
  private born = new Float32Array(MAX);
  private strength = new Float32Array(MAX);
  private next = 0;
  private time = 0;
  private geo = new THREE.BufferGeometry();
  private last: { [key: string]: { l: THREE.Vector3; r: THREE.Vector3 } | undefined } = {};
  color = new THREE.Color("#1d1a2c");

  constructor() {
    const idx = new Uint32Array(MAX * 6);
    for (let q = 0; q < MAX; q++) {
      const a = q * 4;
      idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], q * 6);
    }
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("alpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 col; varying float vA; void main(){ gl_FragColor = vec4(col, vA * 0.55); }`,
      uniforms: { col: { value: this.color } },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Continue a mark for `key` (one per wheel) at the given ground point. */
  mark(key: string, at: THREE.Vector3, side: THREE.Vector3, width: number, strength: number) {
    const hw = width / 2;
    const l = at.clone().addScaledVector(side, -hw);
    const r = at.clone().addScaledVector(side, hw);
    l.y += 0.045;
    r.y += 0.045;
    const prev = this.last[key];
    if (prev && prev.l.distanceToSquared(l) < 9) {
      const q = this.next;
      this.next = (this.next + 1) % MAX;
      const o = q * 12;
      this.pos.set([prev.l.x, prev.l.y, prev.l.z, prev.r.x, prev.r.y, prev.r.z, l.x, l.y, l.z, r.x, r.y, r.z], o);
      this.born[q] = this.time;
      this.strength[q] = strength;
      (this.geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    }
    this.last[key] = { l, r };
  }
  /** The wheel stopped marking. */
  lift(key: string) {
    this.last[key] = undefined;
  }

  update(dt: number) {
    this.time += dt;
    for (let q = 0; q < MAX; q++) {
      const age = this.time - this.born[q];
      const a = this.born[q] > 0 && age < LIFE ? (1 - age / LIFE) * this.strength[q] : 0;
      const o = q * 4;
      this.alpha[o] = this.alpha[o + 1] = this.alpha[o + 2] = this.alpha[o + 3] = a;
    }
    (this.geo.getAttribute("alpha") as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() {
    this.born.fill(0);
    this.last = {};
  }

  dispose() {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

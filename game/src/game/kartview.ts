/**
 * Everything drawn for one kart: the Kenney model (wheels turn and steer, the driver leans),
 * a soft blob shadow, exhaust flames that grow with boosts, a fresnel bubble for the shield,
 * a rainbow glow for super nova, squash on landing, barrel rolls for tricks and a name tag.
 */
import * as THREE from "three";
import type { Kart } from "./kart";
import { nameTag } from "./labels";

let blobTex: THREE.Texture | null = null;
function blobTexture() {
  if (blobTex) return blobTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  gr.addColorStop(0, "rgba(0,0,0,0.55)");
  gr.addColorStop(0.6, "rgba(0,0,0,0.3)");
  gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}

const FLAME_V = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const FLAME_F = /* glsl */ `
varying vec2 vUv;
uniform vec3 cA; uniform vec3 cB; uniform float t; uniform float k;
void main(){
  float y = vUv.y; // 0 at the nozzle, 1 at the tip
  float flick = 0.75 + 0.25 * sin(t * 47.0 + vUv.x * 12.0) * sin(t * 31.0);
  float a = (1.0 - y) * flick * k;
  vec3 c = mix(cA, cB, y);
  gl_FragColor = vec4(c * (1.6 + 1.4 * (1.0 - y)), a);
}`;

const SHIELD_V = /* glsl */ `
varying vec3 vN; varying vec3 vV;
void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const SHIELD_F = /* glsl */ `
varying vec3 vN; varying vec3 vV; uniform float t; uniform vec3 col;
void main(){
  float f = pow(1.0 - abs(dot(vN, vV)), 2.2);
  float band = 0.5 + 0.5 * sin(vN.y * 14.0 + t * 4.0);
  gl_FragColor = vec4(col * (1.2 + band * 0.8), f * 0.85 + 0.05);
}`;

export class KartView {
  root = new THREE.Group();
  /** tilts with the road (roll/pitch) */
  tilt = new THREE.Group();
  /** yaw offsets (drift angle, spin-out), squash, hop and tricks */
  body = new THREE.Group();
  wheelsF: THREE.Object3D[] = [];
  wheelsB: THREE.Object3D[] = [];
  character: THREE.Object3D | null = null;
  shield: THREE.Mesh;
  tag: THREE.Sprite | null = null;
  blob: THREE.Mesh;
  glow: THREE.Mesh;
  private glowTex: THREE.Texture;
  private flames: THREE.Mesh[] = [];
  private flameMat: THREE.ShaderMaterial;
  private shieldMat: THREE.ShaderMaterial;
  private glowMats: THREE.MeshStandardMaterial[] = [];
  private trickRoll = 0;
  /** hide the name tag (podium) */
  noTag = false;
  /** underglow strength: set per theme (night karts glow more) */
  glowLevel = 0.45;
  /** drift spark emit points (local, rear wheels) */
  sparkL = new THREE.Vector3(-0.62, 0.15, 0.85);
  sparkR = new THREE.Vector3(0.62, 0.15, 0.85);
  exhaust = new THREE.Vector3(0, 0.5, 1.25);

  constructor(src: THREE.Object3D | null, color: string, name: string | null) {
    this.root.add(this.tilt);
    this.tilt.add(this.body);
    if (src) {
      const m = src.clone(true);
      // the Kenney karts face +Z; our forward is -Z
      m.rotation.y = Math.PI;
      m.traverse((o) => {
        const nm = o.name.toLowerCase();
        if (nm.indexOf("wheel-front") === 0) this.wheelsF.push(o);
        else if (nm.indexOf("wheel-back") === 0) this.wheelsB.push(o);
        else if (nm === "character") this.character = o;
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          // own materials so the nova glow only lights this kart
          const mt = (mesh.material as THREE.MeshStandardMaterial).clone();
          mt.emissive = new THREE.Color(0, 0, 0);
          mesh.material = mt;
          this.glowMats.push(mt);
        }
      });
      this.body.add(m);
    } else {
      const fb = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 2.4), new THREE.MeshStandardMaterial({ color }));
      fb.position.y = 0.5;
      this.body.add(fb);
    }
    // blob shadow (always: it grounds the kart even without shadow maps)
    this.blob = new THREE.Mesh(
      new THREE.PlaneGeometry(2.3, 3.0),
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    );
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.06;
    this.blob.renderOrder = 2;
    this.tilt.add(this.blob);
    // underglow in the racer's colour: tells karts apart at a glance (brighter at night)
    {
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const g = c.getContext("2d")!;
      const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
      gr.addColorStop(0, "rgba(255,255,255,0.9)");
      gr.addColorStop(0.5, "rgba(255,255,255,0.35)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
      this.glowTex = new THREE.CanvasTexture(c);
      this.glow = new THREE.Mesh(
        new THREE.PlaneGeometry(3.4, 4.2),
        new THREE.MeshBasicMaterial({ map: this.glowTex, color, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })
      );
      this.glow.rotation.x = -Math.PI / 2;
      this.glow.position.y = 0.07;
      this.glow.renderOrder = 3;
      this.tilt.add(this.glow);
    }
    // exhaust flames
    this.flameMat = new THREE.ShaderMaterial({
      vertexShader: FLAME_V,
      fragmentShader: FLAME_F,
      uniforms: { cA: { value: new THREE.Color("#fff3a0") }, cB: { value: new THREE.Color("#ff5a1e") }, t: { value: 0 }, k: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const fg = new THREE.ConeGeometry(0.2, 1.3, 10, 1, true);
    fg.translate(0, -0.65, 0);
    fg.rotateX(-Math.PI / 2); // points to +Z (backwards)
    // uv.y: 0 at the nozzle → 1 at the tip
    const uv = fg.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    [-0.32, 0.32].forEach((x) => {
      const f = new THREE.Mesh(fg, this.flameMat);
      f.position.set(x, 0.48, 1.1);
      f.visible = false;
      f.renderOrder = 7;
      this.body.add(f);
      this.flames.push(f);
    });
    // shield bubble
    this.shieldMat = new THREE.ShaderMaterial({
      vertexShader: SHIELD_V,
      fragmentShader: SHIELD_F,
      uniforms: { t: { value: 0 }, col: { value: new THREE.Color("#5fd0ff") } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(1.8, 24, 16), this.shieldMat);
    this.shield.position.y = 1.0;
    this.shield.visible = false;
    this.shield.renderOrder = 8;
    this.tilt.add(this.shield);
    if (name) {
      this.tag = nameTag(name, color);
      this.tag.position.y = 3.1;
      this.root.add(this.tag);
    }
  }

  setTag(name: string, color: string) {
    if (!this.tag) return;
    this.root.remove(this.tag);
    this.tag = nameTag(name, color);
    this.tag.position.y = 3.1;
    this.root.add(this.tag);
  }

  setShadowCasting(on: boolean) {
    this.body.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material !== this.flameMat) m.castShadow = on;
    });
  }

  /** Copies the kart's state onto the model. `boostLevel`: 0 none, 1 boost, 2 big (mini-turbo / trick). */
  update(k: Kart, t: number, dt: number, camPos: THREE.Vector3) {
    this.root.position.copy(k.p);
    this.root.rotation.y = k.yaw;
    this.tilt.rotation.set(k.pitch, 0, k.roll, "YXZ");
    // tricks: a quick barrel roll in the air
    if (k.trickT > 0) this.trickRoll = (1 - k.trickT / 0.45) * Math.PI * 2 * k.trickDir;
    else this.trickRoll += (0 - this.trickRoll) * Math.min(1, dt * 20);
    const sq = k.squash;
    this.body.scale.set(1 + sq * 0.25, 1 - sq * 0.45, 1 + sq * 0.15);
    this.body.rotation.set(0, k.spinYaw + (k.drifting ? k.driftDir * -0.34 : 0), 0);
    this.body.rotation.z = (k.drifting ? k.driftDir * 0.06 : -k.steerSm * 0.045 * Math.min(1, k.speed / 15)) + this.trickRoll;
    this.body.position.y = Math.sin(Math.min(1, k.hop / 0.35) * Math.PI) * 0.35;
    this.wheelsF.forEach((wh) => {
      wh.rotation.x = k.wheelSpin;
      wh.rotation.y = -k.steerSm * 0.45;
    });
    this.wheelsB.forEach((wh) => (wh.rotation.x = k.wheelSpin));
    if (this.character) this.character.rotation.z = k.steerSm * 0.14;
    // blob shadow stays on the ground while flying
    const above = k.air ? Math.max(0, k.p.y - k.loc.y) : 0;
    this.blob.position.y = 0.06 - above;
    const bs = 1 / (1 + above * 0.25);
    this.blob.scale.set(bs, bs, 1);
    (this.blob.material as THREE.MeshBasicMaterial).opacity = bs;
    this.glow.position.y = 0.07 - above;
    (this.glow.material as THREE.MeshBasicMaterial).opacity = this.glowLevel * bs * (k.boostT > 0 ? 1.4 : 1);
    // flames
    const boost = k.boostT > 0 ? 1 : 0;
    this.flameMat.uniforms.t.value = t;
    const want = boost ? Math.min(1, 0.5 + k.boostT) : 0;
    const kk = this.flameMat.uniforms.k.value as number;
    this.flameMat.uniforms.k.value = kk + (want - kk) * Math.min(1, dt * 12);
    const fl = this.flameMat.uniforms.k.value as number;
    this.flames.forEach((f, i) => {
      f.visible = fl > 0.03;
      const s = 0.4 + fl * 1.2 + Math.sin(t * 50 + i * 2) * 0.08 * fl;
      f.scale.set(0.8 + fl * 0.5, 0.8 + fl * 0.5, s);
    });
    if (k.novaT > 0) {
      this.flameMat.uniforms.cB.value.setHSL((t * 0.8) % 1, 1, 0.55);
    } else this.flameMat.uniforms.cB.value.set(boost ? "#ff5a1e" : "#ff8a3a");
    // shield
    this.shield.visible = k.shieldT > 0;
    if (this.shield.visible) {
      this.shieldMat.uniforms.t.value = t;
      this.shield.scale.setScalar(1 + Math.sin(t * 6) * 0.03);
    }
    // nova: rainbow glow
    if (k.novaT > 0) {
      const h = (t * 0.9) % 1;
      this.glowMats.forEach((m) => {
        m.emissive.setHSL(h, 1, 0.5);
        m.emissiveIntensity = 0.55 + 0.25 * Math.sin(t * 12);
      });
    } else if (this.glowMats.length && this.glowMats[0].emissiveIntensity !== 0) {
      this.glowMats.forEach((m) => {
        m.emissive.setRGB(0, 0, 0);
        m.emissiveIntensity = 0;
      });
    }
    if (this.tag) {
      const d2 = camPos.distanceToSquared(k.p);
      this.tag.visible = !this.noTag && d2 > 9 * 9 && d2 < 110 * 110;
    }
  }

  /** World position of a local point on the kart body. */
  world(local: THREE.Vector3, out: THREE.Vector3) {
    return this.body.localToWorld(out.copy(local));
  }

  dispose() {
    if (this.flames[0]) this.flames[0].geometry.dispose();
    this.shield.geometry.dispose();
    this.blob.geometry.dispose();
    (this.blob.material as THREE.Material).dispose();
    this.glow.geometry.dispose();
    this.glowTex.dispose();
    (this.glow.material as THREE.Material).dispose();
    this.flameMat.dispose();
    this.shieldMat.dispose();
    this.glowMats.forEach((m) => m.dispose());
  }
}

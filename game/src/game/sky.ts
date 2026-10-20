/** Procedural sky (from Turbo Gates) (gradient, sun, drifting clouds, stars) and the lighting moods. */
import * as THREE from "three";

export type Mood = "morning" | "day" | "sunset" | "night";

export interface MoodDef {
  zenith: string;
  horizon: string;
  ground: string;
  sunElev: number; // degrees
  sunAzim: number; // degrees
  sunColor: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  clouds: number;
  stars: number;
  exposure: number;
  fogNear: number;
  fogFar: number;
  lampGlow: number; // emissive multiplier for floodlights
}

export const MOODS: Record<Mood, MoodDef> = {
  day: {
    zenith: "#1f63d4",
    horizon: "#cfe6ff",
    ground: "#8aa36a",
    sunElev: 52,
    sunAzim: 35,
    sunColor: "#fff6e8",
    sunIntensity: 3.0,
    hemiSky: "#cfe4ff",
    hemiGround: "#5d7a3a",
    hemiIntensity: 1.05,
    clouds: 0.75,
    stars: 0,
    exposure: 1.0,
    fogNear: 700,
    fogFar: 4200,
    lampGlow: 0.6,
  },
  morning: {
    zenith: "#3f78c9",
    horizon: "#ffe1bf",
    ground: "#8f9a6a",
    sunElev: 16,
    sunAzim: -60,
    sunColor: "#ffd9a8",
    sunIntensity: 2.7,
    hemiSky: "#ffe2c4",
    hemiGround: "#4f6436",
    hemiIntensity: 0.95,
    clouds: 0.55,
    stars: 0,
    exposure: 1.05,
    fogNear: 500,
    fogFar: 3600,
    lampGlow: 0.6,
  },
  sunset: {
    zenith: "#26357a",
    horizon: "#ff9a5c",
    ground: "#6a5a48",
    sunElev: 6,
    sunAzim: 140,
    sunColor: "#ffa766",
    sunIntensity: 2.4,
    hemiSky: "#ffb48a",
    hemiGround: "#3e3a30",
    hemiIntensity: 0.9,
    clouds: 0.85,
    stars: 0.2,
    exposure: 1.1,
    fogNear: 400,
    fogFar: 3200,
    lampGlow: 1.6,
  },
  night: {
    zenith: "#030714",
    horizon: "#1b2a55",
    ground: "#141a22",
    sunElev: 62,
    sunAzim: 20,
    sunColor: "#dfe8ff",
    sunIntensity: 1.5,
    hemiSky: "#5070b0",
    hemiGround: "#202820",
    hemiIntensity: 0.75,
    clouds: 0.25,
    stars: 1.0,
    exposure: 1.15,
    fogNear: 300,
    fogFar: 2600,
    lampGlow: 4.0,
  },
};

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const frag = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 zenith; uniform vec3 horizon; uniform vec3 ground;
uniform vec3 sunDir; uniform vec3 sunColor;
uniform float clouds; uniform float stars; uniform float time;
float hash(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=0.5; float s=0.0; for(int i=0;i<OCT;i++){ s+=a*noise(p); p*=2.03; a*=0.5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(horizon, zenith, pow(clamp(h,0.0,1.0), 0.55));
  if (h < 0.0) col = mix(horizon, ground, clamp(-h*5.0, 0.0, 1.0));
  float sd = max(dot(d, sunDir), 0.0);
  col += sunColor * (pow(sd, 900.0) * 30.0 + pow(sd, 12.0) * 0.35 + pow(sd, 3.0) * 0.08);
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.12);
    float c = fbm(vec3(uv * 1.3 + vec2(time * 0.004, time * 0.002), time * 0.002));
    float m = smoothstep(0.52 - clouds * 0.18, 0.85, c) * smoothstep(0.0, 0.18, h) * clouds;
    vec3 cc = mix(horizon * 1.05, vec3(1.0), 0.55) * (0.75 + 0.45 * pow(sd, 2.0)) + sunColor * pow(sd, 6.0) * 0.3;
    col = mix(col, cc, m);
    float st = step(0.9975, hash(floor(d * 420.0)));
    col += vec3(st) * stars * smoothstep(0.05, 0.35, h) * (1.0 - m);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Sky {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  sunDir = new THREE.Vector3();
  constructor() {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      defines: { OCT: 5 },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      uniforms: {
        zenith: { value: new THREE.Color() },
        horizon: { value: new THREE.Color() },
        ground: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunColor: { value: new THREE.Color() },
        clouds: { value: 0.5 },
        stars: { value: 0 },
        time: { value: 0 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), this.mat);
    this.mesh.frustumCulled = false;
    // Drawn AFTER the opaque scene: it sits on the far plane (xyww), so the depth test skips every
    // pixel already covered by the road, stands and lawn instead of running the cloud noise there.
    this.mesh.renderOrder = 1000;
  }
  /** Cloud noise octaves: 5 on High, 3 on Low. */
  setDetail(octaves: number) {
    const defs = this.mat.defines as Record<string, number>;
    if (defs.OCT === octaves) return;
    defs.OCT = octaves;
    this.mat.needsUpdate = true;
  }
  apply(m: MoodDef) {
    const u = this.mat.uniforms;
    u.zenith.value.set(m.zenith);
    u.horizon.value.set(m.horizon);
    u.ground.value.set(m.ground);
    u.sunColor.value.set(m.sunColor);
    u.clouds.value = m.clouds;
    u.stars.value = m.stars;
    const e = THREE.MathUtils.degToRad(m.sunElev),
      a = THREE.MathUtils.degToRad(m.sunAzim);
    this.sunDir.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)).normalize();
    u.sunDir.value.copy(this.sunDir);
  }
}

/** Environment map for reflections, rendered from the sky (plus a bright ground bounce). */
export function skyEnvironment(renderer: THREE.WebGLRenderer, sky: Sky): THREE.Texture {
  const pm = new THREE.PMREMGenerator(renderer);
  const sc = new THREE.Scene();
  const m = new THREE.Mesh(sky.mesh.geometry, sky.mat);
  sc.add(m);
  const rt = pm.fromScene(sc, 0.02, 0.1, 6000);
  pm.dispose();
  return rt.texture;
}

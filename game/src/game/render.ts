/**
 * Renderer + post-processing, picked per GPU tier:
 *  ultra  discrete GPU: 2x DPR cap, 2048 soft shadows, SMAA, HDR bloom, vignette, chromatic aberration on boost
 *  high   good GPU: 1.5x DPR, 1024 shadows, SMAA, bloom
 *  medium integrated / mobile: 1.25x DPR, blob shadows only, FXAA, half-res bloom
 *  low    software rendering / very weak: 1x DPR, no post stack, minimal scenery
 * A frame-time governor scales the resolution (and steps the tier down when that is not enough).
 */
import * as THREE from "three";
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  SMAAEffect,
  FXAAEffect,
  VignetteEffect,
  ToneMappingEffect,
  ToneMappingMode,
  ChromaticAberrationEffect,
  Effect,
  BlendFunction,
  SMAAPreset,
} from "postprocessing";
import { gpuInfo } from "./perf";

export type Tier = "ultra" | "high" | "medium" | "low";
export const TIERS: Tier[] = ["low", "medium", "high", "ultra"];

export interface TierDef {
  dpr: number;
  shadows: number; // shadow map size, 0 = off
  post: boolean;
  aa: "smaa" | "fxaa" | "none";
  bloomScale: number;
  scatter: number; // scenery density multiplier
  particles: number;
  skyOct: number;
  far: number;
  chroma: boolean;
}

export const TIER_DEFS: Record<Tier, TierDef> = {
  ultra: { dpr: 2, shadows: 2048, post: true, aa: "smaa", bloomScale: 1, scatter: 1, particles: 1, skyOct: 5, far: 2600, chroma: true },
  high: { dpr: 1.5, shadows: 1024, post: true, aa: "smaa", bloomScale: 0.75, scatter: 0.85, particles: 0.85, skyOct: 4, far: 2200, chroma: true },
  medium: { dpr: 1.25, shadows: 0, post: true, aa: "fxaa", bloomScale: 0.5, scatter: 0.6, particles: 0.6, skyOct: 3, far: 1600, chroma: false },
  low: { dpr: 1, shadows: 0, post: false, aa: "none", bloomScale: 0, scatter: 0.35, particles: 0.35, skyOct: 2, far: 1100, chroma: false },
};

/** Best starting tier for this device. */
export function autoTier(): Tier {
  const g = gpuInfo();
  if (g.software) return "low";
  const coarse = typeof window !== "undefined" && !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  if (g.weak || coarse) return "medium";
  const n = g.name.toLowerCase();
  if (/rtx|rx [5-9]\d{3}|radeon pro|apple m\d (pro|max|ultra)|arc a7/.test(n)) return "ultra";
  return "high";
}

const SPEED_FRAG = /* glsl */ `
uniform float strength;
uniform float time;
uniform float aspect;
float h1(float n){ return fract(sin(n) * 43758.5453); }
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 c = uv - vec2(0.5, 0.46);
  c.x *= aspect;
  float r = length(c);
  float a = atan(c.y, c.x);
  float id = floor(a * 70.0);
  float n = h1(id);
  float lane = step(0.62, n);
  float run = fract(r * 1.6 - time * (2.2 + n * 2.0) + n * 7.0);
  float streak = lane * smoothstep(0.0, 0.08, run) * (1.0 - smoothstep(0.08, 0.5, run));
  float edge = smoothstep(0.42, 0.95, r);
  float s = streak * edge * strength;
  vec3 col = mix(inputColor.rgb, vec3(1.0), s * 0.38);
  // darker, tighter edges at speed
  col *= 1.0 - edge * edge * strength * 0.25;
  outputColor = vec4(col, inputColor.a);
}`;

export class Renderer {
  renderer: THREE.WebGLRenderer;
  tier: Tier;
  def: TierDef;
  scale = 1;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloom: BloomEffect | null = null;
  private chroma: ChromaticAberrationEffect | null = null;
  private speed: Effect | null = null;
  private vignette: VignetteEffect | null = null;
  private frameMs: number[] = [];
  private w = 1;
  private h = 1;
  onTierChange: (t: Tier) => void = () => {};
  /** set by the game: allowed to auto step the tier down */
  autoTier = true;

  constructor(private canvas: HTMLCanvasElement, tier: Tier, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    this.tier = tier;
    this.def = TIER_DEFS[tier];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", stencil: false, depth: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.apply();
  }

  get gl() {
    return this.renderer;
  }

  setTier(t: Tier) {
    if (t === this.tier) return;
    this.tier = t;
    this.def = TIER_DEFS[t];
    this.apply();
    this.onTierChange(t);
  }

  private apply() {
    const d = this.def;
    const r = this.renderer;
    r.shadowMap.enabled = d.shadows > 0;
    this.disposeComposer();
    if (d.post) {
      r.toneMapping = THREE.NoToneMapping;
      const composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
      this.renderPass = new RenderPass(this.scene, this.camera);
      composer.addPass(this.renderPass);
      this.bloom = new BloomEffect({
        mipmapBlur: true,
        luminanceThreshold: 0.82,
        luminanceSmoothing: 0.25,
        intensity: 1.05,
        radius: 0.72,
        resolutionScale: d.bloomScale,
      });
      this.speed = new Effect("SpeedLines", SPEED_FRAG, {
        blendFunction: BlendFunction.NORMAL,
        uniforms: new Map<string, THREE.Uniform>([
          ["strength", new THREE.Uniform(0)],
          ["time", new THREE.Uniform(0)],
          ["aspect", new THREE.Uniform(1)],
        ]),
      });
      this.vignette = new VignetteEffect({ offset: 0.32, darkness: 0.42 });
      const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
      const effects: Effect[] = [this.bloom, this.speed, this.vignette, tone];
      if (d.chroma) {
        this.chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0, 0), radialModulation: true, modulationOffset: 0.35 });
      }
      composer.addPass(new EffectPass(this.camera, ...effects));
      const aaPass = d.aa === "smaa" ? new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.HIGH })) : d.aa === "fxaa" ? new EffectPass(this.camera, new FXAAEffect()) : null;
      if (this.chroma) composer.addPass(new EffectPass(this.camera, this.chroma));
      if (aaPass) composer.addPass(aaPass);
      this.composer = composer;
    } else {
      r.toneMapping = THREE.ACESFilmicToneMapping;
    }
    this.setPixelRatio();
    this.resize(this.w, this.h);
  }

  private disposeComposer() {
    if (this.composer) this.composer.dispose();
    this.composer = null;
    this.bloom = null;
    this.chroma = null;
    this.speed = null;
    this.vignette = null;
  }

  setExposure(e: number) {
    this.renderer.toneMappingExposure = e;
  }

  private setPixelRatio() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.def.dpr);
    this.renderer.setPixelRatio(Math.max(0.5, dpr * this.scale));
  }

  resize(w: number, h: number) {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.setPixelRatio();
    this.renderer.setSize(this.w, this.h, false);
    if (this.composer) this.composer.setSize(this.w, this.h, false);
    if (this.speed) this.speed.uniforms.get("aspect")!.value = this.w / this.h;
  }

  /** Per-frame look: speed lines and colour fringing at high speed / boost, bloom strength per mood. */
  setLook(o: { speed: number; boost: number; time: number; bloom: number }) {
    if (this.speed) {
      this.speed.uniforms.get("strength")!.value = o.speed;
      this.speed.uniforms.get("time")!.value = o.time;
    }
    if (this.chroma) {
      const k = 0.0016 * o.boost;
      this.chroma.offset.set(k, k * 0.6);
    }
    if (this.bloom) this.bloom.intensity = o.bloom;
    if (this.vignette) this.vignette.darkness = 0.4 + o.boost * 0.18;
  }

  render(dt: number) {
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  /** Adaptive resolution: called every frame with the frame time. */
  governor(ms: number, active: boolean) {
    if (!active) return;
    this.frameMs.push(ms);
    if (this.frameMs.length < 75) return;
    const sorted = this.frameMs.slice().sort((a, b) => a - b);
    const p80 = sorted[Math.floor(sorted.length * 0.8)];
    this.frameMs = [];
    if (p80 > 24) {
      if (this.scale > 0.62) {
        this.scale = Math.max(0.6, this.scale - 0.12);
        this.setPixelRatio();
        this.resize(this.w, this.h);
      } else if (this.autoTier) {
        const i = TIERS.indexOf(this.tier);
        if (i > 0) {
          this.scale = 0.85;
          this.setTier(TIERS[i - 1]);
        }
      }
    } else if (p80 < 15 && this.scale < 1) {
      this.scale = Math.min(1, this.scale + 0.08);
      this.setPixelRatio();
      this.resize(this.w, this.h);
    }
  }

  dispose() {
    this.disposeComposer();
    this.renderer.dispose();
  }
}

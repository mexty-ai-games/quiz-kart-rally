/**
 * Quiz Kart Rally engine: renderer, cup world, karts, the race (intro flyover, countdown, laps,
 * positions), answer rows (question → boxes → bonus or spin-out), bonuses, coins, boost pads,
 * jumps, peels, camera and effects. Works solo (player + AI) and online (player + remote karts,
 * AI run by the lobby host). React drives it through a small API and receives HUD snapshots
 * and race events through callbacks.
 */
import * as THREE from "three";
import { buildTrack, BuiltTrack, deltaS, sampleAt, wrapS, pointAt, locate } from "./track";
import { Kart, KartInput, KartEvents, newKartEvents, resetKartEvents, collideKarts, Bumpable, VMAX, COIN_MAX } from "./kart";
import { Driver } from "./ai";
import { Kit } from "./assets";
import { buildWorld, layoutRow, WorldVis } from "./world";
import { Sky, MOODS, Mood, skyEnvironment } from "./sky";
import { Fx } from "./fx";
import { Skids } from "./skids";
import { Sfx } from "./audio";
import { Input } from "./input";
import { drawAnswer, drawScreen, laneColor, AnswerState } from "./labels";
import { BonusId, rollBonus, BONUS_COLOR } from "./items";
import { Renderer, Tier, TIER_DEFS } from "./render";
import { CameraRig } from "./camera";
import { KartView } from "./kartview";
import { THEMES, themeFor } from "./themes";
import type { Cup } from "./types";

export type Phase = "demo" | "intro" | "countdown" | "racing" | "finished" | "podium";
export type { Tier };

export interface RaceTexts {
  questionTitle: string;
  prompts: string[];
  /** answers[q][a] */
  answers: string[][];
  correct: number[];
  explains: string[];
}

export interface HudQuestion {
  prompt: string;
  /** answers in lane order, left → right, with their lane colour */
  lanes: { text: string; color: string }[];
  dist: number;
}

export interface HudRacer {
  id: string;
  name: string;
  color: string;
  me: boolean;
}

export interface HudState {
  phase: Phase;
  count: number;
  timeMs: number;
  lap: number;
  laps: number;
  pos: number;
  racers: number;
  coins: number;
  bonus: BonusId | null;
  charges: number;
  rolling: boolean;
  rollFace: BonusId;
  speed: number;
  question: HudQuestion | null;
  shield: boolean;
  nova: boolean;
  boost: boolean;
  spin: boolean;
  air: boolean;
  drift: 0 | 1 | 2 | 3;
  map: { player: [number, number]; rivals: { x: number; z: number; color: string }[] };
  order: HudRacer[];
  finished: boolean;
  spectating: boolean;
}

export interface Standing {
  id: string;
  name: string;
  player: boolean;
  timeMs: number;
  color: string;
  kart: number;
}

export interface RaceResult {
  position: number;
  racers: number;
  timeMs: number;
  correct: number;
  answered: number;
  asked: number;
  coins: number;
  standings: Standing[];
}

export type RaceEvent =
  | { type: "go"; rocket?: boolean }
  | { type: "lap"; lap: number; laps: number }
  | { type: "question"; q: number; prompt: string }
  | { type: "answer"; q: number; correct: boolean; picked: string; right: string; prompt: string; explain: string; shielded: boolean }
  | { type: "missed"; q: number; prompt: string; right: string }
  | { type: "bonus"; id: BonusId }
  | { type: "used"; id: BonusId }
  | { type: "hit"; by: "peel" | "nova" }
  | { type: "trick" }
  | { type: "finish"; result: RaceResult }
  | { type: "botFinish"; id: string; ms: number };

export type RacerKind = "player" | "ai" | "remote";
export interface RacerSpec {
  id: string;
  kind: RacerKind;
  kart: number; // index in kit.karts
  name: string;
  color: string;
}

export interface RaceSetup {
  cup: Cup;
  texts: RaceTexts;
  grid: RacerSpec[];
  seed: number;
  laps: number;
  mode: "solo" | "online" | "demo";
  /** online: host-clock time (ms) of GO */
  startAt?: number;
  raceId?: number;
  /** online: this client runs the AI karts */
  host?: boolean;
}

/** Network hooks (online races). */
export interface NetPort {
  now: () => number;
  send: (m: any, reliable: boolean) => void;
}

const STEP = 1 / 120;
const MAX_FRAME_DT = 0.05;
const HUD_MS = 50;
const ROLL_T = 1.15;
const NET_MS = 66; // ~15 Hz kart states
const INTERP_MS = 110;
const INTRO_S = 3.4;
const COUNT_S = 3;
const UP = new THREE.Vector3(0, 1, 0);

interface RowState {
  q: number;
  order: number[];
  correctLane: number;
  centers: number[];
  lap: number;
  feedbackT: number;
  pickedLane: number;
}

interface Snap {
  h: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  sp: number;
  f: number;
  lap: number;
  s: number;
  c: number;
  dt: number;
}

interface Racer {
  spec: RacerSpec;
  kind: RacerKind;
  kart: Kart;
  view: KartView;
  driver: Driver | null;
  prevS: number;
  bonus: BonusId | null;
  charges: number;
  rollT: number;
  rolled: BonusId;
  aiUseT: number;
  ev: KartEvents;
  snaps: Snap[];
  netProgress: number;
  sparkT: number;
}

interface Peel {
  id: string;
  obj: THREE.Object3D;
  p: THREE.Vector3;
  owner: string;
  t: number;
}

// seeded random numbers (questions, lane orders: the same for everyone in an online race)
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle<T>(a: T[], rnd: () => number = Math.random): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}
function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const FLAG = { drift: 1, right: 2, boost: 4, spin: 8, shield: 16, nova: 32, air: 64, trick: 128, done: 256 };

export class Engine {
  r: Renderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, 1, 0.3, 3000);
  rig: CameraRig;
  sky = new Sky();
  sun = new THREE.DirectionalLight("#ffffff", 2.6);
  hemi = new THREE.HemisphereLight("#cfe4ff", "#5d7a3a", 1);
  fx = new Fx();
  skids = new Skids();
  input = new Input();

  cup: Cup | null = null;
  setup: RaceSetup | null = null;
  track: BuiltTrack | null = null;
  world: WorldVis | null = null;
  texts: RaceTexts | null = null;
  racers: Racer[] = [];
  player: Racer | null = null;
  rows: RowState[] = [];
  peels: Peel[] = [];
  net: NetPort | null = null;

  phase: Phase = "demo";
  paused = false;
  laps = 3;
  count = 4;
  /** countdown time left when the player started holding the gas (-1: not holding) */
  private gasFrom = -1;
  private phaseT = 0;
  private raceT = 0;
  private acc = 0;
  private qOrder: number[] = [];
  private asked = 0;
  private answered = 0;
  private correct = 0;
  private finishT = -1;
  private resultSent = false;
  private lastHud = 0;
  private lastNet = 0;
  private running = true;
  private raf = 0;
  private last = 0;
  private background = false;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private mtx = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private coinSpin = 0;
  private lastQuestionRow = -1;
  private time = 0;
  private envTex: THREE.Texture | null = null;
  private bloom = 0.9;
  private peelSeq = 0;
  private spectateIdx = 0;
  hudOn = false;
  /** demo camera: follow this racer (racer select screen) */
  focus: number | null = null;

  onHud: (h: HudState) => void = () => {};
  onEvent: (e: RaceEvent) => void = () => {};

  constructor(private canvas: HTMLCanvasElement, public kit: Kit, tier: Tier, public sfx: Sfx) {
    this.r = new Renderer(canvas, tier, this.scene, this.camera);
    this.rig = new CameraRig(this.camera);
    this.r.onTierChange = () => this.applyTier();
    this.scene.add(this.sky.mesh, this.sun, this.sun.target, this.hemi, this.skids.mesh);
    this.fx.objects.forEach((o) => this.scene.add(o));
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -55;
    sc.right = sc.top = 55;
    sc.near = 1;
    sc.far = 300;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.applyTier();
    this.input.attach();
    this.resize();
    window.addEventListener("resize", this.resize);
    // the game area can change size without the window resizing (phone browser bars, host layout)
    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(canvas);
    }
    this.last = performance.now();
    this.loop();
  }

  get tier(): Tier {
    return this.r.tier;
  }

  // ---------------------------------------------------------------- setup
  private applyTier() {
    const d = TIER_DEFS[this.r.tier];
    this.sun.castShadow = d.shadows > 0;
    if (d.shadows > 0) {
      this.sun.shadow.mapSize.set(d.shadows, d.shadows);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        (this.sun.shadow as any).map = null;
      }
    }
    this.sky.setDetail(d.skyOct);
    this.fx.budget = d.particles;
    this.camera.far = d.far + 600;
    this.camera.updateProjectionMatrix();
    this.racers.forEach((r) => r.view.setShadowCasting(d.shadows > 0));
    // materials must recompile for the shadow change
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      (Array.isArray(m) ? m : [m]).forEach((x) => (x.needsUpdate = true));
    });
    this.resize();
  }

  setTier(t: Tier, auto = false) {
    this.r.autoTier = auto;
    this.r.setTier(t);
  }

  private ro: ResizeObserver | null = null;
  resize = () => {
    const c = this.canvas;
    const w = c.clientWidth || window.innerWidth;
    const h = c.clientHeight || window.innerHeight;
    this.r.resize(w, h);
    this.rig.setAspect(w / Math.max(1, h));
    this.fx.setViewport(h * this.r.gl.getPixelRatio());
  };

  setBackground(b: boolean) {
    this.background = b;
  }

  /** Builds the cup's world and puts the karts on the grid. */
  load(setup: RaceSetup) {
    this.clear();
    const cup = setup.cup;
    this.setup = setup;
    this.cup = cup;
    this.texts = setup.texts;
    this.laps = Math.max(1, Math.min(5, setup.laps));
    const track = buildTrack(cup);
    this.track = track;
    const mood: Mood = (cup.mood as Mood) in MOODS ? (cup.mood as Mood) : "day";
    const md = MOODS[mood];
    const themeId = themeFor(cup.theme, cup.mood);
    const theme = THEMES[themeId];
    this.sfx.setTheme(themeId);
    this.sfx.setHurry(false);
    this.sky.apply(md);
    this.sun.color.set(md.sunColor);
    this.sun.intensity = md.sunIntensity * 0.95;
    this.hemi.color.set(md.hemiSky);
    this.hemi.groundColor.set(md.hemiGround);
    this.hemi.intensity = md.hemiIntensity * 1.05;
    this.r.setExposure(md.exposure);
    this.bloom = theme.bloom;
    const d = TIER_DEFS[this.r.tier];
    this.scene.fog = new THREE.Fog(new THREE.Color(md.horizon), 220, d.far);
    // image-based light from the sky for nicer metals and paint
    if (this.envTex) this.envTex.dispose();
    this.envTex = null;
    if (this.r.tier === "ultra" || this.r.tier === "high") {
      try {
        this.envTex = skyEnvironment(this.r.gl, this.sky);
        this.scene.environment = this.envTex;
        (this.scene as any).environmentIntensity = 0.45;
      } catch {
        this.scene.environment = null;
      }
    } else this.scene.environment = null;
    this.world = buildWorld(track, this.kit, { theme, seed: hashStr(cup.id), scatter: d.scatter, shadows: d.shadows > 0, sunDir: this.sky.sunDir, skyColor: md.horizon, reach: { low: 0.5, medium: 0.72, high: 0.9, ultra: 1 }[this.r.tier] });
    this.scene.add(this.world.root);

    // racers in grid order (slot 0 = pole)
    this.racers = [];
    this.player = null;
    setup.grid.slice(0, 8).forEach((spec, i) => {
      const kart = new Kart(track, i);
      const tag = spec.kind !== "player";
      const view = new KartView(this.kit.karts[spec.kart] || this.kit.karts[0], spec.color, tag ? spec.name : null);
      view.setShadowCasting(d.shadows > 0);
      view.glowLevel = mood === "night" ? 0.9 : mood === "sunset" ? 0.55 : 0.4;
      this.scene.add(view.root);
      const local = spec.kind === "ai" && (setup.mode !== "online" || setup.host);
      const r: Racer = {
        spec,
        kind: spec.kind === "ai" && !local ? "remote" : spec.kind,
        kart,
        view,
        driver: spec.kind === "ai" && local ? new Driver(kart, [0.35, 0.55, 0.75, 0.9, 0.6, 0.5, 0.7, 0.45][i % 8]) : null,
        prevS: 0,
        bonus: null,
        charges: 0,
        rollT: 0,
        rolled: "turbo",
        aiUseT: 0,
        ev: newKartEvents(),
        snaps: [],
        netProgress: 0,
        sparkT: 0,
      };
      this.racers.push(r);
      if (spec.kind === "player") this.player = r;
    });
    const nQ = Math.max(1, cup.questions ? cup.questions.length : 1);
    this.qOrder = shuffle(
      Array.from({ length: nQ }, (_, k) => k),
      mulberry(setup.seed || 1)
    );
    this.resetRace();
  }

  /** Background race behind the menus (all AI, orbit camera). */
  loadDemo(cup: Cup, texts: RaceTexts, grid: RacerSpec[]) {
    this.load({ cup, texts, grid: grid.map((g) => ({ ...g, kind: "ai" as RacerKind })), seed: 7, laps: 99, mode: "demo" });
  }

  private clear() {
    if (this.world) {
      this.scene.remove(this.world.root);
      this.world.dispose();
      this.world = null;
    }
    this.racers.forEach((r) => {
      this.scene.remove(r.view.root);
      r.view.dispose();
    });
    this.racers = [];
    this.peels.forEach((p) => this.scene.remove(p.obj));
    this.peels = [];
    this.player = null;
    this.fx.clear();
    this.skids.clear();
  }

  /** Grid positions, questions and counters back to the start. */
  resetRace() {
    const T = this.track;
    const st = this.setup;
    if (!T || !st) return;
    this.phase = st.mode === "demo" ? "demo" : "intro";
    this.phaseT = 0;
    this.count = 4;
    this.gasFrom = -1;
    this.raceT = 0;
    this.acc = 0;
    this.asked = this.answered = this.correct = 0;
    this.finishT = -1;
    this.resultSent = false;
    this.lastQuestionRow = -1;
    this.peels.forEach((p) => this.scene.remove(p.obj));
    this.peels = [];
    const hw = T.halfW;
    this.racers.forEach((r, k) => {
      r.kart.reset(T.length - 7 - k * 5.5, (k % 2 ? 1 : -1) * hw * 0.42);
      r.kart.lap = -1;
      r.kart.halfway = true;
      r.prevS = r.kart.s;
      r.bonus = null;
      r.charges = 0;
      r.rollT = 0;
      r.aiUseT = 0;
      r.snaps = [];
      r.netProgress = r.kart.progress();
      if (r.driver) r.driver.target = null;
    });
    this.rows = T.rows.map(() => ({ q: 0, order: [], correctLane: 0, centers: [], lap: -99, feedbackT: 0, pickedLane: -1 }));
    T.rows.forEach((_, k) => this.assignRow(k, 0));
    if (this.world) this.world.coins.hidden.forEach((_, k, a) => (a[k] = 0));
    this.setLamps(0);
    const focus = this.camTarget();
    if (focus) {
      if (st.mode === "demo") {
        this.rig.mode = "orbit";
        this.rig.snap(focus);
      } else this.rig.startIntro(T, focus, INTRO_S);
    }
    if (this.world && this.world.podium && this.world.podium.trophy) this.world.podium.trophy.visible = false;
  }

  // ---------------------------------------------------------------- rows
  /** The question a row shows on a given lap: the same for every player of an online race. */
  private questionFor(row: number, lap: number) {
    const R = Math.max(1, this.track ? this.track.rows.length : 1);
    const n = this.qOrder.length;
    return this.qOrder[(((Math.max(0, lap) * R + row) % n) + n) % n];
  }

  private assignRow(k: number, lap: number) {
    const T = this.track!;
    const cup = this.cup!;
    const rs = this.rows[k];
    rs.lap = lap;
    rs.q = this.questionFor(k, lap);
    const qd = cup.questions && cup.questions[rs.q];
    const nAns = qd ? Math.max(2, Math.min(4, qd.answers ? qd.answers.length : 2)) : 2;
    rs.order = shuffle(
      Array.from({ length: nAns }, (_, i) => i),
      mulberry((this.setup ? this.setup.seed : 1) + lap * 977 + k * 131)
    );
    const right = this.texts ? this.texts.correct[rs.q] : 0;
    rs.correctLane = Math.max(0, rs.order.indexOf(right));
    rs.feedbackT = 0;
    rs.pickedLane = -1;
    if (this.world) rs.centers = layoutRow(T, this.world.rows[k], T.rows[k].s, nAns, this.world.boxV2);
    this.drawRow(k);
  }

  private drawRow(k: number) {
    const vis = this.world && this.world.rows[k];
    const rs = this.rows[k];
    const tx = this.texts;
    if (!vis || !tx) return;
    const answers = tx.answers[rs.q] || [];
    for (let lane = 0; lane < vis.lanes; lane++) {
      let st: AnswerState = "idle";
      if (rs.feedbackT > 0) st = lane === rs.correctLane ? "right" : lane === rs.pickedLane ? "wrong" : "dim";
      drawAnswer(vis.cards[lane].ct.ctx, answers[rs.order[lane]] ?? "?", lane, st);
      vis.cards[lane].ct.tex.needsUpdate = true;
    }
    if (vis.screen) {
      drawScreen(vis.screen.ctx, tx.questionTitle, tx.prompts[rs.q] ?? "");
      vis.screen.tex.needsUpdate = true;
    }
  }

  /** Language changed: redraw every in-world text. */
  relabel(texts: RaceTexts, names: { [id: string]: string }) {
    this.texts = texts;
    this.rows.forEach((_, k) => this.drawRow(k));
    this.racers.forEach((r) => {
      const n = names[r.spec.id];
      if (n && n !== r.spec.name) {
        r.spec.name = n;
        r.view.setTag(n, r.spec.color);
      }
    });
  }

  // ---------------------------------------------------------------- controls from React
  setPaused(p: boolean) {
    // online races never pause (the others keep racing); the menu just covers the screen
    this.paused = p && (!this.setup || this.setup.mode !== "online");
    if (p) this.sfx.engine(0, false, false);
  }

  useBonus() {
    const r = this.player;
    if (!r || this.phase !== "racing" || r.kart.finished) return;
    this.applyBonus(r, true);
  }

  private applyBonus(r: Racer, isPlayer: boolean) {
    const id = r.bonus;
    if (!id || r.rollT > 0) return;
    const k = r.kart;
    switch (id) {
      case "turbo":
        k.boostT = Math.max(k.boostT, 1.5);
        r.bonus = null;
        if (isPlayer) this.sfx.boost();
        break;
      case "triple":
        k.boostT = Math.max(k.boostT, 1.1);
        r.charges = Math.max(0, (r.charges || 3) - 1);
        if (r.charges <= 0) r.bonus = null;
        if (isPlayer) this.sfx.boost();
        break;
      case "shield":
        k.shieldT = 14;
        r.bonus = null;
        if (isPlayer) this.sfx.bonusGet();
        break;
      case "peel":
        this.dropPeel(r);
        r.bonus = null;
        if (isPlayer) this.sfx.peel();
        break;
      case "coins":
        k.coins = Math.min(COIN_MAX, k.coins + 5);
        r.bonus = null;
        if (isPlayer) this.sfx.coin();
        this.fx.emit(18, this.tmp.copy(k.p).setY(k.p.y + 1.6), { color: ["#ffd23a", "#fff1a8"], speed: 3, up: 4, add: true });
        break;
      case "nova":
        k.novaT = 6.5;
        k.spinT = 0;
        r.bonus = null;
        if (isPlayer) this.sfx.nova();
        break;
    }
    if (isPlayer) this.onEvent({ type: "used", id });
  }

  private dropPeel(r: Racer) {
    const k = r.kart;
    const p = k.p.clone().addScaledVector(k.forward, -2.8);
    const id = `${r.spec.id}:${this.peelSeq++}`;
    this.addPeel(id, p, r.spec.id);
    if (this.net && this.setup) this.net.send({ t: "ev", r: this.setup.raceId, k: "peel", id, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), o: r.spec.id }, true);
  }
  private addPeel(id: string, p: THREE.Vector3, owner: string) {
    const src = this.kit.models.banana;
    const obj = src ? src.clone(true) : new THREE.Mesh(new THREE.SphereGeometry(0.4), new THREE.MeshStandardMaterial({ color: "#ffd23a" }));
    obj.position.copy(p);
    obj.rotation.y = Math.random() * 6;
    this.scene.add(obj);
    this.peels.push({ id, obj, p: p.clone(), owner, t: 0 });
    if (this.peels.length > 16) {
      const old = this.peels.shift()!;
      this.scene.remove(old.obj);
    }
  }
  private removePeel(id: string) {
    for (let i = this.peels.length - 1; i >= 0; i--)
      if (this.peels[i].id === id) {
        this.scene.remove(this.peels[i].obj);
        this.peels.splice(i, 1);
      }
  }

  // ---------------------------------------------------------------- network in
  /** A message from another player of the online race. */
  applyNet(from: string, m: any) {
    const st = this.setup;
    if (!st || st.mode !== "online" || m.r !== st.raceId) return;
    if (m.t === "st") this.pushSnap(from, m.h, m.k);
    else if (m.t === "bots" && Array.isArray(m.b)) m.b.forEach((b: any[]) => this.pushSnap(String(b[0]), m.h, b.slice(1)));
    else if (m.t === "ev") {
      if (m.k === "peel") this.addPeel(String(m.id), new THREE.Vector3(m.x, m.y, m.z), String(m.o));
      else if (m.k === "peelGone") this.removePeel(String(m.id));
    }
  }
  private pushSnap(id: string, h: number, k: number[]) {
    const r = this.racers.find((x) => x.spec.id === id);
    if (!r || r.kind !== "remote" || !k || k.length < 9) return;
    const s: Snap = { h, x: k[0] / 100, y: k[1] / 100, z: k[2] / 100, yaw: k[3] / 1000, sp: k[4] / 10, f: k[5], lap: k[6], s: k[7] / 10, c: k[8], dt: (k[9] || 0) / 10 };
    const sn = r.snaps;
    if (sn.length && h <= sn[sn.length - 1].h) return;
    sn.push(s);
    if (sn.length > 30) sn.shift();
    r.netProgress = s.lap * (this.track ? this.track.length : 1) + s.s;
  }
  /** The host left: this client now drives the AI karts from where they are. */
  takeOverBots() {
    if (!this.setup || this.setup.mode !== "online") return;
    this.setup.host = true;
    this.racers.forEach((r, i) => {
      if (r.kind === "remote" && r.spec.kind === "ai") {
        r.kind = "ai";
        r.driver = new Driver(r.kart, [0.35, 0.55, 0.75, 0.9, 0.6, 0.5, 0.7, 0.45][i % 8]);
        const last = r.snaps[r.snaps.length - 1];
        if (last) {
          r.kart.p.set(last.x, last.y, last.z);
          r.kart.yaw = last.yaw;
          r.kart.speed = last.sp;
          r.kart.lap = last.lap;
        }
      }
    });
  }
  /** A remote player left the race: their kart disappears. */
  dropRacer(id: string) {
    const i = this.racers.findIndex((r) => r.spec.id === id && r.kind === "remote" && r.spec.kind !== "ai");
    if (i < 0) return;
    const r = this.racers[i];
    this.scene.remove(r.view.root);
    r.view.dispose();
    this.racers.splice(i, 1);
  }

  private encode(r: Racer): number[] {
    const k = r.kart;
    let f = 0;
    if (k.drifting) f |= FLAG.drift;
    if (k.driftDir > 0) f |= FLAG.right;
    if (k.boostT > 0) f |= FLAG.boost;
    if (k.spinT > 0) f |= FLAG.spin;
    if (k.shieldT > 0) f |= FLAG.shield;
    if (k.novaT > 0) f |= FLAG.nova;
    if (k.air) f |= FLAG.air;
    if (k.trickT > 0) f |= FLAG.trick;
    if (k.finished) f |= FLAG.done;
    return [Math.round(k.p.x * 100), Math.round(k.p.y * 100), Math.round(k.p.z * 100), Math.round(k.yaw * 1000), Math.round(k.speed * 10), f, k.lap, Math.round(k.s * 10), k.coins, Math.round(k.driftT * 10)];
  }
  private netOut() {
    const net = this.net;
    const st = this.setup;
    if (!net || !st || st.mode !== "online") return;
    if (this.phase !== "racing" && this.phase !== "finished" && this.phase !== "countdown") return;
    const h = net.now();
    if (this.player) net.send({ t: "st", r: st.raceId, h, k: this.encode(this.player) }, false);
    if (st.host) {
      const b = this.racers.filter((r) => r.kind === "ai").map((r) => [r.spec.id].concat(this.encode(r) as any));
      if (b.length) net.send({ t: "bots", r: st.raceId, h, b }, false);
    }
  }

  // ---------------------------------------------------------------- loop
  private loop = () => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;
    if (this.background && Math.floor(now / 16.7) % 2 === 1) return; // half rate behind menus
    this.frame(dt);
    this.r.governor(dt * 1000, !this.background && this.phase !== "demo");
  };

  /** One rendered frame. */
  frame(dt: number) {
    this.time += dt;
    if (!this.track) {
      this.r.render(dt);
      return;
    }
    if (!this.paused) {
      this.acc += dt;
      // online races must keep up with real time even on slow devices (catch up to 0.25 s per frame)
      const cap = this.setup && this.setup.mode === "online" ? 30 : 8;
      let steps = 0;
      while (this.acc >= STEP && steps < cap) {
        this.tick(STEP);
        this.acc -= STEP;
        steps++;
      }
      if (steps === cap) this.acc = 0;
      this.animate(dt);
      this.fx.update(dt);
      this.skids.update(dt);
    }
    this.updateCamera(dt);
    this.sky.mat.uniforms.time.value += dt;
    const k = this.camTarget();
    const sp = k ? Math.max(0, k.speed) / VMAX : 0;
    const chase = this.rig.mode === "chase";
    this.r.setLook({ speed: chase ? Math.max(0, sp - 0.98) * 2.5 + (k && k.boostT > 0 ? 0.75 : 0) : 0, boost: chase && k && k.boostT > 0 ? 1 : 0, time: this.time, bloom: this.bloom });
    this.r.render(dt);
    const t = performance.now();
    if (this.hudOn && t - this.lastHud > HUD_MS) {
      this.lastHud = t;
      this.emitHud();
    }
    if (t - this.lastNet > NET_MS) {
      this.lastNet = t;
      this.netOut();
    }
  }

  /** Simulates `sec` seconds without rendering (tests, screenshots). */
  advance(sec: number) {
    if (!this.track) return;
    const n = Math.round(sec * 30);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 4; k++) this.tick(1 / 120);
      this.animate(1 / 30);
      this.fx.update(1 / 30);
      this.skids.update(1 / 30);
      this.updateCamera(1 / 30);
      if (this.resultSent) break;
    }
  }

  get done() {
    return this.resultSent;
  }

  /** Seconds to GO (online: from the host clock). */
  private toGo(): number {
    const st = this.setup!;
    if (st.mode === "online" && this.net && st.startAt) return (st.startAt - this.net.now()) / 1000;
    if (this.phase === "intro") return INTRO_S - this.phaseT + COUNT_S;
    if (this.phase === "countdown") return COUNT_S - this.phaseT;
    return 0;
  }

  // ---------------------------------------------------------------- simulation
  private tick(dt: number) {
    const T = this.track!;
    const st = this.setup!;
    this.phaseT += dt;
    if (this.phase === "podium") return; // the winners stand still on the podium
    if (this.phase === "intro" || this.phase === "countdown") {
      const toGo = this.toGo();
      if (this.phase === "intro" && (toGo <= COUNT_S || (st.mode !== "online" && this.phaseT >= INTRO_S))) {
        this.phase = "countdown";
        this.phaseT = 0;
        const f = this.camTarget();
        if (f && this.rig.mode === "intro") {
          this.rig.mode = "chase";
          this.rig.snap(f);
        }
      }
      if (this.phase === "countdown") {
        const left = this.toGo();
        // rocket start: press the gas during the last count ("1") and hold it through GO
        if (this.player && !this.paused) {
          const gas = this.input.read().throttle > 0.5;
          if (!gas) this.gasFrom = -1;
          else if (this.gasFrom < 0) this.gasFrom = left;
        }
        const c = Math.max(0, Math.ceil(left));
        if (c !== this.count && c <= 3) {
          this.count = c;
          if (c > 0) {
            this.sfx.countBeep();
            this.setLamps(4 - c);
          }
        }
        if (left <= 0) {
          this.phase = "racing";
          this.phaseT = 0;
          this.count = 0;
          this.raceT = st.mode === "online" ? Math.max(0, -left) : 0;
          this.setLamps(5);
          this.sfx.go();
          const rocket = !!this.player && this.gasFrom > 0 && this.gasFrom <= 1.0;
          if (rocket && this.player) {
            const k = this.player.kart;
            k.boostT = Math.max(k.boostT, 1.1);
            k.speed = Math.max(k.speed, 9);
            this.sfx.miniTurbo(2);
            this.fx.emit(20, this.tmp.copy(k.p).setY(k.p.y + 0.5), { color: ["#ff8a1e", "#ffd23a", "#ffffff"], speed: 4, up: 2, dir: k.forward.multiplyScalar(-1), add: true });
          }
          this.gasFrom = -1;
          this.onEvent({ type: "go", rocket });
          window.setTimeout(() => this.setLamps(0), 1200);
        }
      }
      // remote karts still show on the grid
      return;
    }
    if (this.phase === "racing" || this.phase === "finished") {
      if (st.mode === "online" && this.net && st.startAt) this.raceT = Math.max(this.raceT, (this.net.now() - st.startAt) / 1000);
      else this.raceT += dt;
    }
    const lead = this.player ? this.player.kart.progress() : this.leaderProgress();
    const humans = st.mode === "online" ? Math.max(lead, this.humanLead()) : lead;
    const bumpers: Bumpable[] = [];
    const bumpOwners: Racer[] = [];
    this.racers.forEach((r) => {
      const k = r.kart;
      if (r.kind === "remote") {
        bumpers.push({ p: k.p, speed: k.speed, novaT: k.novaT, movable: false });
        bumpOwners.push(r);
        return;
      }
      let inp: KartInput;
      if (r === this.player && !k.finished) inp = this.phase === "racing" ? this.input.read() : { throttle: 0, brake: 0, steer: 0, drift: false };
      else if (r.driver) inp = r.driver.drive(T, dt, humans);
      else inp = { throttle: 0, brake: 0, steer: 0, drift: false };
      const ev = r.ev;
      resetKartEvents(ev);
      r.prevS = k.s;
      k.step(dt, inp, ev);
      this.kartEvents(r, ev);
      this.lapLogic(r);
      this.rowLogic(r);
      this.pickups(r);
      // bonus roulette
      if (r.rollT > 0) {
        r.rollT -= dt;
        if (r.rollT <= 0) {
          r.rollT = 0;
          r.bonus = r.rolled;
          r.charges = r.rolled === "triple" ? 3 : 0;
          if (r === this.player) {
            this.sfx.bonusGet();
            this.onEvent({ type: "bonus", id: r.rolled });
          } else r.aiUseT = 0.8 + Math.random() * 3;
        }
      }
      // AI use their bonus after a short think
      if (r !== this.player && r.bonus && r.aiUseT > 0) {
        r.aiUseT -= dt;
        if (r.aiUseT <= 0) {
          this.applyBonus(r, false);
          if (r.bonus) r.aiUseT = 0.6;
        }
      }
      bumpers.push({ p: k.p, speed: k.speed, novaT: k.novaT, movable: true });
      bumpOwners.push(r);
    });
    collideKarts(bumpers, (a, b, s) => {
      const A = bumpOwners[a],
        B = bumpOwners[b];
      if (A.kart.novaT > 0 && B.kart.novaT <= 0 && B.kind !== "remote") this.knock(B, "nova");
      else if (B.kart.novaT > 0 && A.kart.novaT <= 0 && A.kind !== "remote") this.knock(A, "nova");
      if (this.player && (A === this.player || B === this.player)) {
        this.sfx.bump(s);
        this.rig.shake(s * 0.5);
      }
    });
    // write back speeds changed by bumps
    bumpers.forEach((bp, i) => {
      if (bp.movable) bumpOwners[i].kart.speed = bp.speed;
    });
    this.peelLogic(dt);
    // finish: wait a moment for the rivals, then report (solo)
    if (this.phase === "finished" && !this.resultSent) {
      this.finishT += dt;
      const allIn = this.racers.every((r) => r.kart.finished);
      if (st.mode !== "online" && (this.finishT > 4.5 || allIn)) this.sendResult();
    }
  }

  private humanLead() {
    let m = -Infinity;
    this.racers.forEach((r) => {
      if (r.spec.kind !== "ai") m = Math.max(m, this.progressOf(r));
    });
    return m;
  }
  private leaderProgress() {
    let m = -Infinity;
    this.racers.forEach((r) => (m = Math.max(m, this.progressOf(r))));
    return m;
  }
  progressOf(r: Racer) {
    return r.kind === "remote" ? r.netProgress : r.kart.progress();
  }
  /** Progress (m) of a racer by id, for the host's ranking of unfinished karts. */
  progressById(id: string) {
    const r = this.racers.find((x) => x.spec.id === id);
    return r ? this.progressOf(r) : -1e9;
  }

  private kartEvents(r: Racer, ev: KartEvents) {
    const k = r.kart;
    const me = r === this.player;
    if (ev.miniTurbo) {
      if (me) this.sfx.miniTurbo(ev.miniTurbo);
      this.fx.emit(18, this.tmp.copy(k.p).setY(k.p.y + 0.5), { color: ev.miniTurbo === 2 ? ["#ff8a1e", "#ffd23a"] : ["#4fc3ff", "#bfefff"], speed: 4, up: 2, dir: k.forward.multiplyScalar(-1), add: true });
    }
    if (ev.driftStart && me) this.sfx.driftStart();
    if (ev.wall > 0.15 && me) {
      this.sfx.wall(ev.wall);
      this.rig.shake(ev.wall * 0.6);
    }
    if (ev.jump && me) this.sfx.jump();
    if (ev.trick) {
      if (me) {
        this.sfx.trick();
        this.onEvent({ type: "trick" });
      }
      this.fx.emit(14, this.tmp.copy(k.p).setY(k.p.y + 1.2), { color: ["#ffffff", "#ffd23a", "#8ce8ff"], speed: 5, up: 3, grav: 2, add: true });
    }
    if (ev.land > 0) {
      if (me) {
        this.sfx.land(ev.land);
        this.rig.shake(ev.land * 0.45);
      }
      this.fx.emit(10 + Math.round(ev.land * 14), this.tmp.copy(k.p).setY(k.p.y + 0.2), { color: ["#d8d2e6", "#b8b0c8"], speed: 4, up: 1.4, grav: 2, size: 0.6, life: 0.6, drag: 3 });
    }
    if (ev.trickBoost) {
      if (me) this.sfx.boost();
      this.fx.emit(16, this.tmp.copy(k.p).setY(k.p.y + 0.6), { color: ["#ff8a1e", "#ffd23a", "#ffffff"], speed: 4, up: 2, dir: k.forward.multiplyScalar(-1), add: true });
    }
  }

  private knock(r: Racer, by: "peel" | "nova") {
    const k = r.kart;
    if (k.shieldT > 0) {
      k.shieldT = 0;
      if (r === this.player) this.sfx.shieldPop();
      return;
    }
    if (k.spinOut(1.1)) {
      this.fx.emit(14, this.tmp.copy(k.p).setY(k.p.y + 1.8), { color: ["#ffe45c", "#ffffff"], speed: 3, up: 3, grav: 3, add: true });
      if (r === this.player) {
        this.sfx.spin();
        this.rig.shake(0.5);
        this.onEvent({ type: "hit", by });
      }
    }
  }

  private lapLogic(r: Racer) {
    const k = r.kart;
    const L = this.track!.length;
    if (k.s > L * 0.42 && k.s < L * 0.58) k.halfway = true;
    // crossed the line forwards
    if (r.prevS > L * 0.8 && k.s < L * 0.2) {
      if (k.halfway) {
        k.lap++;
        k.halfway = false;
        if (k.lap >= this.laps && !k.finished) {
          k.finished = true;
          k.finishMs = this.raceT * 1000;
          if (r === this.player) this.playerFinished();
          else if (r.kind === "ai" && this.setup && this.setup.mode === "online") this.onEvent({ type: "botFinish", id: r.spec.id, ms: k.finishMs });
        } else if (r === this.player && k.lap > 0) {
          if (k.lap === this.laps - 1) {
            this.sfx.finalLap();
            this.sfx.setHurry(true);
          }
          else this.sfx.lap();
          this.onEvent({ type: "lap", lap: k.lap + 1, laps: this.laps });
        }
      }
    } else if (r.prevS < L * 0.2 && k.s > L * 0.8) {
      // drove back over the line
      if (k.lap >= 0 && !k.halfway) {
        k.lap--;
        k.halfway = true;
      }
    }
  }

  private playerFinished() {
    this.phase = "finished";
    this.finishT = 0;
    const pos = this.positionOf(this.player!);
    this.sfx.finish(pos <= 3);
    const p = this.player!;
    this.fx.emit(60, this.tmp.copy(p.kart.p).setY(p.kart.p.y + 3), { color: ["#ff5fa8", "#ffd23a", "#4fc3ff", "#7ee05a", "#ffffff"], speed: 8, up: 9, grav: 6, life: 1.6, size: 0.4 });
    // the player's kart drives itself to the end of the lap
    p.driver = new Driver(p.kart, 0.6);
    if (this.setup && this.setup.mode === "online") {
      // online: report right away; the host ranks everyone
      this.resultSent = true;
      this.onEvent({ type: "finish", result: this.localResult() });
    }
  }

  private positionOf(r: Racer) {
    return this.standings().indexOf(r) + 1;
  }

  /** Racers in race order. */
  standings(): Racer[] {
    return this.racers.slice().sort((a, b) => {
      const fa = a.kind === "remote" ? !!(a.snaps.length && a.snaps[a.snaps.length - 1].f & FLAG.done) : a.kart.finished;
      const fb = b.kind === "remote" ? !!(b.snaps.length && b.snaps[b.snaps.length - 1].f & FLAG.done) : b.kart.finished;
      if (fa && fb && a.kind !== "remote" && b.kind !== "remote") return a.kart.finishMs - b.kart.finishMs;
      if (fa !== fb) return fa ? -1 : 1;
      return this.progressOf(b) - this.progressOf(a);
    });
  }

  private localResult(): RaceResult {
    const p = this.player!;
    const order = this.standings();
    const L = this.track!.length;
    const t = this.raceT * 1000;
    const standings: Standing[] = order.map((r) => {
      let ms = r.kart.finishMs;
      if (r.kind === "remote" || !r.kart.finished) {
        const left = this.laps * L - this.progressOf(r);
        ms = t + (Math.max(0, left) / Math.max(12, VMAX * 0.75)) * 1000;
      }
      return { id: r.spec.id, name: r.spec.name, player: r === p, timeMs: Math.round(ms), color: r.spec.color, kart: r.spec.kart };
    });
    standings.sort((a, b) => a.timeMs - b.timeMs);
    return {
      position: standings.findIndex((s) => s.player) + 1,
      racers: this.racers.length,
      timeMs: Math.round(p.kart.finishMs),
      correct: this.correct,
      answered: this.answered,
      asked: this.asked,
      coins: p.kart.coins,
      standings,
    };
  }

  private sendResult() {
    this.resultSent = true;
    this.onEvent({ type: "finish", result: this.localResult() });
  }

  private rowLogic(r: Racer) {
    const T = this.track!;
    const k = r.kart;
    const isPlayer = r === this.player;
    T.rows.forEach((row, ri) => {
      const rs = this.rows[ri];
      const before = deltaS(r.prevS, row.s, T.length);
      const after = deltaS(k.s, row.s, T.length);
      // AI: choose an answer lane as the row comes up
      if (r.driver && before > 0 && before < 60 && (!r.driver.target || Math.abs(deltaS(r.driver.target.s, row.s, T.length)) > 1)) {
        const right = Math.random() < r.driver.accuracy();
        let lane = rs.correctLane;
        if (!right && rs.centers.length > 1) {
          lane = Math.floor(Math.random() * (rs.centers.length - 1));
          if (lane >= rs.correctLane) lane++;
        }
        r.driver.target = { s: row.s, lat: rs.centers[lane] ?? 0 };
        (r.driver as any).wantRight = right;
      }
      if (!(before > 0 && after <= 0 && before < 20)) return;
      if (k.lap < 0) return;
      // crossed the row: which lane?
      const hw = T.halfW;
      const lanes = rs.centers.length;
      const vis = this.world && this.world.rows[ri];
      let lane = -1;
      if (Math.abs(k.lat) <= hw + 0.4 && lanes > 0) lane = Math.max(0, Math.min(lanes - 1, Math.floor(((k.lat + hw) / (2 * hw)) * lanes)));
      if (vis && lane >= 0) this.breakBox(ri, lane);
      if (isPlayer && !k.finished) this.playerAnswer(ri, lane);
      else if (lane >= 0 && r.kind === "ai") this.aiAnswer(r, r.driver ? (r.driver as any).wantRight !== false && lane === rs.correctLane : lane === rs.correctLane);
    });
  }

  private breakBox(ri: number, lane: number) {
    const vis = this.world!.rows[ri];
    if (vis.respawn[lane] > 0.4) return;
    vis.respawn[lane] = 1.3;
    const bp = vis.boxes[lane].position;
    this.fx.emit(22, bp, { color: ["#b49bff", "#ffffff", "#ffd23a", "#8ce8ff"], speed: 6, up: 4, add: true });
    this.fx.emit(10, bp, { color: ["#cbbcff", "#ffffff"], speed: 5, up: 5, size: 0.5, grav: 12 });
  }

  private playerAnswer(ri: number, lane: number) {
    const rs = this.rows[ri];
    const tx = this.texts!;
    const p = this.player!;
    const prompt = tx.prompts[rs.q] ?? "";
    const right = (tx.answers[rs.q] || [])[tx.correct[rs.q]] ?? "";
    this.asked++;
    if (lane < 0) {
      this.onEvent({ type: "missed", q: rs.q, prompt, right });
    } else {
      this.answered++;
      const ok = lane === rs.correctLane;
      const picked = (tx.answers[rs.q] || [])[rs.order[lane]] ?? "";
      let shielded = false;
      this.sfx.boxBreak();
      if (ok) {
        this.correct++;
        this.sfx.correct();
        this.fx.emit(40, this.tmp.copy(p.kart.p).setY(p.kart.p.y + 2.2), { color: ["#3ddc6b", "#ffd23a", "#4fc3ff", "#ff7aa2"], speed: 6, up: 6, grav: 7, add: true });
        if (p.bonus || p.rollT > 0) {
          p.kart.coins = Math.min(COIN_MAX, p.kart.coins + 3);
        } else {
          p.rollT = ROLL_T;
          p.rolled = rollBonus(this.positionOf(p), this.racers.length);
        }
      } else {
        this.sfx.wrong();
        if (p.kart.shieldT > 0) {
          p.kart.shieldT = 0;
          shielded = true;
          this.sfx.shieldPop();
        } else {
          p.kart.spinOut(1.2);
          p.kart.coins = Math.max(0, p.kart.coins - 2);
          this.rig.shake(0.4);
          this.fx.emit(16, this.tmp.copy(p.kart.p).setY(p.kart.p.y + 1.8), { color: ["#ffe45c", "#ffffff"], speed: 3, up: 3, grav: 3, add: true });
        }
      }
      this.onEvent({ type: "answer", q: rs.q, correct: ok, picked, right, prompt, explain: tx.explains[rs.q] ?? "", shielded });
    }
    // show the result on the cards, then the next question for the next lap
    rs.feedbackT = 1.6;
    rs.pickedLane = lane;
    this.drawRow(ri);
  }

  private aiAnswer(r: Racer, ok: boolean) {
    if (ok) {
      if (!r.bonus && r.rollT <= 0) {
        r.rollT = ROLL_T;
        r.rolled = rollBonus(this.positionOf(r), this.racers.length);
      }
    } else if (r.kart.shieldT > 0) r.kart.shieldT = 0;
    else r.kart.spinOut(1.1);
  }

  private pickups(r: Racer) {
    const T = this.track!;
    const k = r.kart;
    const w = this.world;
    if (!w) return;
    // coins
    const coins = w.coins;
    for (let c = 0; c < coins.base.length; c++) {
      if (coins.hidden[c] > 0) continue;
      const e = coins.base[c].elements;
      const dx = e[12] - k.p.x,
        dz = e[14] - k.p.z;
      if (dx * dx + dz * dz < 2.6 && Math.abs(e[13] - k.p.y) < 2.5) {
        coins.hidden[c] = 7;
        if (k.coins < COIN_MAX) k.coins++;
        this.fx.emit(8, this.tmp.set(e[12], e[13], e[14]), { color: ["#ffd23a", "#fff6c8"], speed: 2.5, up: 3, add: true });
        if (r === this.player) this.sfx.coin();
      }
    }
    // boost pads
    if (!k.air)
      for (let b = 0; b < T.boosts.length; b++) {
        const bp = T.boosts[b];
        if (Math.abs(deltaS(k.s, bp.s, T.length)) < 3 && Math.abs(k.lat - bp.lat) < 2.2) {
          if (k.boostT < 0.5 && r === this.player) this.sfx.boost();
          k.boostT = Math.max(k.boostT, 1.2);
        }
      }
  }

  private peelLogic(dt: number) {
    for (let i = this.peels.length - 1; i >= 0; i--) {
      const pl = this.peels[i];
      pl.t += dt;
      let hit = false;
      for (let j = 0; j < this.racers.length && !hit; j++) {
        const r = this.racers[j];
        if (r.kind === "remote") continue; // their own client checks them
        const k = r.kart;
        if (r.spec.id === pl.owner && pl.t < 1.2) continue;
        const dx = k.p.x - pl.p.x,
          dz = k.p.z - pl.p.z;
        if (dx * dx + dz * dz < 1.6 * 1.6 && Math.abs(k.p.y - pl.p.y) < 1.5) {
          if (k.novaT <= 0) this.knock(r, "peel");
          hit = true;
        }
      }
      if (hit || pl.t > 70) {
        if (hit && this.net && this.setup) this.net.send({ t: "ev", r: this.setup.raceId, k: "peelGone", id: pl.id }, true);
        this.scene.remove(pl.obj);
        this.peels.splice(i, 1);
      } else pl.obj.position.y = pl.p.y + 0.05;
    }
  }

  // ---------------------------------------------------------------- visuals
  private setLamps(n: number) {
    const lamps = this.world ? this.world.lamps : [];
    lamps.forEach((m, k) => {
      const on = n === 5 ? true : k < n * 2 - (n > 2 ? 1 : 0);
      const go = n === 5;
      m.emissive.set(go ? "#2bff6a" : "#ff2a1a");
      m.emissiveIntensity = on ? 4 : 0;
      m.color.set(on ? (go ? "#3cff7a" : "#ff4a3a") : "#40141a");
    });
  }

  /** Remote karts: interpolate between the last snapshots (render a little in the past). */
  private remoteMotion(r: Racer, dt: number) {
    const k = r.kart;
    const sn = r.snaps;
    if (!sn.length || !this.net) return;
    const t = this.net.now() - INTERP_MS;
    let a = sn[0],
      b = sn[sn.length - 1];
    for (let i = sn.length - 1; i > 0; i--)
      if (sn[i - 1].h <= t) {
        a = sn[i - 1];
        b = sn[i];
        break;
      }
    let x: number, y: number, z: number, yaw: number;
    if (t >= b.h) {
      // extrapolate a little past the newest snapshot
      const e = Math.min(0.25, (t - b.h) / 1000);
      x = b.x - Math.sin(b.yaw) * b.sp * e;
      z = b.z - Math.cos(b.yaw) * b.sp * e;
      y = b.y;
      yaw = b.yaw;
    } else {
      const u = b.h > a.h ? THREE.MathUtils.clamp((t - a.h) / (b.h - a.h), 0, 1) : 1;
      x = a.x + (b.x - a.x) * u;
      y = a.y + (b.y - a.y) * u;
      z = a.z + (b.z - a.z) * u;
      let d = b.yaw - a.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      yaw = a.yaw + d * u;
    }
    const prevS = k.s;
    k.p.set(x, y, z);
    k.yaw = yaw;
    k.speed = b.sp;
    k.drifting = !!(b.f & FLAG.drift);
    k.driftDir = b.f & FLAG.right ? 1 : -1;
    k.driftT = b.dt;
    k.boostT = b.f & FLAG.boost ? 0.3 : 0;
    const spinning = !!(b.f & FLAG.spin);
    if (spinning) k.spinYaw += dt * 9;
    else k.spinYaw = 0;
    k.spinT = spinning ? 0.5 : 0;
    k.shieldT = b.f & FLAG.shield ? 1 : 0;
    k.novaT = b.f & FLAG.nova ? 1 : 0;
    k.air = !!(b.f & FLAG.air);
    if (b.f & FLAG.trick && k.trickT <= 0 && !k.tricked) {
      k.trickT = 0.45;
      k.tricked = true;
      k.trickDir = 1;
    }
    if (!(b.f & FLAG.air)) k.tricked = false;
    if (k.trickT > 0) k.trickT = Math.max(0, k.trickT - dt);
    k.coins = b.c;
    k.lap = b.lap;
    k.finished = !!(b.f & FLAG.done);
    // ground info for the visuals (tilt, shadow, wheels)
    const L = this.track!;
    const located = locate(L, k.p, k.idx, k.loc);
    k.idx = located.i;
    k.s = L.samples[located.i].s;
    // the drawn position runs a little behind (or ahead of) the newest snapshot: keep lap and s consistent at the line
    if (b.s > L.length * 0.8 && k.s < L.length * 0.2) k.lap = b.lap + 1;
    else if (b.s < L.length * 0.2 && k.s > L.length * 0.8) k.lap = b.lap - 1;
    const sm = L.samples[located.i];
    const f = k.forward;
    const cosA = f.x * sm.T.x + f.z * sm.T.z;
    k.roll += ((k.air ? 0 : sm.bank * cosA) - k.roll) * Math.min(1, dt * 8);
    k.pitch += ((k.air ? 0 : Math.atan(sm.slope + located.rampSlope) * cosA) - k.pitch) * Math.min(1, dt * 10);
    k.wheelSpin += (k.speed * dt) / 0.32;
    k.steerSm = 0;
    // passing boxes break them for everyone
    const T = this.track!;
    T.rows.forEach((row, ri) => {
      const before = deltaS(prevS, row.s, T.length);
      const after = deltaS(k.s, row.s, T.length);
      if (before > 0 && after <= 0 && before < 20 && Math.abs(k.lat) <= T.halfW && this.rows[ri].centers.length) {
        const lanes = this.rows[ri].centers.length;
        const lane = Math.max(0, Math.min(lanes - 1, Math.floor(((k.lat + T.halfW) / (2 * T.halfW)) * lanes)));
        this.breakBox(ri, lane);
      }
    });
  }

  private animate(dt: number) {
    const w = this.world!;
    const T = this.track!;
    const t = this.time;
    w.update(t, dt);
    // boxes spin and bob; hit boxes pop back in
    w.rows.forEach((vis, ri) => {
      const rs = this.rows[ri];
      for (let k = 0; k < vis.lanes; k++) {
        const b = vis.boxes[k];
        if (vis.respawn[k] > 0) {
          vis.respawn[k] -= dt;
          const s = vis.respawn[k] > 0 ? Math.max(0.01, 1 - vis.respawn[k] / 1.3) : 1;
          b.scale.setScalar(vis.respawn[k] > 1.0 ? 0.01 : s);
        } else b.scale.setScalar(1);
        b.rotation.y = t * 1.4 + k;
        b.rotation.x = Math.sin(t * 1.1 + k) * 0.15;
        b.position.y = (b.userData.baseY ?? b.position.y) + Math.sin(t * 2.2 + k) * 0.2;
      }
      if (rs.feedbackT > 0) {
        rs.feedbackT -= dt;
        if (rs.feedbackT <= 0) {
          // next question for the player's next lap
          const lap = this.player ? this.player.kart.lap + 1 : rs.lap + 1;
          this.assignRow(ri, lap);
        }
      }
    });
    // boost pads pulse
    w.boostGlow.forEach((m) => (m.emissiveIntensity = 2.4 + Math.sin(t * 9) * 1.3));
    // coins spin, collected ones come back later
    this.coinSpin += dt * 3;
    const cv = w.coins;
    const rot = this.q.setFromAxisAngle(UP, this.coinSpin);
    const M = new THREE.Matrix4();
    for (let c = 0; c < cv.base.length; c++) {
      if (cv.hidden[c] > 0) cv.hidden[c] -= dt;
      const e = cv.base[c].elements;
      const vis = cv.hidden[c] <= 0;
      this.mtx.compose(this.tmp.set(e[12], e[13] + Math.sin(t * 3 + c) * 0.12, e[14]), rot, this.tmp2.setScalar(vis ? 1 : 0.0001));
      for (let m = 0; m < cv.mesh.length; m++) cv.mesh[m].setMatrixAt(c, M.multiplyMatrices(this.mtx, cv.locals[m]));
    }
    cv.mesh.forEach((m) => (m.instanceMatrix.needsUpdate = true));
    this.peels.forEach((p) => (p.obj.rotation.y += dt * 0.5));

    // karts
    const cam = this.camera.position;
    this.racers.forEach((r) => {
      if (r.kind === "remote" && this.phase !== "podium") this.remoteMotion(r, dt);
      const k = r.kart;
      r.view.update(k, t, dt, cam);
      this.kartFx(r, dt);
    });
    this.podiumFx(dt);
    void T;
  }

  private kartFx(r: Racer, dt: number) {
    const k = r.kart;
    const v = r.view;
    const side = this.tmp2.set(Math.cos(k.yaw), 0, -Math.sin(k.yaw));
    // drift sparks from the rear wheels, colour by mini-turbo level
    r.sparkT -= dt;
    if (k.drifting && !k.air && k.driftT > 0.2) {
      if (r.sparkT <= 0) {
        r.sparkT = 0.035;
        const col = k.driftT > 1.7 ? ["#ff8a1e", "#ffd23a", "#fff1a8"] : k.driftT > 0.8 ? ["#4fc3ff", "#bfefff", "#ffffff"] : ["#ffffff", "#ffe9b0"];
        const big = k.driftT > 0.8;
        [v.sparkL, v.sparkR].forEach((lp) => {
          const wp = v.world(lp, this.tmp);
          this.fx.emit(big ? 2 : 1, wp, { color: col, speed: big ? 4 : 2.5, up: big ? 3 : 1.5, size: big ? 0.3 : 0.18, life: 0.3, grav: 9, add: true });
        });
      }
      ["L", "R"].forEach((s, i) => {
        const wp = v.world(i ? v.sparkR : v.sparkL, this.tmp);
        wp.y = k.loc.y;
        this.skids.mark(r.spec.id + s, wp, side, 0.32, 0.9);
      });
    } else if (!k.air && k.speed > 10 && (k.wallContact || k.spinT > 0)) {
      ["L", "R"].forEach((s, i) => {
        const wp = v.world(i ? v.sparkR : v.sparkL, this.tmp);
        wp.y = k.loc.y;
        this.skids.mark(r.spec.id + s, wp, side, 0.3, 0.6);
      });
    } else {
      this.skids.lift(r.spec.id + "L");
      this.skids.lift(r.spec.id + "R");
    }
    const back = this.tmp.copy(k.p).addScaledVector(k.forward, -1.3);
    back.y += 0.45;
    if (k.boostT > 0 && Math.random() < 0.6) this.fx.emit(1, back, { color: ["#ff8a1e", "#ffd23a", "#ff5a1e"], speed: 2, up: 1, size: 0.5, life: 0.28, grav: -2, dir: k.forward.multiplyScalar(-1), add: true });
    if (k.novaT > 0) this.fx.emit(1, this.tmp.copy(k.p).setY(k.p.y + 1), { color: [BONUS_COLOR.nova, "#ffffff", "#4fc3ff", "#ffd23a"], speed: 2, up: 2, size: 0.35, life: 0.5, grav: 1, add: true });
    if (k.onGrass && k.speed > 6 && Math.random() < 0.45) this.fx.emit(1, back.setY(k.p.y + 0.3), { color: ["#9b8a62", "#b8a77c"], speed: 1.4, up: 1.6, size: 0.6, life: 0.55, grav: 1 });
  }

  private camTarget(): Kart | null {
    if (this.player) return this.player.kart;
    if (this.focus !== null && this.racers[this.focus]) return this.racers[this.focus].kart;
    // demo / spectating: follow the leader (or a chosen racer)
    const s = this.standings();
    if (!s.length) return null;
    return s[Math.min(this.spectateIdx, s.length - 1)].kart;
  }
  /** Spectators: look at the next racer. */
  spectateNext() {
    this.spectateIdx = (this.spectateIdx + 1) % Math.max(1, this.racers.length);
  }

  private updateCamera(dt: number) {
    const k = this.camTarget();
    if (this.phase === "demo" && this.rig.mode !== "orbit") this.rig.mode = "orbit";
    if (this.phase === "finished" && this.finishT > 0.6 && this.rig.mode === "chase") this.rig.mode = "orbit";
    if (!this.player && this.setup && this.setup.mode === "online" && this.rig.mode === "orbit" && this.phase === "racing") this.rig.mode = "chase";
    this.rig.update(dt, k);
    // shadows follow the camera target
    const c = k ? k.p : this.camera.position;
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(this.sky.sunDir, 150);
    this.sky.mesh.position.copy(this.camera.position);
    // engine sound
    if (this.player && (this.phase === "racing" || this.phase === "countdown") && !this.paused) this.sfx.engine(Math.min(1, Math.max(0, this.player.kart.speed) / (VMAX * 1.3)), this.player.kart.boostT > 0, true);
    else this.sfx.engine(0, false, false);
  }

  /** Results: winners on the podium, trophy, confetti, camera on them. */
  showPodium(order: string[]) {
    const w = this.world;
    if (!w || !w.podium) return;
    this.phase = "podium";
    const pd = w.podium;
    this.racers.forEach((r) => {
      r.view.root.visible = false;
      r.view.noTag = true;
    });
    order.slice(0, 3).forEach((id, k) => {
      const r = this.racers.find((x) => x.spec.id === id);
      if (!r || !pd.spots[k]) return;
      r.view.root.visible = true;
      r.kart.p.copy(pd.spots[k]);
      r.kart.yaw = pd.yaw + Math.PI;
      r.kart.speed = 0;
      r.kart.drifting = false;
      r.kart.boostT = r.kart.spinT = r.kart.novaT = r.kart.shieldT = 0;
      r.kart.roll = r.kart.pitch = 0;
      r.kart.air = false;
      r.kart.loc.y = pd.spots[k].y;
      r.kind = "ai";
      r.driver = null;
    });
    if (pd.trophy) {
      pd.trophy.visible = true;
      pd.trophy.position.copy(pd.spots[0]).setY(pd.spots[0].y + 2.4);
    }
    const across = new THREE.Vector3().subVectors(pd.look, pd.camPos).setY(0).normalize();
    const right = new THREE.Vector3(-across.z, 0, across.x);
    const wide = this.camera.aspect > 1.2;
    // wide screens: the podium sits in the left half, beside the results card
    this.rig.setPodium(pd.camPos.clone().addScaledVector(right, wide ? 0.6 : 0).addScaledVector(across, wide ? -1.8 : 0), pd.look.clone().addScaledVector(right, wide ? 1.7 : 0).setY(pd.look.y - (wide ? 0 : 1)));
    this.sfx.cheer();
  }
  /** Back from the podium to a background race. */
  get onPodium() {
    return this.phase === "podium";
  }

  private podiumFx(dt: number) {
    const w = this.world;
    if (this.phase !== "podium" || !w || !w.podium) return;
    const pd = w.podium;
    if (pd.trophy) pd.trophy.rotation.y += dt * 1.5;
    if (Math.random() < dt * 12) {
      const s = pd.spots[Math.floor(Math.random() * 3)];
      this.fx.emit(6, this.tmp.copy(s).setY(s.y + 6), { color: ["#ff5fa8", "#ffd23a", "#4fc3ff", "#7ee05a", "#ffffff", "#c86bff"], speed: 4, up: 1, grav: 3, life: 2.4, size: 0.32, drag: 0.8 });
    }
    if (Math.random() < dt * 0.9) {
      const s = pd.spots[0];
      const at = this.tmp.copy(s).add(new THREE.Vector3((Math.random() - 0.5) * 30, 18 + Math.random() * 8, (Math.random() - 0.5) * 10));
      this.fx.emit(46, at, { color: [["#ff5fa8", "#ffd23a"], ["#4fc3ff", "#ffffff"], ["#7ee05a", "#ffd23a"]][Math.floor(Math.random() * 3)], speed: 9, up: 2, grav: 4, life: 1.4, size: 0.42, drag: 1.2, add: true });
      this.sfx.firework();
    }
  }

  private emitHud() {
    const T = this.track;
    const st = this.setup;
    if (!T || !st) return;
    const p = this.player;
    const order = this.standings();
    const hudOrder: HudRacer[] = order.map((r) => ({ id: r.spec.id, name: r.spec.name, color: r.spec.color, me: r === p }));
    const focus = this.camTarget();
    if (!p) {
      const k = focus;
      this.onHud({
        phase: this.phase,
        count: this.count,
        timeMs: this.raceT * 1000,
        lap: k ? Math.max(1, Math.min(this.laps, k.lap + 1)) : 1,
        laps: this.laps,
        pos: 0,
        racers: this.racers.length,
        coins: 0,
        bonus: null,
        charges: 0,
        rolling: false,
        rollFace: "turbo",
        speed: k ? Math.max(0, k.speed) * 3.6 : 0,
        question: null,
        shield: false,
        nova: false,
        boost: false,
        spin: false,
        air: false,
        drift: 0,
        map: { player: k ? [k.p.x, k.p.z] : [0, 0], rivals: this.racers.filter((r) => r.kart !== k).map((r) => ({ x: r.kart.p.x, z: r.kart.p.z, color: r.spec.color })) },
        order: hudOrder,
        finished: false,
        spectating: true,
      });
      return;
    }
    const k = p.kart;
    // the next row ahead within 130 m shows its question
    let question: HudQuestion | null = null;
    let best = Infinity;
    let bestRow = -1;
    T.rows.forEach((row, ri) => {
      const d = deltaS(k.s, row.s, T.length);
      const rs = this.rows[ri];
      if (d > 0 && d < 130 && d < best && rs.feedbackT <= 0 && k.lap >= 0 && !k.finished && (this.phase === "racing" || this.phase === "finished")) {
        best = d;
        bestRow = ri;
      }
    });
    if (bestRow >= 0 && this.texts) {
      const rs = this.rows[bestRow];
      const tx = this.texts;
      question = {
        prompt: tx.prompts[rs.q] ?? "",
        lanes: rs.order.map((a, lane) => ({ text: (tx.answers[rs.q] || [])[a] ?? "", color: laneColor(lane) })),
        dist: best,
      };
      if (this.lastQuestionRow !== bestRow) {
        this.lastQuestionRow = bestRow;
        this.sfx.question();
        this.onEvent({ type: "question", q: rs.q, prompt: question.prompt });
      }
    } else this.lastQuestionRow = -1;
    const faces: BonusId[] = ["turbo", "shield", "peel", "coins", "nova", "triple"];
    const rolling = p.rollT > 0;
    if (rolling && Math.floor(p.rollT * 14) !== Math.floor((p.rollT + HUD_MS / 1000) * 14)) this.sfx.roulette(Math.floor(p.rollT * 14));
    const rivals = this.racers.filter((r) => r !== p).map((r) => ({ x: r.kart.p.x, z: r.kart.p.z, color: r.spec.color }));
    this.onHud({
      phase: this.phase,
      count: this.count,
      timeMs: this.phase === "finished" || this.phase === "podium" ? k.finishMs : this.raceT * 1000,
      lap: Math.max(1, Math.min(this.laps, k.lap + 1)),
      laps: this.laps,
      pos: this.positionOf(p),
      racers: this.racers.length,
      coins: k.coins,
      bonus: p.bonus,
      charges: p.charges,
      rolling,
      rollFace: faces[Math.floor(performance.now() / 70) % faces.length],
      speed: Math.max(0, k.speed) * 3.6,
      question,
      shield: k.shieldT > 0,
      nova: k.novaT > 0,
      boost: k.boostT > 0,
      spin: k.spinT > 0,
      air: k.air,
      drift: k.drifting ? (k.driftT > 1.7 ? 3 : k.driftT > 0.8 ? 2 : 1) : 0,
      map: { player: [k.p.x, k.p.z], rivals },
      order: hudOrder,
      finished: k.finished,
      spectating: false,
    });
  }

  /** Normalised outline for the mini-map. */
  mapOutline(): { pts: [number, number][]; min: [number, number]; max: [number, number] } | null {
    const T = this.track;
    if (!T) return null;
    return { pts: T.outline, min: [T.bounds.min.x, T.bounds.min.z], max: [T.bounds.max.x, T.bounds.max.z] };
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    if (this.ro) this.ro.disconnect();
    this.input.detach();
    this.clear();
    this.fx.dispose();
    this.skids.dispose();
    if (this.envTex) this.envTex.dispose();
    this.r.dispose();
  }
}

export { wrapS, sampleAt, pointAt };

/**
 * Quiz Kart Rally engine: renderer, cup world, five karts (player + four rivals), the race
 * (countdown, laps, positions), answer rows (question → boxes → bonus or spin-out), bonuses,
 * coins, boost pads and peels, camera and effects. React drives it through a small API and
 * receives HUD snapshots and race events through callbacks.
 */
import * as THREE from "three";
import { buildTrack, BuiltTrack, deltaS, sampleAt, wrapS } from "./track";
import { Kart, KartInput, KartEvents, newKartEvents, collideKarts, VMAX, COIN_MAX } from "./kart";
import { Driver } from "./ai";
import { Kit } from "./assets";
import { buildWorld, layoutRow, WorldVis } from "./world";
import { Sky, MOODS, Mood } from "./sky";
import { Fx } from "./fx";
import { Sfx } from "./audio";
import { Input } from "./input";
import { drawAnswer, drawScreen, nameTag, laneColor, AnswerState } from "./labels";
import { BonusId, rollBonus, BONUS_COLOR } from "./items";
import type { Cup } from "./types";

export type Phase = "demo" | "countdown" | "racing" | "finished";
export type Quality = "low" | "high";

export interface RaceTexts {
  questionTitle: string;
  prompts: string[];
  /** answers[q][a] */
  answers: string[][];
  correct: number[];
  explains: string[];
  racerNames: string[];
}

export interface HudQuestion {
  prompt: string;
  /** answers in lane order, left → right, with their lane colour */
  lanes: { text: string; color: string }[];
  dist: number;
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
  drift: 0 | 1 | 2 | 3;
  map: { player: [number, number]; rivals: { x: number; z: number; color: string }[] };
  finished: boolean;
}

export interface Standing {
  name: string;
  player: boolean;
  timeMs: number;
  color: string;
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
  | { type: "go" }
  | { type: "lap"; lap: number; laps: number }
  | { type: "question"; q: number; prompt: string }
  | { type: "answer"; q: number; correct: boolean; picked: string; right: string; prompt: string; explain: string; shielded: boolean }
  | { type: "missed"; q: number; prompt: string; right: string }
  | { type: "bonus"; id: BonusId }
  | { type: "used"; id: BonusId }
  | { type: "hit"; by: "peel" | "nova" }
  | { type: "finish"; result: RaceResult };

export interface RacerDef {
  kart: number; // index in kit.karts
  name: string;
  color: string;
}

const STEP = 1 / 120;
const MAX_FRAME_DT = 0.05;
const HUD_MS = 50;
const ROLL_T = 1.15;
const UP = new THREE.Vector3(0, 1, 0);
const KART_COLORS = ["#8c78ff", "#ff7aa2", "#ffb02e", "#3fd6b8", "#f5f0e6"];

interface RowState {
  /** question index for the current lap of the player */
  q: number;
  /** lane → answer index */
  order: number[];
  correctLane: number;
  centers: number[];
  /** lap the shown question belongs to (player lap) */
  lap: number;
  feedbackT: number;
  pickedLane: number;
}

interface KartView {
  root: THREE.Group;
  body: THREE.Object3D;
  wheelsF: THREE.Object3D[];
  wheelsB: THREE.Object3D[];
  character: THREE.Object3D | null;
  shield: THREE.Mesh;
  tag: THREE.Sprite | null;
}

interface Racer {
  kart: Kart;
  view: KartView;
  def: RacerDef;
  driver: Driver | null;
  prevS: number;
  bonus: BonusId | null;
  charges: number;
  rollT: number;
  rolled: BonusId;
  aiUseT: number;
}

interface Peel {
  obj: THREE.Object3D;
  p: THREE.Vector3;
  owner: number;
  t: number;
}

export class Engine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, 1, 0.3, 3000);
  sky = new Sky();
  sun = new THREE.DirectionalLight("#ffffff", 2.6);
  hemi = new THREE.HemisphereLight("#cfe4ff", "#5d7a3a", 1);
  fx = new Fx();
  input = new Input();

  cup: Cup | null = null;
  track: BuiltTrack | null = null;
  world: WorldVis | null = null;
  texts: RaceTexts | null = null;
  racers: Racer[] = [];
  player: Racer | null = null;
  rows: RowState[] = [];
  peels: Peel[] = [];

  phase: Phase = "demo";
  paused = false;
  laps = 3;
  count = 3;
  private countT = 0;
  private raceT = 0;
  private acc = 0;
  private qOrder: number[] = [];
  private qCursor = 0;
  private asked = 0;
  private answered = 0;
  private correct = 0;
  private finishT = -1;
  private resultSent = false;
  private lastHud = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camYaw = 0;
  private demoT = 0;
  private running = true;
  private raf = 0;
  private last = 0;
  private background = false;
  private frameMs: number[] = [];
  private scale = 1;
  private kev: KartEvents = newKartEvents();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private mtx = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private coinSpin = 0;
  private lastQuestionRow = -1;
  hudOn = false;
  /** demo camera: follow this racer instead of the leader (racer select screen) */
  focus: number | null = null;
  quality: Quality;

  onHud: (h: HudState) => void = () => {};
  onEvent: (e: RaceEvent) => void = () => {};

  constructor(private canvas: HTMLCanvasElement, public kit: Kit, quality: Quality, public sfx: Sfx, opts: { scale?: number } = {}) {
    this.quality = quality;
    this.scale = opts.scale ?? 1;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === "high", powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.add(this.sky.mesh, this.sun, this.sun.target, this.hemi, this.fx.points);
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -45;
    sc.right = sc.top = 45;
    sc.near = 1;
    sc.far = 260;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.04;
    this.applyQuality();
    this.input.attach();
    this.resize();
    window.addEventListener("resize", this.resize);
    this.last = performance.now();
    this.loop();
  }

  // ---------------------------------------------------------------- setup
  private applyQuality() {
    const hi = this.quality === "high";
    this.renderer.shadowMap.enabled = hi;
    this.sun.castShadow = hi;
    this.sky.setDetail(hi ? 5 : 3);
    this.fx.budget = hi ? 1 : 0.5;
    this.setPixelRatio();
  }

  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    this.applyQuality();
    // materials must recompile for the shadow change
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      (Array.isArray(m) ? m : [m]).forEach((x) => (x.needsUpdate = true));
    });
  }

  private setPixelRatio() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality === "high" ? 1.75 : 1.25);
    this.renderer.setPixelRatio(dpr * this.scale);
  }

  resize = () => {
    const c = this.canvas;
    const w = c.clientWidth || window.innerWidth;
    const h = c.clientHeight || window.innerHeight;
    this.setPixelRatio();
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    // narrow portrait screens: widen the view so the road and boxes stay visible
    this.camera.fov = this.camera.aspect < 1 ? 78 : 62;
    this.camera.updateProjectionMatrix();
    this.fx.setViewport(h * this.renderer.getPixelRatio());
  };

  setBackground(b: boolean) {
    this.background = b;
  }

  /** Builds the cup's world and puts the karts on the grid. */
  loadCup(cup: Cup, texts: RaceTexts, racers: RacerDef[], playerIndex: number, demo: boolean) {
    this.clearCup();
    this.cup = cup;
    this.texts = texts;
    this.laps = Math.max(1, Math.min(5, cup.laps ?? 3));
    const track = buildTrack(cup);
    this.track = track;
    const mood: Mood = (cup.mood as Mood) in MOODS ? (cup.mood as Mood) : "day";
    const md = MOODS[mood];
    this.sky.apply(md);
    this.sun.color.set(md.sunColor);
    this.sun.intensity = md.sunIntensity * 0.9;
    this.hemi.color.set(md.hemiSky);
    this.hemi.groundColor.set(md.hemiGround);
    this.hemi.intensity = md.hemiIntensity * 1.1;
    this.renderer.toneMappingExposure = md.exposure;
    this.scene.fog = new THREE.Fog(new THREE.Color(md.horizon), 180, 900);
    this.world = buildWorld(track, this.kit, { ground: cup.ground || "#7fb85a", seed: hashStr(cup.id), quality: this.quality });
    this.scene.add(this.world.root);

    // racers
    const n = Math.min(5, racers.length);
    this.racers = [];
    for (let i = 0; i < n; i++) {
      const def = racers[i];
      const kart = new Kart(track, i);
      const view = this.makeKartView(def, i !== playerIndex || demo);
      this.scene.add(view.root);
      const isPlayer = i === playerIndex && !demo;
      const r: Racer = {
        kart,
        view,
        def,
        driver: isPlayer ? null : new Driver(kart, [0.35, 0.55, 0.75, 0.9, 0.6][i % 5]),
        prevS: 0,
        bonus: null,
        charges: 0,
        rollT: 0,
        rolled: "turbo",
        aiUseT: 0,
      };
      this.racers.push(r);
      if (isPlayer) this.player = r;
    }
    if (demo) this.player = null;
    this.qOrder = shuffle(Array.from({ length: Math.max(1, cup.questions ? cup.questions.length : 1) }, (_, k) => k));
    this.qCursor = 0;
    this.resetRace(demo ? "demo" : "countdown");
  }

  private clearCup() {
    if (this.world) {
      this.scene.remove(this.world.root);
      this.world.dispose();
      this.world = null;
    }
    this.racers.forEach((r) => this.scene.remove(r.view.root));
    this.racers = [];
    this.peels.forEach((p) => this.scene.remove(p.obj));
    this.peels = [];
    this.player = null;
    this.fx.clear();
  }

  private makeKartView(def: RacerDef, tag: boolean): KartView {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const src = this.kit.karts[def.kart] || this.kit.karts[0];
    const wheelsF: THREE.Object3D[] = [];
    const wheelsB: THREE.Object3D[] = [];
    let character: THREE.Object3D | null = null;
    if (src) {
      const m = src.clone(true);
      // the Kenney karts face +Z; our forward is -Z
      m.rotation.y = Math.PI;
      m.traverse((o) => {
        const nm = o.name.toLowerCase();
        if (nm.indexOf("wheel-front") === 0) wheelsF.push(o);
        else if (nm.indexOf("wheel-back") === 0) wheelsB.push(o);
        else if (nm === "character") character = o;
      });
      body.add(m);
    } else {
      const fb = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 2.4), new THREE.MeshStandardMaterial({ color: def.color }));
      fb.position.y = 0.5;
      body.add(fb);
    }
    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(1.75, 20, 14),
      new THREE.MeshStandardMaterial({ color: "#5fd0ff", emissive: "#2aa8ff", emissiveIntensity: 0.6, transparent: true, opacity: 0.28, depthWrite: false })
    );
    shield.position.y = 1.0;
    shield.visible = false;
    root.add(shield);
    let t: THREE.Sprite | null = null;
    if (tag) {
      t = nameTag(def.name, def.color);
      t.position.y = 3.1;
      root.add(t);
    }
    return { root, body, wheelsF, wheelsB, character, shield, tag: t };
  }

  /** Grid positions, questions and counters back to the start. */
  resetRace(phase: Phase) {
    const T = this.track;
    if (!T) return;
    this.phase = phase;
    this.count = 4;
    this.countT = 0;
    this.raceT = 0;
    this.acc = 0;
    this.asked = this.answered = this.correct = 0;
    this.finishT = -1;
    this.resultSent = false;
    this.lastQuestionRow = -1;
    this.peels.forEach((p) => this.scene.remove(p.obj));
    this.peels = [];
    const hw = T.halfW;
    // the player starts 4th of 5 in a staggered grid behind the line
    const slots = this.racers.map((_, i) => i);
    if (this.player) {
      const pi = this.racers.indexOf(this.player);
      slots.splice(slots.indexOf(pi), 1);
      slots.splice(Math.min(3, slots.length), 0, pi);
    }
    slots.forEach((ri, k) => {
      const r = this.racers[ri];
      r.kart.reset(T.length - 7 - k * 5.5, (k % 2 ? 1 : -1) * hw * 0.42);
      r.kart.lap = -1;
      r.kart.halfway = true;
      r.prevS = r.kart.s;
      r.bonus = null;
      r.charges = 0;
      r.rollT = 0;
      r.aiUseT = 0;
      if (r.driver) r.driver.target = null;
    });
    this.rows = T.rows.map((row) => ({ q: 0, order: [], correctLane: 0, centers: [], lap: -99, feedbackT: 0, pickedLane: -1 }));
    T.rows.forEach((_, k) => this.assignRow(k, 0));
    this.world?.coins.hidden.forEach((_, k, a) => (a[k] = 0));
    this.setLamps(0);
    this.snapCamera();
  }

  // ---------------------------------------------------------------- rows
  private nextQuestion(): number {
    const q = this.qOrder[this.qCursor % this.qOrder.length];
    this.qCursor++;
    if (this.qCursor % this.qOrder.length === 0) this.qOrder = shuffle(this.qOrder.slice());
    return q;
  }

  private assignRow(k: number, lap: number) {
    const T = this.track!;
    const cup = this.cup!;
    const rs = this.rows[k];
    rs.lap = lap;
    rs.q = this.nextQuestion();
    const qd = cup.questions && cup.questions[rs.q];
    const nAns = qd ? Math.max(2, Math.min(4, qd.answers ? qd.answers.length : 2)) : 2;
    rs.order = shuffle(Array.from({ length: nAns }, (_, i) => i));
    const right = this.texts ? this.texts.correct[rs.q] : 0;
    rs.correctLane = Math.max(0, rs.order.indexOf(right));
    rs.feedbackT = 0;
    rs.pickedLane = -1;
    if (this.world) rs.centers = layoutRow(T, this.world.rows[k], T.rows[k].s, nAns);
    this.drawRow(k);
  }

  private drawRow(k: number) {
    const vis = this.world?.rows[k];
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
  relabel(texts: RaceTexts) {
    this.texts = texts;
    this.rows.forEach((_, k) => this.drawRow(k));
    this.racers.forEach((r, i) => {
      if (!r.view.tag) return;
      r.view.root.remove(r.view.tag);
      r.def.name = texts.racerNames[i] ?? r.def.name;
      r.view.tag = nameTag(r.def.name, r.def.color);
      r.view.tag.position.y = 3.1;
      r.view.root.add(r.view.tag);
    });
  }

  // ---------------------------------------------------------------- controls from React
  setPaused(p: boolean) {
    this.paused = p;
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
        k.boostT = Math.max(k.boostT, 1.4);
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
        this.fx.emit(18, this.tmp.copy(k.p).setY(k.p.y + 1.6), { color: ["#ffd23a", "#fff1a8"], speed: 3, up: 4 });
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
    const f = k.forward;
    const p = k.p.clone().addScaledVector(f, -2.8);
    const src = this.kit.models.banana;
    const obj = src ? src.clone(true) : new THREE.Mesh(new THREE.SphereGeometry(0.4), new THREE.MeshStandardMaterial({ color: "#ffd23a" }));
    obj.position.copy(p);
    obj.rotation.y = Math.random() * 6;
    this.scene.add(obj);
    this.peels.push({ obj, p, owner: this.racers.indexOf(r), t: 0 });
    if (this.peels.length > 12) {
      const old = this.peels.shift()!;
      this.scene.remove(old.obj);
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
    if (this.background && (Math.floor(now / 16.7) % 2 === 1)) return; // half rate behind menus
    this.frame(dt);
    this.governor(dt * 1000);
  };

  /** One rendered frame (also callable headless for tests). */
  frame(dt: number) {
    if (!this.track) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (!this.paused) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 8) {
        this.tick(STEP);
        this.acc -= STEP;
        steps++;
      }
      if (steps === 8) this.acc = 0;
      this.animate(dt);
      this.fx.update(dt);
    }
    this.updateCamera(dt);
    this.sky.mat.uniforms.time.value += dt;
    this.renderer.render(this.scene, this.camera);
    const t = performance.now();
    if (this.hudOn && t - this.lastHud > HUD_MS) {
      this.lastHud = t;
      this.emitHud();
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
      if (this.resultSent) break;
    }
    this.snapCamera();
  }

  get done() {
    return this.resultSent;
  }

  private governor(ms: number) {
    this.frameMs.push(ms);
    if (this.frameMs.length < 90) return;
    const avg = this.frameMs.reduce((a, b) => a + b, 0) / this.frameMs.length;
    this.frameMs = [];
    if (avg > 26 && this.scale > 0.55) {
      this.scale = Math.max(0.55, this.scale - 0.15);
      this.setPixelRatio();
    } else if (avg < 17 && this.scale < 1) {
      this.scale = Math.min(1, this.scale + 0.1);
      this.setPixelRatio();
    }
  }

  // ---------------------------------------------------------------- simulation
  private tick(dt: number) {
    const T = this.track!;
    if (this.phase === "countdown") {
      this.countT += dt;
      const c = 3 - Math.floor(this.countT / 0.85);
      if (c !== this.count) {
        this.count = c;
        if (c > 0) {
          this.sfx.countBeep();
          this.setLamps(4 - c);
        } else {
          this.phase = "racing";
          this.setLamps(5);
          this.sfx.go();
          this.onEvent({ type: "go" });
          window.setTimeout(() => this.setLamps(0), 1200);
        }
      }
      return;
    }
    if (this.phase === "racing" || this.phase === "finished") this.raceT += dt;
    const playerProg = this.player ? this.player.kart.progress() : this.leaderProgress();
    const inputs: KartInput[] = this.racers.map((r) => {
      if (r === this.player && !r.kart.finished) {
        if (this.phase !== "racing") return { throttle: 0, brake: 0, steer: 0, drift: false };
        return this.input.read();
      }
      return r.driver ? r.driver.drive(T, dt, playerProg) : { throttle: 0, brake: 0, steer: 0, drift: false };
    });
    this.racers.forEach((r, i) => {
      const k = r.kart;
      const ev = this.kev;
      ev.wall = 0;
      ev.miniTurbo = 0;
      ev.driftStart = false;
      r.prevS = k.s;
      k.step(dt, inputs[i], ev);
      if (r === this.player) {
        if (ev.wall > 0.15) this.sfx.wall(ev.wall);
        if (ev.miniTurbo) {
          this.sfx.miniTurbo(ev.miniTurbo);
          this.fx.emit(16, this.tmp.copy(k.p).setY(k.p.y + 0.5), { color: ev.miniTurbo === 2 ? ["#ff8a1e", "#ffd23a"] : ["#4fc3ff", "#bfefff"], speed: 4, up: 2, dir: k.forward.multiplyScalar(-1) });
        }
        if (ev.driftStart) this.sfx.driftStart();
      }
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
      // rivals use their bonus after a short think
      if (r !== this.player && r.bonus && r.aiUseT > 0) {
        r.aiUseT -= dt;
        if (r.aiUseT <= 0) {
          this.applyBonus(r, false);
          if (r.bonus) r.aiUseT = 0.6;
        }
      }
    });
    collideKarts(
      this.racers.map((r) => r.kart),
      (a, b, s) => {
        if (a.novaT > 0 && b.novaT <= 0) this.knock(b, "nova");
        else if (b.novaT > 0 && a.novaT <= 0) this.knock(a, "nova");
        if (this.player && (a === this.player.kart || b === this.player.kart)) this.sfx.bump(s);
      }
    );
    this.peelLogic(dt);
    // finish: wait a moment for the rivals, then report
    if (this.phase === "finished" && !this.resultSent) {
      this.finishT += dt;
      const allIn = this.racers.every((r) => r.kart.finished);
      if (this.finishT > 4.5 || allIn) this.sendResult();
    }
  }

  private leaderProgress() {
    let m = -Infinity;
    this.racers.forEach((r) => (m = Math.max(m, r.kart.progress())));
    return m;
  }

  private knock(k: Kart, by: "peel" | "nova") {
    if (k.shieldT > 0) {
      k.shieldT = 0;
      if (this.player && k === this.player.kart) this.sfx.shieldPop();
      return;
    }
    if (k.spinOut(1.1)) {
      this.fx.emit(14, this.tmp.copy(k.p).setY(k.p.y + 1.8), { color: ["#ffe45c", "#ffffff"], speed: 3, up: 3, grav: 3 });
      if (this.player && k === this.player.kart) {
        this.sfx.spin();
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
        } else if (r === this.player && k.lap > 0) {
          if (k.lap === this.laps - 1) this.sfx.finalLap();
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
    // the player's kart drives itself to the end of the lap
    p.driver = new Driver(p.kart, 0.6);
  }

  private positionOf(r: Racer) {
    const order = this.standings();
    return order.indexOf(r) + 1;
  }

  /** Racers in race order. */
  standings(): Racer[] {
    return this.racers.slice().sort((a, b) => {
      if (a.kart.finished && b.kart.finished) return a.kart.finishMs - b.kart.finishMs;
      if (a.kart.finished) return -1;
      if (b.kart.finished) return 1;
      return b.kart.progress() - a.kart.progress();
    });
  }

  private sendResult() {
    this.resultSent = true;
    const p = this.player!;
    const order = this.standings();
    const L = this.track!.length;
    const t = this.raceT * 1000;
    const standings: Standing[] = order.map((r) => {
      let ms = r.kart.finishMs;
      if (!r.kart.finished) {
        const left = this.laps * L - r.kart.progress();
        ms = t + (left / Math.max(12, VMAX * 0.75)) * 1000;
      }
      return { name: r.def.name, player: r === p, timeMs: Math.round(ms), color: r.def.color };
    });
    standings.sort((a, b) => a.timeMs - b.timeMs);
    const position = standings.findIndex((s) => s.player) + 1;
    this.onEvent({
      type: "finish",
      result: {
        position,
        racers: this.racers.length,
        timeMs: Math.round(p.kart.finishMs),
        correct: this.correct,
        answered: this.answered,
        asked: this.asked,
        coins: p.kart.coins,
        standings,
      },
    });
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
      }
      if (!(before > 0 && after <= 0 && before < 20)) return;
      if (k.lap < 0) return;
      // crossed the row: which lane?
      const hw = T.halfW;
      const lanes = rs.centers.length;
      const vis = this.world?.rows[ri];
      let lane = -1;
      if (Math.abs(k.lat) <= hw + 0.4 && lanes > 0) lane = Math.max(0, Math.min(lanes - 1, Math.floor(((k.lat + hw) / (2 * hw)) * lanes)));
      if (vis && lane >= 0) {
        vis.respawn[lane] = 1.3;
        const bp = vis.boxes[lane].position;
        this.fx.emit(20, bp, { color: ["#b49bff", "#ffffff", "#ffd23a"], speed: 5, up: 4 });
      }
      if (isPlayer) this.playerAnswer(ri, lane);
      else if (lane >= 0) this.rivalAnswer(r, lane === rs.correctLane);
    });
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
      if (ok) {
        this.correct++;
        this.sfx.correct();
        this.fx.emit(36, this.tmp.copy(p.kart.p).setY(p.kart.p.y + 2.2), { color: ["#3ddc6b", "#ffd23a", "#4fc3ff", "#ff7aa2"], speed: 6, up: 6, grav: 7 });
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
          this.fx.emit(16, this.tmp.copy(p.kart.p).setY(p.kart.p.y + 1.8), { color: ["#ffe45c", "#ffffff"], speed: 3, up: 3, grav: 3 });
        }
      }
      this.onEvent({ type: "answer", q: rs.q, correct: ok, picked, right, prompt, explain: tx.explains[rs.q] ?? "", shielded });
    }
    // show the result on the cards, then the next question for the next lap
    rs.feedbackT = 1.6;
    rs.pickedLane = lane;
    this.drawRow(ri);
  }

  private rivalAnswer(r: Racer, ok: boolean) {
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
      if (dx * dx + dz * dz < 2.4) {
        coins.hidden[c] = 7;
        if (k.coins < COIN_MAX) k.coins++;
        if (r === this.player) {
          this.sfx.coin();
          this.fx.emit(8, this.tmp.set(e[12], e[13], e[14]), { color: ["#ffd23a", "#fff6c8"], speed: 2.5, up: 3 });
        }
      }
    }
    // boost pads
    for (let b = 0; b < T.boosts.length; b++) {
      const bp = T.boosts[b];
      if (Math.abs(deltaS(k.s, bp.s, T.length)) < 3 && Math.abs(k.lat - bp.lat) < 2.2) {
        if (k.boostT < 0.5 && r === this.player) this.sfx.boost();
        k.boostT = Math.max(k.boostT, 1.1);
      }
    }
  }

  private peelLogic(dt: number) {
    for (let i = this.peels.length - 1; i >= 0; i--) {
      const pl = this.peels[i];
      pl.t += dt;
      let hit = false;
      for (let j = 0; j < this.racers.length && !hit; j++) {
        const k = this.racers[j].kart;
        if (j === pl.owner && pl.t < 1.2) continue;
        const dx = k.p.x - pl.p.x,
          dz = k.p.z - pl.p.z;
        if (dx * dx + dz * dz < 1.6 * 1.6) {
          if (k.novaT <= 0) this.knock(k, "peel");
          hit = true;
        }
      }
      if (hit || pl.t > 70) {
        this.scene.remove(pl.obj);
        this.peels.splice(i, 1);
      } else pl.obj.position.y = pl.p.y + 0.05;
    }
  }

  // ---------------------------------------------------------------- visuals
  private setLamps(n: number) {
    const lamps = this.world?.lamps ?? [];
    lamps.forEach((m, k) => {
      const on = n === 5 ? true : k < n * 2 - (n > 2 ? 1 : 0);
      const go = n === 5;
      m.emissive.set(go ? "#2bff6a" : "#ff2a1a");
      m.emissiveIntensity = on ? 3.2 : 0;
      m.color.set(on ? (go ? "#3cff7a" : "#ff4a3a") : "#40141a");
    });
  }

  private animate(dt: number) {
    const T = this.track!;
    const w = this.world!;
    const t = performance.now() / 1000;
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
    w.boostGlow.forEach((m) => (m.emissiveIntensity = 2.2 + Math.sin(t * 9) * 1.2));
    // coins spin, collected ones come back later
    this.coinSpin += dt * 3;
    const cv = w.coins;
    const rot = this.q.setFromAxisAngle(UP, this.coinSpin);
    for (let c = 0; c < cv.base.length; c++) {
      if (cv.hidden[c] > 0) cv.hidden[c] -= dt;
      const e = cv.base[c].elements;
      const vis = cv.hidden[c] <= 0;
      this.mtx.compose(this.tmp.set(e[12], e[13] + Math.sin(t * 3 + c) * 0.12, e[14]), rot, this.tmp2.setScalar(vis ? 1 : 0.0001));
      for (let m = 0; m < cv.mesh.length; m++) {
        const M = new THREE.Matrix4().multiplyMatrices(this.mtx, cv.locals[m]);
        cv.mesh[m].setMatrixAt(c, M);
      }
    }
    cv.mesh.forEach((m) => (m.instanceMatrix.needsUpdate = true));
    // peels wobble
    this.peels.forEach((p) => (p.obj.rotation.y += dt * 0.5));

    // karts
    this.racers.forEach((r) => {
      const k = r.kart;
      const v = r.view;
      v.root.position.copy(k.p);
      v.root.rotation.y = k.yaw;
      v.body.rotation.y = k.spinYaw + (k.drifting ? k.driftDir * -0.32 : 0);
      v.body.position.y = Math.sin(Math.min(1, k.hop / 0.35) * Math.PI) * 0.35;
      v.body.rotation.z = k.drifting ? k.driftDir * 0.05 : -k.steerSm * 0.04 * Math.min(1, k.speed / 15);
      v.wheelsF.forEach((wh) => {
        wh.rotation.x = k.wheelSpin;
        wh.rotation.y = -k.steerSm * 0.45;
      });
      v.wheelsB.forEach((wh) => (wh.rotation.x = k.wheelSpin));
      if (v.character) v.character.rotation.z = k.steerSm * 0.12;
      v.shield.visible = k.shieldT > 0;
      if (v.shield.visible) v.shield.scale.setScalar(1 + Math.sin(t * 6) * 0.03);
      if (v.tag) {
        const d2 = this.camera.position.distanceToSquared(k.p);
        v.tag.visible = d2 > 9 * 9 && d2 < 90 * 90;
      }
      // trails
      const f = k.forward;
      const back = this.tmp.copy(k.p).addScaledVector(f, -1.2);
      back.y += 0.35;
      if (k.drifting && k.driftT > 0.25) {
        const col = k.driftT > 1.7 ? ["#ff8a1e", "#ffd23a"] : k.driftT > 0.8 ? ["#4fc3ff", "#bfefff"] : ["#ffffff", "#dddddd"];
        this.fx.emit(1, back, { color: col, speed: 2.2, up: 2, size: 0.28, life: 0.35 });
      }
      if (k.boostT > 0) this.fx.emit(1, back, { color: ["#ff8a1e", "#ffd23a", "#ff5a1e"], speed: 2, up: 1, size: 0.45, life: 0.3, grav: -2, dir: f.clone().multiplyScalar(-1) });
      if (k.novaT > 0) this.fx.emit(1, this.tmp2.copy(k.p).setY(k.p.y + 1), { color: [BONUS_COLOR.nova, "#ffffff", "#4fc3ff", "#ffd23a"], speed: 2, up: 2, size: 0.35, life: 0.5, grav: 1 });
      if (k.onGrass && k.speed > 6 && Math.random() < 0.4) this.fx.emit(1, back, { color: ["#9b8a62", "#b8a77c"], speed: 1.2, up: 1.4, size: 0.5, life: 0.5, grav: 1 });
    });
    void T;
  }

  private snapCamera() {
    const target = this.camTarget();
    if (!target) return;
    const f = target.forward;
    this.camYaw = target.yaw;
    this.camPos.copy(target.p).addScaledVector(f, -7.2).setY(target.p.y + 3.9);
    this.camLook.copy(target.p).addScaledVector(f, 9).setY(target.p.y + 1.0);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  private camTarget(): Kart | null {
    if (this.player) return this.player.kart;
    if (this.focus !== null && this.racers[this.focus]) return this.racers[this.focus].kart;
    // demo: follow the leader
    const s = this.standings();
    return s.length ? s[0].kart : null;
  }

  private updateCamera(dt: number) {
    const k = this.camTarget();
    if (!k) return;
    if (this.phase === "demo" || (this.phase === "finished" && this.finishT > 0.6)) {
      // slow orbit around the kart
      this.demoT += dt * 0.35;
      const a = k.yaw + Math.PI * 0.75 + Math.sin(this.demoT) * 0.9;
      const want = this.tmp.set(k.p.x + Math.sin(a) * 9, k.p.y + 3.6, k.p.z + Math.cos(a) * 9);
      this.camPos.lerp(want, 1 - Math.exp(-dt * 2.5));
      this.camLook.lerp(this.tmp2.copy(k.p).setY(k.p.y + 1), 1 - Math.exp(-dt * 6));
    } else {
      // chase cam follows the kart's travel direction, not its spin
      let d = k.yaw - this.camYaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.camYaw += d * (1 - Math.exp(-dt * 5));
      const f = this.tmp2.set(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
      const sp = Math.max(0, k.speed) / VMAX;
      const back = 7.2 + sp * 1.2 + (k.boostT > 0 ? 0.8 : 0);
      const want = this.tmp.copy(k.p).addScaledVector(f, -back);
      want.y = k.p.y + 3.9 + sp * 0.3;
      this.camPos.lerp(want, 1 - Math.exp(-dt * 10));
      const look = this.tmp.copy(k.p).addScaledVector(f, 9);
      look.y = k.p.y + 1.0;
      this.camLook.lerp(look, 1 - Math.exp(-dt * 12));
      const fovBase = this.camera.aspect < 1 ? 78 : 62;
      const fov = fovBase + sp * 6 + (k.boostT > 0 ? 7 : 0);
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 4));
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    // shadows follow the camera
    this.sun.target.position.copy(k.p);
    this.sun.position.copy(k.p).addScaledVector(this.sky.sunDir, 120);
    this.sky.mesh.position.copy(this.camera.position);
    // engine sound
    if (this.player && (this.phase === "racing" || this.phase === "countdown") && !this.paused) this.sfx.engine(Math.min(1, Math.max(0, this.player.kart.speed) / (VMAX * 1.3)), this.player.kart.boostT > 0, true);
    else this.sfx.engine(0, false, false);
  }

  private emitHud() {
    const T = this.track;
    const p = this.player;
    if (!T || !p) return;
    const k = p.kart;
    // the next row ahead within 130 m shows its question
    let question: HudQuestion | null = null;
    let best = Infinity;
    let bestRow = -1;
    T.rows.forEach((row, ri) => {
      const d = deltaS(k.s, row.s, T.length);
      const rs = this.rows[ri];
      if (d > 0 && d < 130 && d < best && rs.feedbackT <= 0 && k.lap >= 0 && !k.finished) {
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
    const rivals = this.racers.filter((r) => r !== p).map((r) => ({ x: r.kart.p.x, z: r.kart.p.z, color: r.def.color }));
    this.onHud({
      phase: this.phase,
      count: this.count,
      timeMs: this.phase === "finished" ? k.finishMs : this.raceT * 1000,
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
      drift: k.drifting ? (k.driftT > 1.7 ? 3 : k.driftT > 0.8 ? 2 : 1) : 0,
      map: { player: [k.p.x, k.p.z], rivals },
      finished: k.finished,
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
    this.input.detach();
    this.clearCup();
    this.fx.dispose();
    this.renderer.dispose();
  }
}

export function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
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

export { KART_COLORS, wrapS, sampleAt };

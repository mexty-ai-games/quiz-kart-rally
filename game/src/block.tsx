import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMexty, useLanguage, useCloudSave } from "@mexty/sdk";
import "./game/game.css";
import { Engine, HudState, RaceEvent, RaceResult, RaceTexts, RacerSpec, Tier, Standing } from "./game/engine";
import { loadKit, Kit } from "./game/assets";
import { Sfx } from "./game/audio";
import { autoTier } from "./game/render";
import { Title, HowTo, CupSelect, RacerSelect, Hud, Pause, Results, Loading, Board, BoardEntry, Progress, Flash, AnswerLog, T } from "./game/ui";
import { OnlineHub, LobbyRoom, CodeEntry } from "./game/ui-online";
import { Lobby, LobbyState, Directory, LobbyAd, newCode, cleanCode, isCode, SharedStore, LobbyInfo } from "./net/lobby";
import { netMode } from "./net/transport";

/**
 * A text in every language the game is played in, keyed by ISO 639-1 code: { "en": "Start", "fr": "Départ" }.
 * To add a language, add its code here and fill it in every variant.
 */
export interface LocalizedText {
  /** English */
  en?: string;
  /** French */
  fr?: string;
}

/** One question: shown on the gantry before a row of item boxes; each box carries one answer. */
export interface Question {
  id: string;
  /** Short question, e.g. "7 × 8". */
  prompt: LocalizedText;
  /** 2 to 4 answers: one box (and one lane) per answer. */
  answers: LocalizedText[];
  /** Index of the right answer in `answers`. */
  correct: number;
  /** Short explanation shown after a wrong answer, e.g. "7 × 8 = 56". */
  explain?: LocalizedText;
}

/** A control point of the circuit, in metres (the loop is closed and smoothed automatically). */
export interface TrackPoint {
  x: number;
  z: number;
  /** Height in metres (hills), default 0. */
  y?: number;
}

/** A cup: one circuit with its question set. */
export interface Cup {
  id: string;
  name: LocalizedText;
  /** What the questions practise, shown on the cup card. */
  topic: LocalizedText;
  /** Lighting: morning, day, sunset or night. */
  mood?: "morning" | "day" | "sunset" | "night";
  /** Scenery: meadow, hills, desert or night (neon city). Default: from the lighting. */
  theme?: "meadow" | "hills" | "desert" | "night";
  /** Lawn colour (CSS colour). */
  ground?: string;
  /** Laps per race (1–5, default 3). */
  laps?: number;
  /** Road width in metres (12–24, default 16). */
  width?: number;
  /** Banking of the corners in degrees (0–16, default 9). */
  bank?: number;
  /** The circuit's control points, driven in order; the first point is the start line. */
  points: TrackPoint[];
  /** Where the answer rows stand, as fractions of a lap (0..1), e.g. [0.3, 0.62, 0.86]. Put them on straights. */
  rows?: number[];
  /** Where the boost pads lie, as fractions of a lap. */
  boosts?: number[];
  /** Where the jump ramps stand (the lip), as fractions of a lap. Put them on straights, away from rows. */
  jumps?: number[];
  /** The question bank: questions are drawn in a shuffled order, one per row per lap. */
  questions: Question[];
}

export interface RacerText {
  name: LocalizedText;
  /** Name tag and mini-map colour. */
  color: string;
}

export interface BonusText {
  name: LocalizedText;
  /** One-line explanation on the How to play screen. */
  hint: LocalizedText;
}

/** Names of the random bonuses a right answer gives. */
export interface BonusTexts {
  turbo: BonusText;
  triple: BonusText;
  shield: BonusText;
  peel: BonusText;
  coins: BonusText;
  nova: BonusText;
}

export interface UiText {
  play: LocalizedText;
  playSolo: LocalizedText;
  playOnline: LocalizedText;
  howToPlay: LocalizedText;
  howSteps: LocalizedText[];
  controlsKeys: LocalizedText;
  controlsTouch: LocalizedText;
  bonusesTitle: LocalizedText;
  back: LocalizedText;
  loading: LocalizedText;
  chooseCup: LocalizedText;
  lockedHint: LocalizedText;
  notRaced: LocalizedText;
  laps: LocalizedText;
  chooseRacer: LocalizedText;
  start: LocalizedText;
  getReady: LocalizedText;
  lap: LocalizedText;
  finalLap: LocalizedText;
  go: LocalizedText;
  question: LocalizedText;
  useBonus: LocalizedText;
  coins: LocalizedText;
  drift: LocalizedText;
  brake: LocalizedText;
  /** touch pedal: hold to accelerate */
  gas?: LocalizedText;
  /** flash when gas is pressed at the right moment of the countdown */
  rocketStart?: LocalizedText;
  left: LocalizedText;
  right: LocalizedText;
  correct: LocalizedText;
  wrong: LocalizedText;
  answerWas: LocalizedText;
  missed: LocalizedText;
  missedShort: LocalizedText;
  shielded: LocalizedText;
  hitPeel: LocalizedText;
  hitNova: LocalizedText;
  trick: LocalizedText;
  finish: LocalizedText;
  paused: LocalizedText;
  resume: LocalizedText;
  restart: LocalizedText;
  quit: LocalizedText;
  sound: LocalizedText;
  quality: LocalizedText;
  qualityAuto: LocalizedText;
  qualityLow: LocalizedText;
  qualityMedium: LocalizedText;
  qualityHigh: LocalizedText;
  qualityUltra: LocalizedText;
  on: LocalizedText;
  off: LocalizedText;
  podium: LocalizedText;
  keepGoing: LocalizedText;
  newBest: LocalizedText;
  rightAnswers: LocalizedText;
  standings: LocalizedText;
  yourAnswers: LocalizedText;
  retry: LocalizedText;
  nextCup: LocalizedText;
  familyBoard: LocalizedText;
  guestHint: LocalizedText;
  boardEmpty: LocalizedText;
  /** "1st", "2nd"… one per position. */
  ordinals: LocalizedText[];
  /** Online play */
  quickRace: LocalizedText;
  quickRaceHint: LocalizedText;
  joinWithCode: LocalizedText;
  createRace: LocalizedText;
  publicRace: LocalizedText;
  privateRace: LocalizedText;
  publicHint: LocalizedText;
  privateHint: LocalizedText;
  openRaces: LocalizedText;
  noOpenRaces: LocalizedText;
  join: LocalizedText;
  watch: LocalizedText;
  waiting: LocalizedText;
  racing: LocalizedText;
  enterCode: LocalizedText;
  codeNotFound: LocalizedText;
  lobbyFull: LocalizedText;
  connecting: LocalizedText;
  onlineUnavailable: LocalizedText;
  leave: LocalizedText;
  players: LocalizedText;
  you: LocalizedText;
  hostTag: LocalizedText;
  aiTag: LocalizedText;
  waitingForHost: LocalizedText;
  startRace: LocalizedText;
  startsIn: LocalizedText;
  aiFill: LocalizedText;
  shareCode: LocalizedText;
  scanToJoin: LocalizedText;
  watching: LocalizedText;
  nextRaceSoon: LocalizedText;
  backToLobby: LocalizedText;
  pickCup: LocalizedText;
}

/** A model of the asset kit: `id` is the name the game looks for (e.g. "item_box_v2", "windmill"). */
export interface ModelRef {
  id: string;
  url: string;
}

/** URLs of the asset kit (GLB models). Karts: Kenney Car Kit (CC0); boxes, coins, peels: Kenney Toy Car Kit (CC0); track furniture and scenery: built in Blender. */
export interface AssetUrls {
  /** One kart per racer, in the same order as `racers`. */
  karts: string[];
  /** Every other model, by id. */
  models: ModelRef[];
}

export interface BlockProps {
  title?: LocalizedText;
  subtitle?: LocalizedText;
  /** The cups, in order (finishing one unlocks the next). */
  cups?: Cup[];
  /** The five racers (the player picks one, the others are the rivals). */
  racers?: RacerText[];
  bonuses?: BonusTexts;
  ui?: UiText;
  assets?: AssetUrls;
  /** Leaderboard id prefix (one board per cup). */
  boardPrefix?: string;
  /** Online races: the link a QR code opens to join a private race; {code} is replaced by the race code. */
  joinLink?: string;
}

const DEBUG = (() => {
  try {
    return /qkdebug/.test(window.location.search);
  } catch {
    return false;
  }
})();

type Screen = "loading" | "title" | "howto" | "cups" | "racer" | "race" | "results" | "online" | "lobby";

const SCORE_BASE = 10_000_000;
const EMPTY: Progress = { unlocked: 0, best: {}, racer: 0 };
const ADJ = ["Blue", "Brave", "Bright", "Calm", "Clever", "Cosmic", "Curious", "Gentle", "Golden", "Happy", "Jolly", "Lucky", "Mighty", "Quick", "Sunny", "Swift"];
const ANI = ["Fox", "Owl", "Panda", "Otter", "Tiger", "Koala", "Dolphin", "Falcon", "Turtle", "Rabbit", "Penguin", "Lion", "Hedgehog", "Whale", "Lynx", "Robin"];

const lsGet = (k: string) => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* storage unavailable */
  }
};

/** SDK calls never break the game: a missing or failing call is just "not stored". */
function safe(f: () => Promise<boolean>): Promise<boolean> {
  try {
    return Promise.resolve(f()).catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

/** A friendly made-up nickname for players the store gives none (guests, previews). */
function localNick() {
  const saved = lsGet("qk-nick");
  if (saved) return saved;
  const n = `${ADJ[Math.floor(Math.random() * 16)]} ${ANI[Math.floor(Math.random() * 16)]} ${10 + Math.floor(Math.random() * 90)}`;
  lsSet("qk-nick", n);
  return n;
}

function joinCodeFromUrl(): string {
  try {
    const sources = [window.location.search, window.location.hash.replace(/^#/, "?"), (document.referrer || "").replace(/^[^?]*/, "")];
    for (let i = 0; i < sources.length; i++) {
      const q = new URLSearchParams(sources[i]);
      const c = cleanCode(q.get("join") || q.get("race") || "");
      if (isCode(c)) return c;
    }
  } catch {
    /* no URL */
  }
  return "";
}

type TierPref = "auto" | Tier;
function initialTierPref(): TierPref {
  const q = lsGet("qk-tier");
  return q === "low" || q === "medium" || q === "high" || q === "ultra" ? q : "auto";
}

interface HudStore {
  get: () => HudState | null;
  set: (h: HudState) => void;
  sub: (fn: () => void) => () => void;
}
function makeHudStore(): HudStore {
  let cur: HudState | null = null;
  const subs: (() => void)[] = [];
  return {
    get: () => cur,
    set: (h) => {
      cur = h;
      subs.slice().forEach((f) => f());
    },
    sub: (f) => {
      subs.push(f);
      return () => {
        const i = subs.indexOf(f);
        if (i >= 0) subs.splice(i, 1);
      };
    },
  };
}
const LiveHud: React.FC<{ store: HudStore; children: (h: HudState) => React.ReactNode }> = ({ store, children }) => {
  const h = useSyncExternalStore(store.sub, store.get, store.get);
  return h ? <>{children(h)}</> : null;
};

export const Block: React.FC<BlockProps> = (props) => {
  const cups = props.cups ?? [];
  const racersT = props.racers ?? [];
  const ui = (props.ui ?? {}) as UiText;
  const bonuses = (props.bonuses ?? {}) as BonusTexts;
  const mexty = useMexty();
  const { t: tl } = useLanguage();
  const t: T = useCallback((x) => (x ? tl(x as any) : ""), [tl]);
  const prefix = props.boardPrefix || "cup";

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Fit the game to the part of the screen you can actually see. On phones, 100vh is the height with
  // the browser bars hidden, so a 100vh game loses its bottom (touch buttons, menu buttons) under them.
  useEffect(() => {
    let raf = 0;
    const fit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = rootRef.current;
        if (!el) return;
        const vv = window.visualViewport;
        const vh = vv ? vv.height : window.innerHeight;
        const top = Math.max(0, el.getBoundingClientRect().top + (window.scrollY || 0));
        // a header above the game (player bar) comes off the height; a game further down a page keeps the full screen
        const h = Math.max(240, Math.round(top < vh * 0.4 ? vh - top : vh));
        if (el.style.height !== h + "px") el.style.height = h + "px";
      });
    };
    fit();
    const vv = window.visualViewport;
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    if (vv) vv.addEventListener("resize", fit);
    const iv = window.setInterval(fit, 1000); // host layout changes (headers appearing, iframes resized)
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
      if (vv) vv.removeEventListener("resize", fit);
      window.clearInterval(iv);
    };
  }, []);
  const engineRef = useRef<Engine | null>(null);
  const sfxRef = useRef<Sfx>(new Sfx());
  const hudStore = useMemo(makeHudStore, []);
  const [kit, setKit] = useState<Kit | null>(null);
  const [loadP, setLoadP] = useState(0);
  const [screen, setScreen] = useState<Screen>("loading");
  const [ci, setCi] = useState(0);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [userPaused, setUserPaused] = useState(false);
  const [tierPref, setTierPrefS] = useState<TierPref>(initialTierPref);
  const [tierNow, setTierNow] = useState<Tier>("high");
  const [soundOn, setSoundOn] = useState(lsGet("qk-sound") !== "0");
  const [result, setResult] = useState<(RaceResult & { record: boolean; online: boolean }) | null>(null);
  const answersRef = useRef<AnswerLog[]>([]);
  const [board, setBoard] = useState<{ loading: boolean; entries: BoardEntry[] }>({ loading: false, entries: [] });
  const [guest, setGuest] = useState(true);
  const [nick, setNick] = useState<string>("");
  const { value: saved, save } = useCloudSave<Progress>("progress", EMPTY);
  const prog: Progress = { ...EMPTY, ...(saved ?? {}) };
  if (DEBUG) prog.unlocked = 99;
  const progRef = useRef(prog);
  progRef.current = prog;
  const [racer, setRacer] = useState(0);
  const lastHover = useRef<Element | null>(null);
  // online
  const dirRef = useRef<Directory | null>(null);
  const lobbyRef = useRef<Lobby | null>(null);
  const [lobbyState, setLobbyState] = useState<LobbyState | null>(null);
  const [ads, setAds] = useState<LobbyAd[]>([]);
  const [dirStatus, setDirStatus] = useState<string>("idle");
  const [codeOpen, setCodeOpen] = useState(false);
  const [onlineError, setOnlineError] = useState<string>("");
  const raceIdRef = useRef(0);
  const wasHostRef = useRef(false);
  const pendingJoin = useRef<string>(joinCodeFromUrl());

  const touch = useMemo(() => {
    if (typeof window === "undefined") return false;
    return !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || "ontouchstart" in window;
  }, []);
  const cup = cups[ci];
  const fallbackApi = useMemo(() => {
    const u = props.assets && props.assets.karts && props.assets.karts[0];
    return /mexty\.ai/.test(u || "") ? new URL(u!).origin : "https://api.mexty.ai";
  }, [props.assets]);

  // ------------------------------------------------------------ boot
  useEffect(() => {
    mexty.ready();
    mexty
      .getPlayer()
      .then((p) => {
        setGuest(p.isGuest);
        setNick(p.nickname || localNick());
      })
      .catch(() => setNick(localNick()));
  }, []);

  useEffect(() => {
    if (saved && typeof saved.racer === "number") setRacer(Math.max(0, Math.min(racersT.length - 1, saved.racer)));
  }, [saved && saved.racer]);

  useEffect(() => {
    let alive = true;
    loadKit(props.assets, (p) => alive && setLoadP(p)).then((k) => alive && setKit(k));
    return () => {
      alive = false;
    };
  }, [JSON.stringify(props.assets ?? {})]);

  const racerName = useCallback((i: number) => t((racersT[i] || racersT[0] || ({} as RacerText)).name) || `#${i + 1}`, [racersT, t]);
  const racerColor = (i: number) => (racersT[i] && racersT[i].color) || "#8c78ff";

  const raceTexts = useCallback(
    (c: Cup): RaceTexts => ({
      questionTitle: t(ui.question),
      prompts: (c.questions ?? []).map((q) => t(q.prompt)),
      answers: (c.questions ?? []).map((q) => (q.answers ?? []).map((a) => t(a))),
      correct: (c.questions ?? []).map((q) => Math.max(0, Math.min((q.answers ?? []).length - 1, q.correct ?? 0))),
      explains: (c.questions ?? []).map((q) => t(q.explain)),
    }),
    [t, ui]
  );

  /** Solo grid: the player 4th of five, the other racers as AI. */
  const soloGrid = useCallback(
    (me: number): RacerSpec[] => {
      const n = Math.min(5, Math.max(1, racersT.length));
      const others: RacerSpec[] = [];
      for (let i = 0; i < n; i++) if (i !== me) others.push({ id: `ai${i}`, kind: "ai", kart: i, name: racerName(i), color: racerColor(i) });
      const grid = others.slice();
      grid.splice(Math.min(3, grid.length), 0, { id: "me", kind: "player", kart: me, name: racerName(me), color: racerColor(me) });
      return grid;
    },
    [racersT, racerName]
  );
  const demoGrid = useCallback((): RacerSpec[] => racersT.slice(0, 5).map((_, i) => ({ id: `ai${i}`, kind: "ai" as const, kart: i, name: racerName(i), color: racerColor(i) })), [racersT, racerName]);

  // create the engine once the kit is ready
  useEffect(() => {
    if (!kit || !canvasRef.current || engineRef.current || cups.length === 0) return;
    let e: Engine;
    try {
      e = new Engine(canvasRef.current, kit, tierPref === "auto" ? autoTier() : tierPref, sfxRef.current);
    } catch (err) {
      console.warn("[Quiz Kart] WebGL unavailable", err);
      return;
    }
    e.r.autoTier = tierPref === "auto";
    setTierNow(e.tier);
    e.r.onTierChange = (tt) => setTierNow(tt);
    engineRef.current = e;
    try {
      if (/qkdebug/.test(window.location.search)) (window as any).__qk = e;
    } catch {
      /* ignore */
    }
    e.loadDemo(cups[0], raceTexts(cups[0]), demoGrid());
    setScreen("title");
    return () => {
      e.dispose();
      engineRef.current = null;
    };
  }, [kit, cups.length]);

  useEffect(() => () => sfxRef.current.close(), []);

  // language change: redraw the in-world texts
  useEffect(() => {
    const e = engineRef.current;
    if (!e || !e.cup) return;
    const names: { [id: string]: string } = {};
    e.racers.forEach((r) => {
      if (r.spec.kind === "ai") names[r.spec.id] = racerName(r.spec.kart);
    });
    e.relabel(raceTexts(e.cup), names);
  }, [raceTexts]);

  // sound
  useEffect(() => {
    sfxRef.current.setMuted(mexty.muted || !soundOn);
    lsSet("qk-sound", soundOn ? "1" : "0");
  }, [mexty.muted, soundOn]);

  const racing = screen === "race";
  const online = !!lobbyState && (screen === "lobby" || screen === "race" || screen === "results");
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.setPaused(mexty.paused || (userPaused && racing));
    if (mexty.paused && racing) setUserPaused(true);
  }, [mexty.paused, userPaused, racing]);

  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.hudOn = racing;
    e.focus = screen === "racer" ? racer : null;
    e.setBackground(!racing && screen !== "title" && screen !== "loading" && screen !== "results");
    sfxRef.current.music(racing && !userPaused && !mexty.paused);
  });

  // ------------------------------------------------------------ engine callbacks
  const flashTimer = useRef(0);
  const showFlash = (f: Omit<Flash, "id">, ms = 1700) => {
    window.clearTimeout(flashTimer.current);
    setFlash({ ...f, id: Date.now() });
    flashTimer.current = window.setTimeout(() => setFlash(null), ms);
  };

  const loadBoard = useCallback(
    (c: Cup | undefined) => {
      if (!c) return;
      setBoard((b) => ({ ...b, loading: true }));
      mexty.leaderboard
        .top(`${prefix}-${c.id}`, { scope: "family", limit: 5 })
        .then((r: any) => setBoard({ loading: false, entries: (r && r.entries) || [] }))
        .catch(() => setBoard({ loading: false, entries: [] }));
    },
    [prefix]
  );

  /** Saves, learning progress and the board: the same for solo and online races. */
  const recordRace = useCallback(
    (c: Cup, idx: number, r: RaceResult, online: boolean) => {
      const p = progRef.current;
      const prev = p.best[c.id];
      const record = !prev || r.position < prev.pos || (r.position === prev.pos && r.timeMs < prev.timeMs);
      const best = { ...p.best };
      if (record) best[c.id] = { pos: r.position, timeMs: r.timeMs, correct: r.correct, asked: r.asked };
      save({ ...p, best, unlocked: Math.max(p.unlocked, Math.min(cups.length - 1, idx + 1)), racer });
      mexty.progress.complete(r.correct, Math.max(1, r.asked), { timeSpentMs: r.timeMs });
      mexty.gameplayStop();
      mexty.leaderboard
        .submit(`${prefix}-${c.id}`, Math.max(1, SCORE_BASE - r.timeMs))
        .then(() => loadBoard(c))
        .catch(() => loadBoard(c));
      if (r.position <= 3) mexty.celebrate();
      return record;
    },
    [cups, racer, prefix, loadBoard]
  );

  const finishSolo = useCallback(
    (r: RaceResult) => {
      const c = cups[ci];
      if (!c) return;
      const record = recordRace(c, ci, r, false);
      setResult({ ...r, record, online: false });
      setScreen("results");
      engineRef.current?.showPodium(r.standings.map((s) => s.id));
    },
    [ci, cups, recordRace]
  );

  const onEvent = useCallback(
    (ev: RaceEvent) => {
      const e = engineRef.current;
      const c = e && e.cup;
      if (!c) return;
      switch (ev.type) {
        case "go":
          mexty.gameplayStart();
          if (ev.rocket) showFlash({ kind: "go", main: t(ui.go), sub: ui.rocketStart ? t(ui.rocketStart) : "🚀" }, 1300);
          else showFlash({ kind: "go", main: t(ui.go) }, 900);
          break;
        case "lap":
          showFlash({ kind: "lap", main: ev.lap === ev.laps ? t(ui.finalLap) : `${t(ui.lap)} ${ev.lap}/${ev.laps}` }, 1500);
          break;
        case "answer": {
          const q = c.questions[ev.q];
          answersRef.current.push({ prompt: ev.prompt, picked: ev.picked, right: ev.right, correct: ev.correct, missed: false });
          mexty.progress.answer({ questionId: q ? q.id : `${c.id}-q${ev.q}`, question: ev.prompt, correct: ev.correct, attempt: 1 });
          if (ev.correct) showFlash({ kind: "good", main: `✓ ${t(ui.correct)}` }, 1400);
          else showFlash({ kind: "bad", main: ev.shielded ? t(ui.shielded) : t(ui.wrong), sub: ev.explain || `${t(ui.answerWas)} ${ev.right}` }, 2600);
          break;
        }
        case "missed": {
          const q = c.questions[ev.q];
          answersRef.current.push({ prompt: ev.prompt, picked: "", right: ev.right, correct: false, missed: true });
          mexty.progress.answer({ questionId: q ? q.id : `${c.id}-q${ev.q}`, question: ev.prompt, correct: false, attempt: 1 });
          showFlash({ kind: "bad", main: t(ui.missed), sub: `${t(ui.answerWas)} ${ev.right}` }, 2400);
          break;
        }
        case "bonus":
          showFlash({ kind: "info", main: t(((bonuses as any)[ev.id] || {}).name) }, 1200);
          break;
        case "hit":
          showFlash({ kind: "bad", main: ev.by === "peel" ? t(ui.hitPeel) : t(ui.hitNova) }, 1200);
          break;
        case "trick":
          showFlash({ kind: "info", main: t(ui.trick) }, 900);
          break;
        case "finish":
          if (lobbyRef.current && e.setup && e.setup.mode === "online") {
            const L = lobbyRef.current;
            const idx = Math.max(0, cups.findIndex((x) => x.id === c.id));
            const record = recordRace(c, idx, ev.result, true);
            setResult({ ...ev.result, record, online: true });
            L.reportFinish(raceIdRef.current, ev.result.timeMs);
            showFlash({ kind: "go", main: t(ui.finish) }, 2200);
          } else finishSolo(ev.result);
          break;
        case "botFinish":
          if (lobbyRef.current) lobbyRef.current.botFinish(ev.id, ev.ms);
          break;
      }
    },
    [cups, t, ui, bonuses, finishSolo, recordRace]
  );

  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.onHud = (h) => hudStore.set(h);
    e.onEvent = onEvent;
    e.input.onAction = (a) => {
      if (a === "pause" && (e.phase === "racing" || e.phase === "countdown" || e.phase === "intro")) setUserPaused((p) => !p);
      if (a === "bonus" && !e.paused) e.useBonus();
    };
  });

  // ------------------------------------------------------------ solo navigation
  const startRace = (i = ci) => {
    const e = engineRef.current;
    const c = cups[i];
    if (!e || !c) return;
    sfxRef.current.ensure();
    e.net = null;
    e.load({ cup: c, texts: raceTexts(c), grid: soloGrid(racer), seed: Math.floor(Math.random() * 1e9), laps: c.laps ?? 3, mode: "solo" });
    answersRef.current = [];
    setResult(null);
    setUserPaused(false);
    setFlash(null);
    mexty.progress.level(i + 1);
    setScreen("race");
  };

  const backToDemo = (c?: Cup) => {
    const e = engineRef.current;
    const cc = c || cups[ci] || cups[0];
    if (e && cc) e.loadDemo(cc, raceTexts(cc), demoGrid());
  };

  const toCups = () => {
    sfxRef.current.stopEngine();
    mexty.gameplayStop();
    setUserPaused(false);
    backToDemo();
    setScreen("cups");
  };

  const pickCup = (i: number) => {
    setCi(i);
    backToDemo(cups[i]);
    setScreen("racer");
  };

  const setTierPref = (q: TierPref) => {
    setTierPrefS(q);
    lsSet("qk-tier", q);
    const e = engineRef.current;
    if (!e) return;
    if (q === "auto") e.setTier(autoTier(), true);
    else e.setTier(q, false);
    setTierNow(e.tier);
  };

  // ------------------------------------------------------------ online
  const store: SharedStore = useMemo(
    () => {
      // @mexty/sdk 0.4.0 keyed rows: one "lobby" row per host, refreshed as a heartbeat, removed on leave
      return {
        set: (key: string, d: Record<string, unknown>) => safe(() => mexty.shared.set("lobbies", key, d)),
        remove: (key: string) => safe(() => mexty.shared.remove("lobbies", key)),
        add: (d: Record<string, unknown>) => mexty.shared.add("lobbies", d),
        list: () => mexty.shared.list("lobbies", { limit: 100 }) as Promise<any[]>,
      now: async () => {
        try {
          return (await mexty.serverTime()).getTime();
        } catch {
          return Date.now();
        }
      },
      };
    },
    []
  );
  const directory = () => {
    if (!dirRef.current) dirRef.current = new Directory(nick || localNick(), fallbackApi, store);
    return dirRef.current;
  };

  // watch the public list while the online screen is open
  useEffect(() => {
    if (screen !== "online") return;
    const d = directory();
    return d.watch((list, st) => {
      setAds(list);
      setDirStatus(st);
    });
  }, [screen, nick]);

  const leaveLobby = () => {
    const L = lobbyRef.current;
    if (L) L.leave();
    lobbyRef.current = null;
    setLobbyState(null);
    raceIdRef.current = 0;
    const e = engineRef.current;
    if (e) e.net = null;
  };

  const enterLobby = (code: string, create: boolean, pub: boolean, quick: boolean) => {
    leaveLobby();
    sfxRef.current.ensure();
    setOnlineError("");
    const c = cups[ci] || cups[0];
    const L = new Lobby(code, { nick: nick || localNick(), racer }, { create, pub, quick, cupId: c.id, laps: c.laps ?? 3, fallbackApi, directory: pub ? directory() : null });
    lobbyRef.current = L;
    try {
      if (/qkdebug/.test(window.location.search)) (window as any).__qkLobby = L;
    } catch {
      /* ignore */
    }
    L.progressOf = (id) => (engineRef.current ? engineRef.current.progressById(id) : 0);
    L.onRace((from, m) => engineRef.current && engineRef.current.applyNet(from, m));
    L.subscribe((s) => setLobbyState({ ...s }));
    void L.connect();
    setScreen("lobby");
  };

  const quickRace = () => {
    const open = ads.filter((a) => a.quick && a.live && a.count < a.max);
    const pickAd = open.filter((a) => a.phase === "waiting").sort((a, b) => b.count - a.count)[0] || open[0];
    if (pickAd) enterLobby(pickAd.code, false, true, true);
    else enterLobby(newCode(), true, true, true);
  };

  // URL ?join=CODE: straight into that race
  useEffect(() => {
    if (screen === "title" && pendingJoin.current && nick) {
      const c = pendingJoin.current;
      pendingJoin.current = "";
      enterLobby(c, false, false, false);
    }
  }, [screen, nick]);

  // follow the lobby: races start and end on the host's word
  useEffect(() => {
    const s = lobbyState;
    const e = engineRef.current;
    const L = lobbyRef.current;
    if (!s || !e || !L) return;
    if (s.status === "notfound" || s.status === "full" || s.status === "error") {
      setOnlineError(s.status === "notfound" ? t(ui.codeNotFound) : s.status === "full" ? t(ui.lobbyFull) : t(ui.onlineUnavailable));
      leaveLobby();
      setScreen("online");
      return;
    }
    const info = s.info;
    if (!info) return;
    // host hand-over during a race: drive the AI karts from here
    if (s.isHost && !wasHostRef.current && e.setup && e.setup.mode === "online" && info.phase === "racing") e.takeOverBots();
    wasHostRef.current = s.isHost;
    // a racer left mid-race
    if (e.setup && e.setup.mode === "online") {
      const here = s.members.map((m) => m.id);
      e.racers.forEach((r) => {
        if (r.spec.kind === "remote" && here.indexOf(r.spec.id) < 0) e.dropRacer(r.spec.id);
      });
    }
    if (info.phase === "racing" && info.raceId !== raceIdRef.current) {
      raceIdRef.current = info.raceId;
      startOnline(info, s.me);
    } else if (info.phase === "results" && info.results && screen === "race") {
      showOnlineResults(info);
    } else if (info.phase === "waiting" && (screen === "race" || screen === "results")) {
      backToDemo(cups.find((c) => c.id === info.cupId));
      setScreen("lobby");
    }
  }, [lobbyState]);

  const startOnline = (info: LobbyInfo, me: string) => {
    const e = engineRef.current;
    const L = lobbyRef.current;
    if (!e || !L) return;
    const idx = Math.max(0, cups.findIndex((c) => c.id === info.cupId));
    const c = cups[idx];
    if (!c) return;
    setCi(idx);
    const grid: RacerSpec[] = info.grid.map((g) => ({
      id: g.id,
      kind: g.id === me ? "player" : g.bot ? "ai" : "remote",
      kart: Math.max(0, Math.min(racersT.length - 1, g.racer)),
      name: g.bot ? racerName(g.racer) : g.nick,
      color: racerColor(g.racer),
    }));
    e.net = { now: () => L.now(), send: (m, rel) => L.sendRace(m, rel) };
    e.load({ cup: c, texts: raceTexts(c), grid, seed: info.seed, laps: info.laps, mode: "online", startAt: info.startAt, raceId: info.raceId, host: L.isHost });
    answersRef.current = [];
    setResult(null);
    setUserPaused(false);
    setFlash(null);
    mexty.progress.level(idx + 1);
    setScreen("race");
  };

  const showOnlineResults = (info: LobbyInfo) => {
    const e = engineRef.current;
    const res = info.results || [];
    const me = lobbyState ? lobbyState.me : "";
    const standings: Standing[] = res.map((s) => ({ id: s.id, name: s.bot ? racerName(s.racer) : s.nick, player: s.id === me, timeMs: s.ms, color: racerColor(s.racer), kart: s.racer }));
    const mine = result;
    const pos = Math.max(1, standings.findIndex((s) => s.player) + 1);
    setResult({
      position: pos,
      racers: standings.length,
      timeMs: mine ? mine.timeMs : 0,
      correct: mine ? mine.correct : 0,
      answered: mine ? mine.answered : 0,
      asked: mine ? mine.asked : 0,
      coins: mine ? mine.coins : 0,
      standings,
      record: mine ? mine.record : false,
      online: true,
    });
    if (e) e.showPodium(res.map((s) => s.id));
    setScreen("results");
  };

  try {
    if (/qkdebug/.test(window.location.search)) (window as any).__qkStart = (i: number) => startRace(i);
  } catch {
    /* ignore */
  }

  // ------------------------------------------------------------ render
  if (cups.length === 0) {
    return (
      <div ref={rootRef} className="qk-root">
        <div className="qk-center">
          <div className="qk-card">
            <h2>{t(props.title) || "Quiz Kart Rally"}</h2>
          </div>
        </div>
      </div>
    );
  }

  const uiSounds = {
    onClickCapture: (e: React.MouseEvent) => {
      sfxRef.current.ensure();
      if ((e.target as Element).closest && (e.target as Element).closest("button")) sfxRef.current.uiClick();
    },
    onPointerOver: (e: React.PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const b = (e.target as Element).closest ? (e.target as Element).closest("button") : null;
      if (b && b !== lastHover.current && !(b as HTMLButtonElement).disabled) sfxRef.current.uiHover();
      lastHover.current = b;
    },
  };

  const e = engineRef.current;
  const onlineRace = !!(e && e.setup && e.setup.mode === "online");
  const showPause = racing && (userPaused || (mexty.paused && !onlineRace));
  const outline = e ? e.mapOutline() : null;
  const cupName = (id: string) => {
    const c = cups.find((x) => x.id === id);
    return c ? t(c.name) : "";
  };
  const joinLink = (code: string) => {
    const tpl = props.joinLink || "";
    if (tpl) return tpl.replace("{code}", code);
    try {
      const ref = document.referrer || window.location.href;
      const u = new URL(ref);
      u.searchParams.set("join", code);
      return u.toString();
    } catch {
      return code;
    }
  };

  return (
    <div ref={rootRef} className={`qk-root tier-${tierNow}`} {...uiSounds}>
      <canvas ref={canvasRef} className="qk-canvas" />
      {screen === "loading" && <Loading p={loadP} label={t(ui.loading)} title={t(props.title)} />}
      {screen === "title" && (
        <Title
          t={t}
          title={props.title ?? {}}
          subtitle={props.subtitle ?? {}}
          ui={ui}
          onSolo={() => setScreen("cups")}
          onOnline={() => {
            setOnlineError("");
            setScreen("online");
          }}
          onHow={() => setScreen("howto")}
        />
      )}
      {screen === "howto" && <HowTo t={t} ui={ui} bonuses={bonuses} touch={touch} onBack={() => setScreen("title")} />}
      {screen === "cups" && <CupSelect t={t} ui={ui} cups={cups} prog={prog} onPick={pickCup} onBack={() => setScreen("title")} />}
      {screen === "racer" && cup && (
        <RacerSelect
          t={t}
          ui={ui}
          cup={cup}
          racers={racersT.slice(0, 5)}
          sel={racer}
          onSel={(i) => {
            setRacer(i);
            save({ ...progRef.current, racer: i });
          }}
          onStart={() => startRace()}
          onBack={() => setScreen("cups")}
        />
      )}
      {screen === "online" && (
        <OnlineHub
          t={t}
          ui={ui}
          ads={ads}
          status={dirStatus}
          error={onlineError}
          cups={cups}
          cupName={cupName}
          local={netMode() === "local"}
          onQuick={quickRace}
          onCode={() => setCodeOpen(true)}
          onCreate={(pub, cupIdx) => {
            setCi(cupIdx);
            enterLobby(newCode(), true, pub, false);
          }}
          onJoin={(code) => enterLobby(code, false, true, false)}
          onBack={() => setScreen("title")}
        />
      )}
      {codeOpen && (
        <CodeEntry
          t={t}
          ui={ui}
          onCancel={() => setCodeOpen(false)}
          onJoin={(code) => {
            setCodeOpen(false);
            enterLobby(code, false, false, false);
          }}
        />
      )}
      {screen === "lobby" && lobbyState && (
        <LobbyRoom
          t={t}
          ui={ui}
          state={lobbyState}
          now={() => (lobbyRef.current ? lobbyRef.current.now() : Date.now())}
          racers={racersT.slice(0, 5)}
          sel={racer}
          cups={cups}
          cupName={cupName}
          joinLink={joinLink}
          onSel={(i) => {
            setRacer(i);
            save({ ...progRef.current, racer: i });
            lobbyRef.current?.setRacer(i);
          }}
          onCup={(id) => lobbyRef.current?.setCup(id)}
          onStart={() => lobbyRef.current?.start()}
          onLeave={() => {
            leaveLobby();
            backToDemo();
            setScreen("online");
          }}
        />
      )}
      {racing && (
        <LiveHud store={hudStore}>
          {(hud) => (
            <Hud
              t={t}
              ui={ui}
              hud={hud}
              touch={touch}
              input={engineRef.current!.input}
              flash={flash}
              outline={outline}
              bonuses={bonuses}
              cupName={e && e.cup ? t(e.cup.name) : ""}
              onPause={() => setUserPaused(true)}
              onBonus={() => engineRef.current?.useBonus()}
              onSpectate={() => engineRef.current?.spectateNext()}
            />
          )}
        </LiveHud>
      )}
      {showPause && (
        <Pause
          t={t}
          ui={ui}
          sound={soundOn}
          setSound={setSoundOn}
          tier={tierPref}
          tierNow={tierNow}
          setTier={setTierPref}
          online={onlineRace}
          onResume={() => setUserPaused(false)}
          onRestart={() => startRace()}
          onQuit={() => {
            setUserPaused(false);
            if (onlineRace) {
              leaveLobby();
              backToDemo();
              setScreen("online");
            } else toCups();
          }}
        />
      )}
      {screen === "results" && result && cup && (
        <Results
          t={t}
          ui={ui}
          pos={result.position}
          timeMs={result.timeMs}
          correct={result.correct}
          asked={result.asked}
          coins={result.coins}
          record={result.record}
          standings={result.standings}
          answers={answersRef.current}
          board={<Board t={t} ui={ui} entries={board.entries} loading={board.loading} guest={guest} toMs={(s) => SCORE_BASE - s} />}
          online={result.online}
          hasNext={!result.online && ci < cups.length - 1}
          nextUnlocked={ci + 1 <= Math.max(prog.unlocked, ci + 1)}
          onRetry={() => startRace()}
          onNext={() => {
            const n = ci + 1;
            setCi(n);
            startRace(n);
          }}
          onCups={() => {
            if (result.online) {
              backToDemo();
              setScreen("lobby");
            } else toCups();
          }}
        />
      )}
    </div>
  );
};

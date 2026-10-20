import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMexty, useLanguage, useCloudSave } from "@mexty/sdk";
import "./game/game.css";
import { Engine, HudState, RaceEvent, RaceResult, RaceTexts, RacerDef, Quality } from "./game/engine";
import { loadKit, Kit } from "./game/assets";
import { Sfx } from "./game/audio";
import { gpuInfo } from "./game/perf";
import { Title, HowTo, CupSelect, RacerSelect, Hud, Pause, Results, Loading, Board, BoardEntry, Progress, Flash, AnswerLog, T } from "./game/ui";

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
  /** Lawn colour (CSS colour). */
  ground?: string;
  /** Laps per race (1–5, default 3). */
  laps?: number;
  /** Road width in metres (12–24, default 16). */
  width?: number;
  /** The circuit's control points, driven in order; the first point is the start line. */
  points: TrackPoint[];
  /** Where the answer rows stand, as fractions of a lap (0..1), e.g. [0.3, 0.62, 0.86]. Put them on straights. */
  rows?: number[];
  /** Where the boost pads lie, as fractions of a lap. */
  boosts?: number[];
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
  lap: LocalizedText;
  finalLap: LocalizedText;
  go: LocalizedText;
  question: LocalizedText;
  useBonus: LocalizedText;
  coins: LocalizedText;
  drift: LocalizedText;
  brake: LocalizedText;
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
  finish: LocalizedText;
  paused: LocalizedText;
  resume: LocalizedText;
  restart: LocalizedText;
  quit: LocalizedText;
  sound: LocalizedText;
  quality: LocalizedText;
  qualityLow: LocalizedText;
  qualityHigh: LocalizedText;
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
}

/** URLs of the asset kit (GLB models). Karts: Kenney Car Kit (CC0); boxes, coins, peels, trees: Kenney Toy Car Kit (CC0); track furniture: built in Blender. */
export interface AssetUrls {
  /** One kart per racer, in the same order as `racers`. */
  karts: string[];
  itemBox: string;
  banana: string;
  coin: string;
  cone: string;
  tree: string;
  treePine: string;
  smoke: string;
  debrisTire: string;
  gantry: string;
  startArch: string;
  boostPad: string;
  tireWall: string;
  grandstand: string;
  flag: string;
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
}

type Screen = "loading" | "title" | "howto" | "cups" | "racer" | "race" | "results";

const SCORE_BASE = 10_000_000;
const EMPTY: Progress = { unlocked: 0, best: {}, racer: 0 };

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

function initialQuality(): Quality {
  const q = lsGet("qk-quality");
  if (q === "low" || q === "high") return q;
  if (typeof window === "undefined") return "low";
  const coarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  const cores = (navigator as any).hardwareConcurrency ?? 4;
  return coarse || cores <= 4 || gpuInfo().weak ? "low" : "high";
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
  const engineRef = useRef<Engine | null>(null);
  const sfxRef = useRef<Sfx>(new Sfx());
  const hudStore = useMemo(makeHudStore, []);
  const [kit, setKit] = useState<Kit | null>(null);
  const [loadP, setLoadP] = useState(0);
  const [screen, setScreen] = useState<Screen>("loading");
  const [ci, setCi] = useState(0);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [userPaused, setUserPaused] = useState(false);
  const [quality, setQualityS] = useState<Quality>(initialQuality);
  const [soundOn, setSoundOn] = useState(lsGet("qk-sound") !== "0");
  const [result, setResult] = useState<(RaceResult & { record: boolean }) | null>(null);
  const answersRef = useRef<AnswerLog[]>([]);
  const [board, setBoard] = useState<{ loading: boolean; entries: BoardEntry[] }>({ loading: false, entries: [] });
  const [guest, setGuest] = useState(true);
  const { value: saved, save } = useCloudSave<Progress>("progress", EMPTY);
  const prog: Progress = { ...EMPTY, ...(saved ?? {}) };
  const progRef = useRef(prog);
  progRef.current = prog;
  const [racer, setRacer] = useState(0);
  const lastHover = useRef<Element | null>(null);

  const touch = useMemo(() => {
    if (typeof window === "undefined") return false;
    return !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || "ontouchstart" in window;
  }, []);
  const cup = cups[ci];

  // ------------------------------------------------------------ boot
  useEffect(() => {
    mexty.ready();
    mexty
      .getPlayer()
      .then((p) => setGuest(p.isGuest))
      .catch(() => {});
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

  const racerDefs = useCallback(
    (): RacerDef[] =>
      racersT.slice(0, 5).map((r, i) => ({
        kart: i,
        name: t(r.name) || `#${i + 1}`,
        color: r.color || "#8c78ff",
      })),
    [racersT, t]
  );

  const raceTexts = useCallback(
    (c: Cup): RaceTexts => ({
      questionTitle: t(ui.question),
      prompts: (c.questions ?? []).map((q) => t(q.prompt)),
      answers: (c.questions ?? []).map((q) => (q.answers ?? []).map((a) => t(a))),
      correct: (c.questions ?? []).map((q) => Math.max(0, Math.min((q.answers ?? []).length - 1, q.correct ?? 0))),
      explains: (c.questions ?? []).map((q) => t(q.explain)),
      racerNames: racersT.map((r) => t(r.name)),
    }),
    [t, ui, racersT]
  );

  // create the engine once the kit is ready
  useEffect(() => {
    if (!kit || !canvasRef.current || engineRef.current || cups.length === 0) return;
    let e: Engine;
    try {
      e = new Engine(canvasRef.current, kit, quality, sfxRef.current, { scale: gpuInfo().software ? 0.6 : 1 });
    } catch (err) {
      console.warn("[Quiz Kart] WebGL unavailable", err);
      return;
    }
    engineRef.current = e;
    try {
      if (/qkdebug/.test(window.location.search)) (window as any).__qk = e;
    } catch {
      /* ignore */
    }
    e.loadCup(cups[0], raceTexts(cups[0]), racerDefs(), 0, true);
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
    if (e && e.cup) e.relabel(raceTexts(e.cup));
  }, [raceTexts]);

  // sound
  useEffect(() => {
    sfxRef.current.setMuted(mexty.muted || !soundOn);
    lsSet("qk-sound", soundOn ? "1" : "0");
  }, [mexty.muted, soundOn]);

  const racing = screen === "race";
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
    e.setBackground(!racing && screen !== "title" && screen !== "loading");
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

  const finishRace = useCallback(
    (r: RaceResult) => {
      const c = cups[ci];
      if (!c) return;
      const p = progRef.current;
      const prev = p.best[c.id];
      const record = !prev || r.position < prev.pos || (r.position === prev.pos && r.timeMs < prev.timeMs);
      const best = { ...p.best };
      if (record) best[c.id] = { pos: r.position, timeMs: r.timeMs, correct: r.correct, asked: r.asked };
      save({ ...p, best, unlocked: Math.max(p.unlocked, Math.min(cups.length - 1, ci + 1)), racer });
      mexty.progress.complete(r.correct, Math.max(1, r.asked), { timeSpentMs: r.timeMs });
      mexty.gameplayStop();
      mexty.leaderboard
        .submit(`${prefix}-${c.id}`, Math.max(1, SCORE_BASE - r.timeMs))
        .then(() => loadBoard(c))
        .catch(() => loadBoard(c));
      if (r.position <= 3) mexty.celebrate();
      setResult({ ...r, record });
      setScreen("results");
    },
    [ci, cups, racer, prefix, loadBoard]
  );

  const onEvent = useCallback(
    (ev: RaceEvent) => {
      const c = cups[ci];
      if (!c) return;
      switch (ev.type) {
        case "go":
          mexty.gameplayStart();
          showFlash({ kind: "go", main: t(ui.go) }, 900);
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
        case "finish":
          finishRace(ev.result);
          break;
      }
    },
    [ci, cups, t, ui, bonuses, finishRace]
  );

  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.onHud = (h) => hudStore.set(h);
    e.onEvent = onEvent;
    e.input.onAction = (a) => {
      if (a === "pause" && (e.phase === "racing" || e.phase === "countdown")) setUserPaused((p) => !p);
      if (a === "bonus" && !e.paused) e.useBonus();
    };
  });

  // ------------------------------------------------------------ navigation
  const startRace = (i = ci) => {
    const e = engineRef.current;
    const c = cups[i];
    if (!e || !c) return;
    sfxRef.current.ensure();
    e.loadCup(c, raceTexts(c), racerDefs(), racer, false);
    answersRef.current = [];
    setResult(null);
    setUserPaused(false);
    setFlash(null);
    mexty.progress.level(i + 1);
    setScreen("race");
  };

  const toCups = () => {
    const e = engineRef.current;
    sfxRef.current.stopEngine();
    mexty.gameplayStop();
    setUserPaused(false);
    if (e && cups[0] && e.phase !== "demo") e.loadCup(cups[ci] ?? cups[0], raceTexts(cups[ci] ?? cups[0]), racerDefs(), 0, true);
    setScreen("cups");
  };

  const pickCup = (i: number) => {
    setCi(i);
    const e = engineRef.current;
    if (e) e.loadCup(cups[i], raceTexts(cups[i]), racerDefs(), 0, true);
    setScreen("racer");
  };

  const setQuality = (q: Quality) => {
    setQualityS(q);
    lsSet("qk-quality", q);
    engineRef.current?.setQuality(q);
  };

  // ------------------------------------------------------------ render
  if (cups.length === 0) {
    return (
      <div className="qk-root">
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

  const showPause = racing && (userPaused || mexty.paused);
  const outline = engineRef.current ? engineRef.current.mapOutline() : null;

  return (
    <div className={`qk-root ${quality === "low" ? "qk-low" : ""}`} {...uiSounds}>
      <canvas ref={canvasRef} className="qk-canvas" />
      {screen === "loading" && <Loading p={loadP} label={t(ui.loading)} title={t(props.title)} />}
      {screen === "title" && <Title t={t} title={props.title ?? {}} subtitle={props.subtitle ?? {}} ui={ui} onPlay={() => setScreen("cups")} onHow={() => setScreen("howto")} />}
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
              onPause={() => setUserPaused(true)}
              onBonus={() => engineRef.current?.useBonus()}
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
          quality={quality}
          setQuality={setQuality}
          onResume={() => setUserPaused(false)}
          onRestart={() => startRace()}
          onQuit={toCups}
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
          hasNext={ci < cups.length - 1}
          nextUnlocked={ci + 1 <= Math.max(prog.unlocked, ci + 1)}
          onRetry={() => startRace()}
          onNext={() => {
            const n = ci + 1;
            setCi(n);
            startRace(n);
          }}
          onCups={toCups}
        />
      )}
    </div>
  );
};

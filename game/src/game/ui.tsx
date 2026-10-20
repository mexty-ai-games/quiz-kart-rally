/** React screens and HUD for Quiz Kart Rally (all texts come from the props). */
import React, { useEffect, useRef } from "react";
import type { HudState, Standing } from "./engine";
import type { Input } from "./input";
import { BONUS_COLOR, BONUS_ICON, BonusId } from "./items";
import type { Cup, LocalizedText, UiText, BonusTexts, RacerText } from "./types";

export type T = (x: LocalizedText | undefined) => string;

export interface CupBest {
  pos: number;
  timeMs: number;
  correct: number;
  asked: number;
}

export interface Progress {
  unlocked: number;
  best: { [cupId: string]: CupBest };
  racer: number;
}

export interface Flash {
  id: number;
  kind: "good" | "bad" | "info" | "go" | "lap";
  main: string;
  sub?: string;
}

export interface AnswerLog {
  prompt: string;
  picked: string;
  right: string;
  correct: boolean;
  missed: boolean;
}

export const fmt = (ms: number) => {
  if (!isFinite(ms) || ms < 0) return "--:--.-";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const d = Math.floor((ms % 1000) / 100);
  return `${m}:${s < 10 ? "0" : ""}${s}.${d}`;
};

export const Btn: React.FC<{ onClick?: () => void; kind?: "go" | "alt" | "ghost"; disabled?: boolean; children: React.ReactNode; className?: string; ariaLabel?: string }> = ({ onClick, kind, disabled, children, className, ariaLabel }) => (
  <button className={`qk-btn ${kind ? "qk-" + kind : ""} ${className ?? ""}`} onClick={onClick} disabled={disabled} aria-label={ariaLabel}>
    {children}
  </button>
);

export const BonusIcon: React.FC<{ id: BonusId; size?: number }> = ({ id, size = 34 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    <path d={BONUS_ICON[id]} fill={BONUS_COLOR[id]} stroke="#20183f" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
);

const Trophy: React.FC<{ pos: number; size?: number }> = ({ pos, size = 26 }) => {
  const c = pos === 1 ? "#ffcf3a" : pos === 2 ? "#d5d9e6" : pos === 3 ? "#e09a5c" : null;
  if (!c) return null;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M7 3h10v3h3c0 3.3-1.8 5.5-4.4 5.9A5 5 0 0 1 13 14.6V17h3v3H8v-3h3v-2.4a5 5 0 0 1-2.6-2.7C5.8 11.5 4 9.3 4 6h3V3zm-1 5c.3 1.4 1 2.3 1.9 2.7L7.6 8H6zm12 0h-1.6l-.3 2.7c.9-.4 1.6-1.3 1.9-2.7z" fill={c} stroke="#20183f" strokeWidth={0.8} />
    </svg>
  );
};

export function ordinal(t: T, ui: UiText, pos: number) {
  const o = ui.ordinals && ui.ordinals[pos - 1];
  return o ? t(o) : String(pos);
}

// ------------------------------------------------------------------ screens
export const Loading: React.FC<{ p: number; label: string; title: string }> = ({ p, label, title }) => (
  <div className="qk-center">
    <div className="qk-card qk-loading">
      <h1 className="qk-logo">{title}</h1>
      <div className="qk-bar">
        <div style={{ width: `${Math.round(p * 100)}%` }} />
      </div>
      <div className="qk-note">{label}</div>
    </div>
  </div>
);

export const Title: React.FC<{ t: T; title: LocalizedText; subtitle: LocalizedText; ui: UiText; onPlay: () => void; onHow: () => void }> = ({ t, title, subtitle, ui, onPlay, onHow }) => (
  <div className="qk-center qk-title">
    <div className="qk-titlebox">
      <h1 className="qk-logo big">{t(title)}</h1>
      <div className="qk-sub">{t(subtitle)}</div>
      <div className="qk-row">
        <Btn kind="go" onClick={onPlay}>
          {t(ui.play)}
        </Btn>
        <Btn kind="alt" onClick={onHow}>
          {t(ui.howToPlay)}
        </Btn>
      </div>
    </div>
  </div>
);

export const HowTo: React.FC<{ t: T; ui: UiText; bonuses: BonusTexts; touch: boolean; onBack: () => void }> = ({ t, ui, bonuses, touch, onBack }) => {
  const ids: BonusId[] = ["turbo", "triple", "shield", "peel", "coins", "nova"];
  return (
    <div className="qk-center">
      <div className="qk-card qk-scroll">
        <h2>{t(ui.howToPlay)}</h2>
        <ol className="qk-steps">
          {(ui.howSteps ?? []).map((s, i) => (
            <li key={i}>{t(s)}</li>
          ))}
        </ol>
        <p className="qk-controls">{touch ? t(ui.controlsTouch) : t(ui.controlsKeys)}</p>
        <h3>{t(ui.bonusesTitle)}</h3>
        <div className="qk-bonusgrid">
          {ids.map((id) => {
            const b = (bonuses as any)[id] as { name: LocalizedText; hint: LocalizedText } | undefined;
            return (
              <div key={id} className="qk-bonusitem">
                <BonusIcon id={id} size={30} />
                <div>
                  <b>{t(b?.name)}</b>
                  <span>{t(b?.hint)}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="qk-row end">
          <Btn kind="go" onClick={onBack}>
            {t(ui.back)}
          </Btn>
        </div>
      </div>
    </div>
  );
};

export const CupSelect: React.FC<{ t: T; ui: UiText; cups: Cup[]; prog: Progress; onPick: (i: number) => void; onBack: () => void }> = ({ t, ui, cups, prog, onPick, onBack }) => (
  <div className="qk-center">
    <div className="qk-card wide">
      <h2>{t(ui.chooseCup)}</h2>
      <div className="qk-cups">
        {cups.map((c, i) => {
          const locked = i > prog.unlocked;
          const b = prog.best[c.id];
          return (
            <button key={c.id} className={`qk-cup ${locked ? "locked" : ""} mood-${c.mood ?? "day"}`} disabled={locked} onClick={() => onPick(i)}>
              <span className="qk-cupnum">{i + 1}</span>
              <span className="qk-cupname">{t(c.name)}</span>
              <span className="qk-cuptopic">{t(c.topic)}</span>
              {locked ? (
                <span className="qk-cupbest">🔒 {t(ui.lockedHint)}</span>
              ) : b ? (
                <span className="qk-cupbest">
                  <Trophy pos={b.pos} size={20} /> {ordinal(t, ui, b.pos)} · {fmt(b.timeMs)} · {b.correct}/{b.asked}
                </span>
              ) : (
                <span className="qk-cupbest">{t(ui.notRaced)}</span>
              )}
            </button>
          );
        })}
      </div>
      <div className="qk-row end">
        <Btn kind="alt" onClick={onBack}>
          {t(ui.back)}
        </Btn>
      </div>
    </div>
  </div>
);

export const RacerSelect: React.FC<{ t: T; ui: UiText; cup: Cup; racers: RacerText[]; sel: number; onSel: (i: number) => void; onStart: () => void; onBack: () => void }> = ({ t, ui, cup, racers, sel, onSel, onStart, onBack }) => (
  <div className="qk-center qk-bottom">
    <div className="qk-card wide">
      <div className="qk-cuphead">
        <h2>{t(cup.name)}</h2>
        <span className="qk-chip">{t(cup.topic)}</span>
        <span className="qk-chip">
          {cup.laps ?? 3} {t(ui.laps)}
        </span>
      </div>
      <h3>{t(ui.chooseRacer)}</h3>
      <div className="qk-racers" role="radiogroup">
        {racers.map((r, i) => (
          <button key={i} role="radio" aria-checked={sel === i} className={`qk-racer ${sel === i ? "sel" : ""}`} onClick={() => onSel(i)} style={{ ["--c" as any]: r.color }}>
            <span className="qk-helmet" />
            <span>{t(r.name)}</span>
          </button>
        ))}
      </div>
      <div className="qk-row end">
        <Btn kind="alt" onClick={onBack}>
          {t(ui.back)}
        </Btn>
        <Btn kind="go" onClick={onStart}>
          {t(ui.start)}
        </Btn>
      </div>
    </div>
  </div>
);

// ------------------------------------------------------------------ HUD
export const MiniMap: React.FC<{ outline: { pts: [number, number][]; min: [number, number]; max: [number, number] } | null; hud: HudState }> = ({ outline, hud }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !outline) return;
    const ctx = c.getContext("2d")!;
    const W = c.width,
      H = c.height;
    const [x0, z0] = outline.min;
    const [x1, z1] = outline.max;
    const sc = Math.min((W - 16) / Math.max(1, x1 - x0), (H - 16) / Math.max(1, z1 - z0));
    const ox = (W - (x1 - x0) * sc) / 2,
      oz = (H - (z1 - z0) * sc) / 2;
    const P = (x: number, z: number): [number, number] => [ox + (x - x0) * sc, oz + (z - z0) * sc];
    ctx.clearRect(0, 0, W, H);
    ctx.lineJoin = "round";
    ctx.beginPath();
    outline.pts.forEach(([x, z], i) => {
      const [a, b] = P(x, z);
      if (i) ctx.lineTo(a, b);
      else ctx.moveTo(a, b);
    });
    ctx.closePath();
    ctx.strokeStyle = "rgba(20,14,50,0.75)";
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.strokeStyle = "#e9e4ff";
    ctx.lineWidth = 4;
    ctx.stroke();
    hud.map.rivals.forEach((r) => {
      const [a, b] = P(r.x, r.z);
      ctx.fillStyle = r.color;
      ctx.strokeStyle = "#20183f";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(a, b, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    const [px, pz] = P(hud.map.player[0], hud.map.player[1]);
    ctx.fillStyle = "#ff3d6e";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(px, pz, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
  return <canvas ref={ref} className="qk-map" width={150} height={150} aria-hidden="true" />;
};

const Hold: React.FC<{ className: string; label: string; on: (b: boolean) => void; children?: React.ReactNode }> = ({ className, label, on, children }) => (
  <button
    className={`qk-touch ${className}`}
    aria-label={label}
    onPointerDown={(e) => {
      (e.target as Element).setPointerCapture?.(e.pointerId);
      on(true);
    }}
    onPointerUp={() => on(false)}
    onPointerCancel={() => on(false)}
    onPointerLeave={() => on(false)}
    onContextMenu={(e) => e.preventDefault()}
  >
    {children}
  </button>
);

export const Hud: React.FC<{
  t: T;
  ui: UiText;
  hud: HudState;
  touch: boolean;
  input: Input;
  flash: Flash | null;
  outline: { pts: [number, number][]; min: [number, number]; max: [number, number] } | null;
  bonuses: BonusTexts;
  onPause: () => void;
  onBonus: () => void;
}> = ({ t, ui, hud, touch, input, flash, outline, bonuses, onPause, onBonus }) => {
  const q = hud.question;
  const bId = hud.rolling ? hud.rollFace : hud.bonus;
  const bName = hud.bonus && !hud.rolling ? t(((bonuses as any)[hud.bonus] || {}).name) : "";
  return (
    <div className={`qk-hud ${touch ? "touch" : ""}`}>
      <div className="qk-tl">
        <div className="qk-pos">
          <span className="big">{ordinal(t, ui, hud.pos)}</span>
          <span className="of">/{hud.racers}</span>
        </div>
        <div className="qk-lap">
          {t(ui.lap)} {hud.lap}/{hud.laps}
        </div>
        <div className="qk-time">{fmt(hud.timeMs)}</div>
      </div>
      <div className="qk-tr">
        <button className={`qk-bonus ${hud.rolling ? "rolling" : ""} ${hud.bonus ? "ready" : ""}`} onClick={onBonus} aria-label={`${t(ui.useBonus)} ${bName}`} disabled={!hud.bonus || hud.rolling}>
          {bId ? <BonusIcon id={bId} size={44} /> : <span className="qk-q">?</span>}
          {hud.bonus === "triple" && !hud.rolling && <span className="qk-charges">×{hud.charges}</span>}
        </button>
        <div className="qk-coins" aria-label={`${t(ui.coins)} ${hud.coins}`}>
          <span className="qk-coin" /> {hud.coins}
        </div>
        <button className="qk-pausebtn" onClick={onPause} aria-label={t(ui.paused)}>
          <span />
          <span />
        </button>
      </div>
      {q && (
        <div className="qk-question" role="status" aria-live="polite">
          <div className="qk-qlabel">{t(ui.question)}</div>
          <div className="qk-prompt">{q.prompt}</div>
          <div className="qk-answers">
            {q.lanes.map((l, i) => (
              <div key={i} className="qk-ans" style={{ borderColor: l.color, background: l.color + "33" }}>
                {l.text}
              </div>
            ))}
          </div>
          <div className="qk-dist">
            <div style={{ width: `${Math.max(0, Math.min(100, 100 - (q.dist / 130) * 100))}%` }} />
          </div>
        </div>
      )}
      {hud.phase === "countdown" && hud.count > 0 && hud.count < 4 && <div className="qk-count">{hud.count}</div>}
      {flash && (
        <div key={flash.id} className={`qk-flash ${flash.kind}`}>
          <div className="main">{flash.main}</div>
          {flash.sub && <div className="sub">{flash.sub}</div>}
        </div>
      )}
      <div className="qk-status">
        {hud.shield && <span className="qk-tag shield">{t(((bonuses as any).shield || {}).name)}</span>}
        {hud.nova && <span className="qk-tag nova">{t(((bonuses as any).nova || {}).name)}</span>}
        {hud.drift > 1 && <span className={`qk-tag drift d${hud.drift}`}>{t(ui.drift)}</span>}
      </div>
      <MiniMap outline={outline} hud={hud} />
      {touch && (
        <div className="qk-pad">
          <div className="qk-padl">
            <Hold className="left" label={t(ui.left)} on={(b) => (input.touch.left = b)}>
              ◀
            </Hold>
            <Hold className="right" label={t(ui.right)} on={(b) => (input.touch.right = b)}>
              ▶
            </Hold>
          </div>
          <div className="qk-padr">
            <Hold className="brake" label={t(ui.brake)} on={(b) => (input.touch.brake = b)}>
              {t(ui.brake)}
            </Hold>
            <Hold className="drift" label={t(ui.drift)} on={(b) => (input.touch.drift = b)}>
              {t(ui.drift)}
            </Hold>
          </div>
        </div>
      )}
    </div>
  );
};

export const Pause: React.FC<{ t: T; ui: UiText; sound: boolean; setSound: (b: boolean) => void; quality: "low" | "high"; setQuality: (q: "low" | "high") => void; onResume: () => void; onRestart: () => void; onQuit: () => void }> = ({
  t,
  ui,
  sound,
  setSound,
  quality,
  setQuality,
  onResume,
  onRestart,
  onQuit,
}) => (
  <div className="qk-center qk-dim">
    <div className="qk-card">
      <h2>{t(ui.paused)}</h2>
      <div className="qk-opts">
        <div className="qk-opt">
          <span>{t(ui.sound)}</span>
          <Btn kind="ghost" onClick={() => setSound(!sound)}>
            {sound ? t(ui.on) : t(ui.off)}
          </Btn>
        </div>
        <div className="qk-opt">
          <span>{t(ui.quality)}</span>
          <Btn kind="ghost" onClick={() => setQuality(quality === "high" ? "low" : "high")}>
            {quality === "high" ? t(ui.qualityHigh) : t(ui.qualityLow)}
          </Btn>
        </div>
      </div>
      <div className="qk-row">
        <Btn kind="go" onClick={onResume}>
          {t(ui.resume)}
        </Btn>
        <Btn kind="alt" onClick={onRestart}>
          {t(ui.restart)}
        </Btn>
        <Btn kind="alt" onClick={onQuit}>
          {t(ui.quit)}
        </Btn>
      </div>
    </div>
  </div>
);

export const Results: React.FC<{
  t: T;
  ui: UiText;
  pos: number;
  timeMs: number;
  correct: number;
  asked: number;
  coins: number;
  record: boolean;
  standings: Standing[];
  answers: AnswerLog[];
  board: React.ReactNode;
  hasNext: boolean;
  nextUnlocked: boolean;
  onRetry: () => void;
  onNext: () => void;
  onCups: () => void;
}> = ({ t, ui, pos, timeMs, correct, asked, coins, record, standings, answers, board, hasNext, nextUnlocked, onRetry, onNext, onCups }) => (
  <div className="qk-center qk-dim">
    <div className="qk-card wide qk-scroll">
      <div className="qk-reshead">
        <Trophy pos={pos} size={56} />
        <div>
          <h2>{pos <= 3 ? t(ui.podium) : t(ui.keepGoing)}</h2>
          <div className="qk-sub">
            {ordinal(t, ui, pos)} · {fmt(timeMs)} {record && <span className="qk-chip gold">{t(ui.newBest)}</span>}
          </div>
        </div>
      </div>
      <div className="qk-stats">
        <div>
          <b>
            {correct}/{asked}
          </b>
          <span>{t(ui.rightAnswers)}</span>
        </div>
        <div>
          <b>{coins}</b>
          <span>{t(ui.coins)}</span>
        </div>
      </div>
      <div className="qk-cols">
        <div>
          <h3>{t(ui.standings)}</h3>
          <ol className="qk-standings">
            {standings.map((s, i) => (
              <li key={i} className={s.player ? "me" : ""}>
                <span className="dot" style={{ background: s.color }} />
                <span className="n">{s.name}</span>
                <span className="tm">{fmt(s.timeMs)}</span>
              </li>
            ))}
          </ol>
          {board}
        </div>
        <div>
          <h3>{t(ui.yourAnswers)}</h3>
          <ul className="qk-log">
            {answers.map((a, i) => (
              <li key={i} className={a.correct ? "ok" : "ko"}>
                <span className="mark">{a.correct ? "✓" : "✗"}</span>
                <span className="p">{a.prompt}</span>
                <span className="a">{a.missed ? `${t(ui.missedShort)} → ${a.right}` : a.correct ? a.picked : `${a.picked} → ${a.right}`}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="qk-row end">
        <Btn kind="alt" onClick={onCups}>
          {t(ui.chooseCup)}
        </Btn>
        <Btn kind={hasNext && nextUnlocked ? "alt" : "go"} onClick={onRetry}>
          {t(ui.retry)}
        </Btn>
        {hasNext && nextUnlocked && (
          <Btn kind="go" onClick={onNext}>
            {t(ui.nextCup)}
          </Btn>
        )}
      </div>
    </div>
  </div>
);

export interface BoardEntry {
  rank: number;
  nickname?: string;
  score: number;
  isMe?: boolean;
}

export const Board: React.FC<{ t: T; ui: UiText; entries: BoardEntry[]; loading: boolean; guest: boolean; toMs: (s: number) => number }> = ({ t, ui, entries, loading, guest, toMs }) => (
  <div className="qk-board">
    <h3>{t(ui.familyBoard)}</h3>
    {guest ? (
      <div className="qk-note">{t(ui.guestHint)}</div>
    ) : loading ? (
      <div className="qk-note">…</div>
    ) : entries.length === 0 ? (
      <div className="qk-note">{t(ui.boardEmpty)}</div>
    ) : (
      <ol>
        {entries.slice(0, 5).map((e, i) => (
          <li key={i} className={e.isMe ? "me" : ""}>
            <span>{e.rank}.</span> <span className="n">{e.nickname || "—"}</span> <span className="tm">{fmt(toMs(e.score))}</span>
          </li>
        ))}
      </ol>
    )}
  </div>
);

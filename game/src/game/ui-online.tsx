/** Online screens: the hub (quick race, join by code, create, open races), the code keypad and the lobby room. */
import React, { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import type { Cup, UiText, RacerText } from "./types";
import type { LobbyAd, LobbyState } from "../net/lobby";
import { MAX_HUMANS, GRID_SIZE, cleanCode, isCode } from "../net/lobby";
import { Btn, Helmet, RacerPicker, T } from "./ui";

const KEYS = "ACDEFGHJKLMNPQRTUVWXY34679".split("");

/** A QR code drawn as one SVG path. */
export const QrCode: React.FC<{ text: string; size?: number }> = ({ text, size = 168 }) => {
  const path = useMemo(() => {
    try {
      const qr = qrcode(0, "M");
      qr.addData(text);
      qr.make();
      const n = qr.getModuleCount();
      let d = "";
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
      return { d, n: n + 4 };
    } catch {
      return null;
    }
  }, [text]);
  if (!path) return null;
  return (
    <svg className="qk-qr" viewBox={`0 0 ${path.n} ${path.n}`} width={size} height={size} role="img" aria-label="QR code" shapeRendering="crispEdges">
      <rect width={path.n} height={path.n} fill="#fff" rx="2" />
      <path d={path.d} fill="#1d1640" />
    </svg>
  );
};

export const CodeTiles: React.FC<{ code: string; big?: boolean }> = ({ code, big }) => (
  <div className={`qk-codetiles ${big ? "big" : ""}`} aria-label={code.split("").join(" ")}>
    {[0, 1, 2, 3, 4].map((i) => (
      <span key={i} className={code[i] ? "on" : ""}>
        {code[i] || ""}
      </span>
    ))}
  </div>
);

export const CodeEntry: React.FC<{ t: T; ui: UiText; onJoin: (code: string) => void; onCancel: () => void }> = ({ t, ui, onJoin, onCancel }) => {
  const [code, setCode] = useState("");
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      else if (e.key === "Backspace") setCode((c) => c.slice(0, -1));
      else if (e.key === "Enter") {
        if (isCode(code)) onJoin(code);
      } else if (/^[a-zA-Z0-9]$/.test(e.key)) setCode((c) => cleanCode(c + e.key));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [code]);
  return (
    <div className="qk-center qk-dim qk-codeentry">
      <div className="qk-card">
        <h2>{t(ui.enterCode)}</h2>
        <CodeTiles code={code} big />
        <div className="qk-keypad">
          {KEYS.map((k) => (
            <button key={k} onClick={() => setCode((c) => cleanCode(c + k))} disabled={code.length >= 5}>
              {k}
            </button>
          ))}
          <button className="wide" onClick={() => setCode((c) => c.slice(0, -1))} aria-label="⌫">
            ⌫
          </button>
        </div>
        <div className="qk-row end">
          <Btn kind="alt" onClick={onCancel}>
            {t(ui.back)}
          </Btn>
          <Btn kind="go" disabled={!isCode(code)} onClick={() => onJoin(code)}>
            {t(ui.join)}
          </Btn>
        </div>
      </div>
    </div>
  );
};

export const OnlineHub: React.FC<{
  t: T;
  ui: UiText;
  ads: LobbyAd[];
  status: string;
  error: string;
  cups: Cup[];
  cupName: (id: string) => string;
  local: boolean;
  onQuick: () => void;
  onCode: () => void;
  onCreate: (pub: boolean, cupIdx: number) => void;
  onJoin: (code: string) => void;
  onBack: () => void;
}> = ({ t, ui, ads, status, error, cups, cupName, onQuick, onCode, onCreate, onJoin, onBack }) => {
  const [creating, setCreating] = useState(false);
  const [pub, setPub] = useState(false);
  const [cupIdx, setCupIdx] = useState(0);
  const offline = status === "error";
  return (
    <div className="qk-center">
      <div className="qk-card wide qk-scroll qk-hub">
        <div className="qk-hubhead">
          <h2>{t(ui.playOnline)}</h2>
          <Btn kind="ghost" onClick={onBack}>
            {t(ui.back)}
          </Btn>
        </div>
        {(error || offline) && <div className="qk-alert">{error || t(ui.onlineUnavailable)}</div>}
        <div className="qk-tiles">
          <button className="qk-tile quick" onClick={onQuick}>
            <span className="ic">⚡</span>
            <b>{t(ui.quickRace)}</b>
            <span>{t(ui.quickRaceHint)}</span>
          </button>
          <button className="qk-tile code" onClick={onCode}>
            <span className="ic">🔢</span>
            <b>{t(ui.joinWithCode)}</b>
            <span>{t(ui.enterCode)}</span>
          </button>
          <button className={`qk-tile create ${creating ? "open" : ""}`} onClick={() => setCreating(!creating)}>
            <span className="ic">🏁</span>
            <b>{t(ui.createRace)}</b>
            <span>{t(ui.privateHint)}</span>
          </button>
        </div>
        {creating && (
          <div className="qk-create">
            <div className="qk-seg big" role="radiogroup">
              <button className={!pub ? "on" : ""} onClick={() => setPub(false)} role="radio" aria-checked={!pub}>
                🔒 {t(ui.privateRace)}
              </button>
              <button className={pub ? "on" : ""} onClick={() => setPub(true)} role="radio" aria-checked={pub}>
                🌍 {t(ui.publicRace)}
              </button>
            </div>
            <div className="qk-note">{pub ? t(ui.publicHint) : t(ui.privateHint)}</div>
            <div className="qk-cuppick">
              {cups.map((c, i) => (
                <button key={c.id} className={`qk-cupmini mood-${c.mood ?? "day"} ${i === cupIdx ? "on" : ""}`} onClick={() => setCupIdx(i)}>
                  <b>{cupName(c.id)}</b>
                  <span>{t(c.topic)}</span>
                </button>
              ))}
            </div>
            <div className="qk-row end">
              <Btn kind="go" onClick={() => onCreate(pub, cupIdx)}>
                {t(ui.createRace)}
              </Btn>
            </div>
          </div>
        )}
        <h3>{t(ui.openRaces)}</h3>
        {status === "connecting" && <div className="qk-note">{t(ui.connecting)}</div>}
        {ads.length === 0 && status !== "connecting" ? (
          <div className="qk-note">{t(ui.noOpenRaces)}</div>
        ) : (
          <ul className="qk-ads">
            {ads.map((a) => (
              <li key={a.code}>
                <span className="cup">{cupName(a.cupId) || "—"}</span>
                <span className="host">{a.host}</span>
                <span className="cnt">
                  {a.count}/{a.max}
                </span>
                <span className={`st ${a.phase}`}>{a.phase === "racing" ? t(ui.racing) : t(ui.waiting)}</span>
                <Btn kind={a.phase === "racing" ? "alt" : "go"} onClick={() => onJoin(a.code)} disabled={a.count >= a.max}>
                  {a.phase === "racing" ? t(ui.watch) : t(ui.join)}
                </Btn>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export const LobbyRoom: React.FC<{
  t: T;
  ui: UiText;
  state: LobbyState;
  now: () => number;
  racers: RacerText[];
  sel: number;
  cups: Cup[];
  cupName: (id: string) => string;
  joinLink: (code: string) => string;
  onSel: (i: number) => void;
  onCup: (id: string) => void;
  onStart: () => void;
  onLeave: () => void;
}> = ({ t, ui, state, now, racers, sel, cups, cupName, joinLink, onSel, onCup, onStart, onLeave }) => {
  const [, tick] = useState(0);
  useEffect(() => {
    const iv = window.setInterval(() => tick((x) => x + 1), 500);
    return () => window.clearInterval(iv);
  }, []);
  const info = state.info;
  if (!info) {
    return (
      <div className="qk-center">
        <div className="qk-card">
          <h2>{t(ui.connecting)}</h2>
          <div className="qk-spinner" />
          <div className="qk-row end">
            <Btn kind="alt" onClick={onLeave}>
              {t(ui.leave)}
            </Btn>
          </div>
        </div>
      </div>
    );
  }
  const members = state.members;
  const ci = Math.max(0, cups.findIndex((c) => c.id === info.cupId));
  const left = info.autoAt ? Math.max(0, Math.ceil((info.autoAt - now()) / 1000)) : 0;
  const slots = Math.max(GRID_SIZE, members.length);
  const racing = info.phase === "racing";
  return (
    <div className="qk-center">
      <div className="qk-card wide qk-scroll qk-lobby">
        <div className="qk-lobbyhead">
          <div>
            <div className="qk-note">{info.pub ? `🌍 ${t(ui.publicRace)}` : `🔒 ${t(ui.privateRace)}`}</div>
            <CodeTiles code={info.code} />
          </div>
          <Btn kind="ghost" onClick={onLeave}>
            {t(ui.leave)}
          </Btn>
        </div>
        <div className="qk-lobbycols">
          <div>
            <h3>
              {t(ui.players)} {members.length}/{MAX_HUMANS}
            </h3>
            <ul className="qk-players">
              {Array.from({ length: slots }, (_, i) => {
                const m = members[i];
                if (!m)
                  return (
                    <li key={i} className="ai">
                      <Helmet color={(racers[i % racers.length] || racers[0]).color} size={28} />
                      <span className="n">{t(ui.aiFill)}</span>
                      <span className="tag">{t(ui.aiTag)}</span>
                    </li>
                  );
                const color = (racers[m.racer] || racers[0]).color;
                return (
                  <li key={m.id} className={m.id === state.me ? "me" : ""}>
                    <Helmet color={color} size={28} />
                    <span className="n">
                      {m.nick}
                      {m.id === state.me ? ` (${t(ui.you)})` : ""}
                    </span>
                    {m.id === info.hostId && <span className="tag host">{t(ui.hostTag)}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="qk-share">
            <h3>{t(ui.scanToJoin)}</h3>
            <QrCode text={joinLink(info.code)} />
            <div className="qk-note">{t(ui.shareCode)}</div>
          </div>
        </div>
        <h3>{t(ui.chooseRacer)}</h3>
        <RacerPicker t={t} racers={racers} sel={sel} onSel={onSel} />
        <div className="qk-lobbyfoot">
          <div className="qk-cupsel">
            {state.isHost && !racing && (
              <Btn kind="ghost" ariaLabel="◀" onClick={() => onCup(cups[(ci - 1 + cups.length) % cups.length].id)}>
                ◀
              </Btn>
            )}
            <div className="qk-cupname-sm">
              <small>{t(ui.pickCup)}</small>
              <b>{cupName(info.cupId)}</b>
            </div>
            {state.isHost && !racing && (
              <Btn kind="ghost" ariaLabel="▶" onClick={() => onCup(cups[(ci + 1) % cups.length].id)}>
                ▶
              </Btn>
            )}
          </div>
          {racing ? (
            <div className="qk-wait">{t(ui.racing)}…</div>
          ) : info.quick && left > 0 ? (
            <div className="qk-wait">
              {t(ui.startsIn)} <b>{left}</b>
            </div>
          ) : state.isHost ? (
            <Btn kind="go" onClick={onStart}>
              {t(ui.startRace)}
            </Btn>
          ) : (
            <div className="qk-wait">{t(ui.waitingForHost)}</div>
          )}
          {state.isHost && info.quick && !racing && (
            <Btn kind="go" onClick={onStart}>
              {t(ui.startRace)}
            </Btn>
          )}
        </div>
      </div>
    </div>
  );
};

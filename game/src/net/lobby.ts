/**
 * Online lobbies. A lobby is one realtime room named after its 5-letter code:
 *  - the host (first member, then the next in join order if they leave) owns the lobby state:
 *    cup, phase, grid (humans + AI fill-ins), race seed and start time, results;
 *  - every member pings the host to share one clock, so countdowns and race timers line up;
 *  - race traffic (kart states, item events, finish times) goes through the same room.
 * Public lobbies are stored in the SDK shared collection "lobbies" and announced live in a
 * directory room, which tells the list which of them are still open right now.
 */
import { makeTransport, gameKey, Transport, NetMsg, NetStatus } from "./transport";

export const MAX_HUMANS = 8;
export const GRID_SIZE = 6; // AI karts fill the grid up to this many racers
const CODE_ABC = "ACDEFGHJKLMNPQRTUVWXY34679";
const QUICK_WAIT_MS = 20000;
const RESULTS_MS = 11000;
const START_LEAD_MS = 6500; // intro flyover + 3-2-1 before GO

export function newCode() {
  let c = "";
  for (let i = 0; i < 5; i++) c += CODE_ABC[Math.floor(Math.random() * CODE_ABC.length)];
  return c;
}
export function cleanCode(s: string) {
  return (s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/O/g, "0")
    .slice(0, 5);
}
export const isCode = (s: string) => /^[A-Z0-9]{5}$/.test(s);

export interface Profile {
  nick: string;
  racer: number;
}
export interface Member {
  id: string;
  nick: string;
  racer: number;
  spectator: boolean;
}
export interface GridSlot {
  id: string;
  bot: boolean;
  racer: number;
  nick: string;
}
export interface NetStanding {
  id: string;
  nick: string;
  racer: number;
  ms: number;
  bot: boolean;
  done: boolean;
}
export type LobbyPhase = "waiting" | "racing" | "results";
export interface LobbyInfo {
  code: string;
  cupId: string;
  pub: boolean;
  quick: boolean;
  phase: LobbyPhase;
  raceId: number;
  seed: number;
  /** host clock (ms) of GO */
  startAt: number;
  laps: number;
  grid: GridSlot[];
  hostId: string;
  /** join order of member ids (host hand-over) */
  order: string[];
  /** quick lobbies: host clock when the next race starts by itself (0 = not scheduled) */
  autoAt: number;
  results: NetStanding[] | null;
  /** host clock when results end */
  resultsUntil: number;
  /** the players, as the host knows them */
  members: Member[];
}

export interface LobbyState {
  status: NetStatus | "notfound" | "full";
  info: LobbyInfo | null;
  members: Member[];
  me: string;
  isHost: boolean;
}

export interface LobbyOptions {
  create: boolean;
  pub: boolean;
  quick: boolean;
  cupId: string;
  laps: number;
  fallbackApi: string;
  directory: Directory | null;
}

type RaceListener = (from: string, m: NetMsg) => void;

export class Lobby {
  code: string;
  t: Transport;
  state: LobbyState;
  private members: { [id: string]: Member } = {};
  private listeners: ((s: LobbyState) => void)[] = [];
  private race: RaceListener[] = [];
  private offset = 0;
  private bestRtt = Infinity;
  private timer = 0;
  private pings = 0;
  private waitInfo = 0;
  private fins: { [id: string]: { ms: number } } = {};
  private botFins: { [id: string]: number } = {};
  private firstFin = 0;
  private profile: Profile;
  private closed = false;

  constructor(code: string, profile: Profile, private o: LobbyOptions) {
    this.code = code;
    this.profile = { ...profile };
    this.t = makeTransport(`qkr-${gameKey()}-${code}`, profile.nick, o.fallbackApi);
    this.state = { status: "idle", info: null, members: [], me: "", isHost: false };
  }

  subscribe(fn: (s: LobbyState) => void) {
    this.listeners.push(fn);
    fn(this.state);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }
  onRace(fn: RaceListener) {
    this.race.push(fn);
    return () => {
      const i = this.race.indexOf(fn);
      if (i >= 0) this.race.splice(i, 1);
    };
  }
  /** The host's clock (ms): everyone schedules on it. */
  now() {
    return Date.now() + this.offset;
  }
  get me() {
    return this.t.id;
  }
  get isHost() {
    return !!this.state.info && this.state.info.hostId === this.t.id;
  }

  async connect() {
    this.t.onStatus((s) => {
      if (this.closed) return;
      if (s === "error" || s === "closed") this.emit({ status: s });
      else if (s === "reconnecting") this.emit({ status: s });
      else if (s === "connected" && this.state.info) this.emit({ status: "connected" });
    });
    this.t.onPeer((id, joined) => this.peer(id, joined));
    this.t.onMessage((from, m) => this.message(from, m));
    this.emit({ status: "connecting" });
    try {
      await this.t.connect();
    } catch {
      this.emit({ status: "error" });
      return;
    }
    if (this.closed) return;
    this.timer = window.setInterval(() => {
      try {
        this.tick();
      } catch (e) {
        console.warn("[lobby] tick", e);
      }
    }, 500);
    try {
      this.afterConnect();
    } catch (e) {
      console.warn("[lobby] connect", e);
    }
  }

  private afterConnect() {
    const me: Member = { id: this.t.id, nick: this.profile.nick, racer: this.profile.racer, spectator: false };
    this.members[me.id] = me;
    if (this.o.create) {
      const info: LobbyInfo = {
        code: this.code,
        cupId: this.o.cupId,
        pub: this.o.pub,
        quick: this.o.quick,
        phase: "waiting",
        raceId: 0,
        seed: 0,
        startAt: 0,
        laps: this.o.laps,
        grid: [],
        hostId: me.id,
        order: [me.id],
        autoAt: this.o.quick ? Date.now() + QUICK_WAIT_MS : 0,
        results: null,
        resultsUntil: 0,
        members: [me],
      };
      this.state = { ...this.state, info, me: me.id };
      this.emit({ status: "connected" });
      if (this.o.pub && this.o.directory) this.o.directory.announce(this, true);
    } else {
      this.state = { ...this.state, me: me.id };
      this.sayHi();
      // nobody answers: the code is wrong or the lobby has closed
      this.waitInfo = window.setTimeout(() => {
        if (!this.state.info && !this.closed) this.emit({ status: "notfound" });
      }, 7000);
    }
  }

  private sayHi(to?: string[]) {
    const m = this.members[this.t.id];
    this.t.send({ t: "hi", nick: this.profile.nick, racer: this.profile.racer, spectator: m ? m.spectator : false }, { to });
  }

  setRacer(racer: number) {
    this.profile.racer = racer;
    const m = this.members[this.t.id];
    if (m) m.racer = racer;
    this.sayHi();
    this.publishMembers();
  }

  // ------------------------------------------------------------ host actions
  setCup(cupId: string) {
    const i = this.state.info;
    if (!i || !this.isHost || i.phase === "racing") return;
    this.setInfo({ ...i, cupId });
  }
  /** Host: start a race now (humans present + AI fill-ins). */
  start() {
    const i = this.state.info;
    if (!i || !this.isHost || i.phase === "racing") return;
    const humans = this.memberList().slice(0, MAX_HUMANS);
    humans.forEach((m) => (m.spectator = false));
    const grid: GridSlot[] = humans.map((m) => ({ id: m.id, bot: false, racer: m.racer, nick: m.nick }));
    const used: { [r: number]: number } = {};
    grid.forEach((g) => (used[g.racer] = (used[g.racer] || 0) + 1));
    let b = 0;
    while (grid.length < Math.max(GRID_SIZE, grid.length)) {
      // AI fill-ins take the racers nobody picked first
      let racer = 0;
      let best = Infinity;
      for (let r = 0; r < 5; r++) {
        const u = (used[r] || 0) * 10 + ((r + b) % 5);
        if (u < best) {
          best = u;
          racer = r;
        }
      }
      used[racer] = (used[racer] || 0) + 1;
      grid.push({ id: `bot${b}`, bot: true, racer, nick: "" });
      b++;
    }
    this.fins = {};
    this.botFins = {};
    this.firstFin = 0;
    this.setInfo({
      ...i,
      phase: "racing",
      raceId: i.raceId + 1,
      seed: Math.floor(Math.random() * 2147483647),
      startAt: Date.now() + START_LEAD_MS,
      grid,
      autoAt: 0,
      results: null,
      resultsUntil: 0,
    });
  }

  /** Any member: my finish time (race ms) for this race. The host collects them. */
  reportFinish(raceId: number, ms: number) {
    const i = this.state.info;
    if (!i || i.raceId !== raceId) return;
    if (this.isHost) this.gotFinish(this.t.id, raceId, ms);
    else this.t.send({ t: "fin", r: raceId, ms });
  }
  /** Host: an AI kart crossed the line. */
  botFinish(id: string, ms: number) {
    if (!this.botFins[id]) this.botFins[id] = ms;
  }
  /** Host: progress of every unfinished racer, used to rank them when the race is called. */
  progressOf: (id: string) => number = () => 0;

  private gotFinish(from: string, raceId: number, ms: number) {
    const i = this.state.info;
    if (!i || !this.isHost || i.raceId !== raceId || i.phase !== "racing") return;
    if (!this.fins[from]) this.fins[from] = { ms };
    if (!this.firstFin) this.firstFin = Date.now();
    this.maybeEnd();
  }
  private maybeEnd() {
    const i = this.state.info;
    if (!i || i.phase !== "racing") return;
    const present = this.memberList().map((m) => m.id);
    const humans = i.grid.filter((g) => !g.bot && present.indexOf(g.id) >= 0);
    const allIn = humans.every((g) => !!this.fins[g.id]);
    const late = this.firstFin && Date.now() - this.firstFin > 25000;
    const nobody = humans.length === 0;
    const tooLong = Date.now() - i.startAt > 12 * 60000;
    if (!(allIn || late || nobody || tooLong)) return;
    const standings: NetStanding[] = i.grid.map((g) => {
      const f = g.bot ? this.botFins[g.id] : this.fins[g.id] ? this.fins[g.id].ms : 0;
      return { id: g.id, nick: g.nick, racer: g.racer, ms: f || 0, bot: g.bot, done: !!f };
    });
    const prog = (s: NetStanding) => this.progressOf(s.id);
    standings.sort((a, b) => {
      if (a.done && b.done) return a.ms - b.ms;
      if (a.done) return -1;
      if (b.done) return 1;
      return prog(b) - prog(a);
    });
    this.setInfo({ ...i, phase: "results", results: standings, resultsUntil: Date.now() + RESULTS_MS });
  }

  leave() {
    this.closed = true;
    window.clearInterval(this.timer);
    window.clearTimeout(this.waitInfo);
    if (this.o.directory) this.o.directory.announce(this, false);
    this.t.close();
    this.listeners = [];
    this.race = [];
  }

  sendRace(m: NetMsg, reliable: boolean, to?: string[]) {
    this.t.send(m, { reliable, to });
  }

  // ------------------------------------------------------------ internals
  private memberList(): Member[] {
    const i = this.state.info;
    if (i && i.hostId !== this.t.id && i.members) {
      // the host's list is the truth; keep my own profile fresh
      const present = this.t.peers();
      return i.members
        .filter((m) => m.id === this.t.id || present.indexOf(m.id) >= 0)
        .map((m) => (m.id === this.t.id && this.members[m.id] ? { ...m, racer: this.members[m.id].racer } : m));
    }
    const order = i ? i.order : [];
    const present = this.t.peers();
    const all = Object.keys(this.members).filter((id) => id === this.t.id || present.indexOf(id) >= 0);
    all.sort((a, b) => {
      const ia = order.indexOf(a),
        ib = order.indexOf(b);
      return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || (a < b ? -1 : 1);
    });
    return all.map((id) => this.members[id]);
  }
  private publishMembers() {
    this.emit({ members: this.memberList() });
  }

  private peer(id: string, joined: boolean) {
    if (joined) {
      this.sayHi([id]);
      if (this.isHost && this.state.info) this.t.send({ t: "lobby", info: this.state.info }, { to: [id] });
    } else {
      delete this.members[id];
      const i = this.state.info;
      if (i && i.hostId === id) {
        // host left: the next member in join order takes over
        const left = i.order.filter((x) => x !== id && (x === this.t.id || this.t.peers().indexOf(x) >= 0));
        const next = left[0] || this.t.id;
        const ni = { ...i, hostId: next, order: left.length ? left : [this.t.id] };
        if (next === this.t.id) {
          this.setInfo(ni);
          if (ni.pub && this.o.directory) this.o.directory.announce(this, true);
        } else this.state = { ...this.state, info: ni };
      } else if (i && this.isHost) {
        this.setInfo({ ...i, order: i.order.filter((x) => x !== id) });
        this.maybeEnd();
      }
      this.publishMembers();
    }
  }

  private message(from: string, m: NetMsg) {
    switch (m.t) {
      case "hi": {
        const known = !!this.members[from];
        this.members[from] = { id: from, nick: String(m.nick || "?").slice(0, 24), racer: Math.max(0, Math.min(4, m.racer | 0)), spectator: !!m.spectator };
        const i = this.state.info;
        if (this.isHost && i) {
          if (i.order.indexOf(from) < 0) {
            const present = this.memberList().length;
            if (present > MAX_HUMANS) {
              this.t.send({ t: "full" }, { to: [from] });
              return;
            }
            const order = i.order.concat([from]);
            // a newcomer during a race watches it and races the next one
            if (i.phase === "racing") this.members[from].spectator = true;
            let autoAt = i.autoAt;
            if (i.quick && i.phase === "waiting") {
              if (present >= MAX_HUMANS) autoAt = Date.now() + 3000;
              else if (autoAt && autoAt - Date.now() < 8000) autoAt = Date.now() + 8000; // give a newcomer time to pick
            }
            this.setInfo({ ...i, order, autoAt });
          } else this.setInfo({ ...i });
          if (!known) this.t.send({ t: "lobby", info: this.state.info }, { to: [from] });
        }
        this.publishMembers();
        break;
      }
      case "lobby": {
        const info = m.info as LobbyInfo;
        if (!info || info.code !== this.code) return;
        // only the host speaks for the lobby
        if (from !== info.hostId) return;
        if (this.state.info && this.state.info.hostId === this.t.id && this.state.info.order.indexOf(from) > this.state.info.order.indexOf(this.t.id)) return;
        window.clearTimeout(this.waitInfo);
        const first = !this.state.info;
        this.state = { ...this.state, info, isHost: info.hostId === this.t.id };
        this.emit({ status: "connected" });
        if (first) this.syncClock(true);
        break;
      }
      case "full":
        this.emit({ status: "full" });
        break;
      case "ping":
        this.t.send({ t: "pong", c: m.c, h: this.now() }, { to: [from], reliable: false });
        break;
      case "pong": {
        const i = this.state.info;
        if (!i || from !== i.hostId) return;
        const now = Date.now();
        const rtt = now - m.c;
        if (rtt < 0 || rtt > 5000) return;
        if (rtt <= this.bestRtt * 1.3 || this.pings < 4) {
          this.bestRtt = Math.min(this.bestRtt, rtt);
          this.offset = m.h + rtt / 2 - now;
        }
        break;
      }
      case "fin":
        this.gotFinish(from, m.r, m.ms);
        break;
      default:
        this.race.forEach((f) => f(from, m));
    }
  }

  private syncClock(burst = false) {
    if (this.isHost) {
      this.offset = 0;
      return;
    }
    const n = burst ? 5 : 1;
    for (let k = 0; k < n; k++)
      window.setTimeout(() => {
        this.pings++;
        this.t.send({ t: "ping", c: Date.now() }, { reliable: false, to: this.state.info ? [this.state.info.hostId] : undefined });
      }, k * 150);
  }

  private beat = 0;
  private tick() {
    this.beat++;
    const i = this.state.info;
    if (!i) return;
    if (this.isHost) {
      this.offset = 0;
      if (this.beat % 4 === 0) this.setInfo({ ...i });
      if (i.phase === "waiting" && i.quick) {
        if (!i.autoAt) this.setInfo({ ...i, autoAt: Date.now() + QUICK_WAIT_MS });
        else if (Date.now() >= i.autoAt) this.start();
      }
      if (i.phase === "racing") this.maybeEnd();
      if (i.phase === "results" && Date.now() >= i.resultsUntil) {
        this.memberList().forEach((m) => (m.spectator = false));
        this.setInfo({ ...i, phase: "waiting", autoAt: i.quick ? Date.now() + QUICK_WAIT_MS : 0 });
      }
      if (i.pub && this.o.directory && this.beat % 6 === 0) this.o.directory.announce(this, true);
    } else {
      if (this.beat % 6 === 0) this.syncClock();
      // until the host lists us, keep saying hello (early packets can be lost while the link warms up)
      if (i.order.indexOf(this.t.id) < 0 && this.beat % 2 === 0) this.sayHi([i.hostId]);
    }
  }

  private setInfo(info: LobbyInfo) {
    if (info.hostId === this.t.id) {
      this.state = { ...this.state, info };
      info = { ...info, members: this.memberList().map((m) => ({ id: m.id, nick: m.nick, racer: m.racer, spectator: m.spectator })) };
    }
    this.state = { ...this.state, info, isHost: info.hostId === this.t.id };
    if (info.hostId === this.t.id) this.t.send({ t: "lobby", info });
    this.emit({});
    if (info.pub && this.o.directory && this.isHost) this.o.directory.announce(this, true);
  }

  private emit(p: Partial<LobbyState>) {
    this.state = { ...this.state, ...p, members: p.members ?? this.memberList(), me: this.t.id || this.state.me };
    this.state.isHost = !!this.state.info && this.state.info.hostId === this.t.id;
    this.listeners.slice().forEach((f) => f(this.state));
  }
}

// ------------------------------------------------------------------ public lobby list
export interface LobbyAd {
  code: string;
  cupId: string;
  count: number;
  max: number;
  phase: LobbyPhase;
  quick: boolean;
  host: string;
  /** seen live in the directory room (else: only in the SDK store, very recent) */
  live: boolean;
  at: number;
}

export interface SharedRow {
  key?: string;
  nickname: string;
  data: any;
  mine: boolean;
  updatedAt?: string;
}
/** The SDK shared collection "lobbies" (0.4.0 keyed rows: set/remove; 0.3.0: add only). */
export interface SharedStore {
  set: ((key: string, data: Record<string, unknown>) => Promise<boolean>) | null;
  remove: ((key: string) => Promise<boolean>) | null;
  add: (data: Record<string, unknown>) => Promise<boolean>;
  list(): Promise<SharedRow[]>;
  now(): Promise<number>;
}

/**
 * The public lobby list. Hosts keep one row of the SDK shared collection "lobbies" up to date
 * (a heartbeat every 10 s, removed when the lobby closes); the list shows the rows written in the
 * last 30 s. The same lobbies are also announced in a live directory room, which covers players
 * the SDK cannot store for (guests, previews) and drops a lobby the moment its host leaves.
 */
export class Directory {
  t: Transport | null = null;
  private ads: { [code: string]: { ad: LobbyAd; from: string; seen: number } } = {};
  private stored: LobbyAd[] = [];
  private lastSet = 0;
  private listeners: ((ads: LobbyAd[], status: NetStatus) => void)[] = [];
  private users = 0;
  private hosting: Lobby | null = null;
  private poll = 0;
  private storedAdds: { [code: string]: boolean } = {};
  status: NetStatus = "idle";

  constructor(private nick: string, private fallbackApi: string, private store: SharedStore | null) {}

  private ensure() {
    if (this.t) return;
    const t = makeTransport(`qkr-${gameKey()}-lobbies`, this.nick, this.fallbackApi);
    this.t = t;
    t.onStatus((s) => {
      this.status = s;
      this.emit();
    });
    t.onMessage((from, m) => {
      if (m.t === "ad" && m.ad && typeof m.ad.code === "string") {
        if (m.ad.closed) delete this.ads[m.ad.code];
        else this.ads[m.ad.code] = { ad: { ...m.ad, live: true }, from, seen: Date.now() };
        this.emit();
      }
    });
    t.onPeer((id, joined) => {
      if (joined) {
        if (this.hosting) this.sendAd(this.hosting, [id]);
      } else {
        Object.keys(this.ads).forEach((c) => {
          if (this.ads[c].from === id) delete this.ads[c];
        });
        this.emit();
      }
    });
    t.connect().catch(() => {});
    this.poll = window.setInterval(() => {
      const now = Date.now();
      Object.keys(this.ads).forEach((c) => {
        if (now - this.ads[c].seen > 9000) delete this.ads[c];
      });
      this.emit();
    }, 2000);
  }
  private release() {
    if (this.users > 0 || this.hosting) return;
    window.clearInterval(this.poll);
    if (this.t) this.t.close();
    this.t = null;
    this.ads = {};
    this.status = "idle";
  }

  /** Watch the list (while the online screen is open). */
  watch(fn: (ads: LobbyAd[], status: NetStatus) => void) {
    this.users++;
    this.listeners.push(fn);
    this.ensure();
    void this.refreshStored();
    const sp = window.setInterval(() => void this.refreshStored(), 8000);
    fn(this.list(), this.status);
    return () => {
      window.clearInterval(sp);
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
      this.users--;
      this.release();
    };
  }

  async refreshStored() {
    if (!this.store) return;
    try {
      const rows = await this.store.list();
      const now = await this.store.now();
      const out: LobbyAd[] = [];
      rows.forEach((r) => {
        const d = r.data || {};
        const code = String(d.code || "");
        const at = r.updatedAt ? Date.parse(r.updatedAt) : Number(d.at) || 0;
        if (!isCode(code) || d.closed || !(now - at < 30000)) return;
        out.push({
          code,
          cupId: String(d.cup || ""),
          count: Math.max(1, Number(d.n) || 1),
          max: Number(d.max) || MAX_HUMANS,
          phase: d.phase === "racing" ? "racing" : d.phase === "results" ? "results" : "waiting",
          quick: !!d.quick,
          host: r.nickname,
          live: true,
          at: at - now + Date.now(),
        });
      });
      this.stored = out;
      this.emit();
    } catch {
      /* SDK off (guest, preview): the live directory still works */
    }
  }

  /** Host side: keep a public lobby listed (or remove it). */
  announce(lobby: Lobby, on: boolean) {
    if (on) {
      if (this.hosting !== lobby) {
        this.hosting = lobby;
        this.lastSet = 0;
        this.ensure();
      }
      this.storeAd(lobby);
      this.sendAd(lobby);
    } else if (this.hosting === lobby) {
      if (this.t) this.t.send({ t: "ad", ad: { code: lobby.code, closed: true } });
      if (this.store) {
        if (this.store.remove) void this.store.remove("lobby").catch(() => {});
        else void this.store.add({ code: lobby.code, closed: true }).catch(() => {});
      }
      this.hosting = null;
      window.setTimeout(() => this.release(), 300);
    }
  }
  /** SDK row: keyed heartbeat (0.4.0), or a single append when the lobby opens (0.3.0). */
  private storeAd(lobby: Lobby) {
    const i = lobby.state.info;
    if (!this.store || !i || !lobby.isHost) return;
    const data = { code: i.code, cup: i.cupId, quick: i.quick, n: lobby.state.members.length, max: MAX_HUMANS, phase: i.phase };
    if (this.store.set) {
      if (Date.now() - this.lastSet < 10000) return;
      this.lastSet = Date.now();
      void this.store.set("lobby", data).catch(() => {});
    } else if (!this.storedAdds[lobby.code]) {
      this.storedAdds[lobby.code] = true;
      void this.store
        .now()
        .then((at) => this.store!.add({ ...data, at }))
        .catch(() => {});
    }
  }
  private sendAd(lobby: Lobby, to?: string[]) {
    const i = lobby.state.info;
    if (!this.t || !i || !lobby.isHost) return;
    const ad: LobbyAd = {
      code: i.code,
      cupId: i.cupId,
      count: lobby.state.members.length,
      max: MAX_HUMANS,
      phase: i.phase,
      quick: i.quick,
      host: (lobby.state.members[0] && lobby.state.members[0].nick) || "",
      live: true,
      at: Date.now(),
    };
    this.t.send({ t: "ad", ad }, { to });
  }

  list(): LobbyAd[] {
    const out: LobbyAd[] = [];
    const seen: { [c: string]: boolean } = {};
    Object.keys(this.ads).forEach((c) => {
      const a = this.ads[c].ad;
      if (this.hosting && this.hosting.code === c) return;
      seen[c] = true;
      out.push(a);
    });
    // lobbies from the SDK store that the live room has not announced (other networks, late joiners)
    this.stored.forEach((a) => {
      if (seen[a.code] || (this.hosting && this.hosting.code === a.code)) return;
      seen[a.code] = true;
      out.push(a);
    });
    out.sort((a, b) => (a.phase === "waiting" ? 0 : 1) - (b.phase === "waiting" ? 0 : 1) || b.count - a.count || b.at - a.at);
    return out;
  }
  private emit() {
    const l = this.list();
    this.listeners.slice().forEach((f) => f(l, this.status));
  }
}

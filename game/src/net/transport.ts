/**
 * Message transport for online races. Two implementations behind one interface:
 *  - LiveKitTransport: Mexty's LiveKit server (the same rooms @mexty/multiplayer uses). Lossy data
 *    packets for kart positions, reliable ones for everything else.
 *  - LocalTransport: BroadcastChannel between tabs of one browser (development: ?net=local).
 * Tokens come from the Mexty API with the play token the EdVerse player hands the game.
 */
import type { Room, RemoteParticipant } from "livekit-client";

// LiveKit is loaded only when a player goes online (most races are solo)
type LK = typeof import("livekit-client");
let lkPromise: Promise<LK> | null = null;
const loadLiveKit = () => (lkPromise = lkPromise || import("livekit-client"));

export interface NetMsg {
  t: string;
  [k: string]: any;
}
export type NetStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error" | "closed";

export interface Transport {
  readonly id: string;
  status: NetStatus;
  connect(): Promise<void>;
  send(msg: NetMsg, opts?: { reliable?: boolean; to?: string[] }): void;
  onMessage(cb: (from: string, msg: NetMsg) => void): () => void;
  onPeer(cb: (id: string, joined: boolean) => void): () => void;
  onStatus(cb: (s: NetStatus) => void): () => void;
  peers(): string[];
  close(): void;
}

// ------------------------------------------------------------------ host handshake
/** What the EdVerse player tells the game (mexty:sdk:v1:welcome): the API origin and this play's token. */
export const host: { apiUrl?: string; play?: string; blockId?: string } = {};
if (typeof window !== "undefined") {
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (d && d.type === "mexty:sdk:v1:welcome") {
      if (typeof d.apiUrl === "string") host.apiUrl = d.apiUrl;
      if (typeof d.play === "string") host.play = d.play;
      if (typeof d.blockId === "string") host.blockId = d.blockId;
    }
  });
}

function query(): URLSearchParams {
  try {
    return new URLSearchParams(window.location.search);
  } catch {
    return new URLSearchParams();
  }
}

/** Which transport this page uses: "local" (BroadcastChannel), "lkdev" (local LiveKit server) or "livekit". */
export function netMode(): "local" | "lkdev" | "livekit" {
  const q = query();
  if (q.get("net") === "local") return "local";
  if (q.get("net") === "lkdev") return "lkdev";
  return "livekit";
}

/** Scope for room names: one set of rooms per game. */
export function gameKey(): string {
  return (host.blockId || "dev").slice(-12);
}

export interface Creds {
  token: string;
  serverUrl: string;
}

async function fetchToken(room: string, name: string, fallbackApi: string): Promise<Creds> {
  if (netMode() === "lkdev") {
    const q = query();
    const base = q.get("lktoken") || "http://127.0.0.1:7890";
    const r = await fetch(`${base}/token?room=${encodeURIComponent(room)}&name=${encodeURIComponent(name)}`);
    if (!r.ok) throw new Error(`dev token ${r.status}`);
    return r.json();
  }
  const api = (host.apiUrl || fallbackApi).replace(/\/$/, "");
  const r = await fetch(`${api}/api/livekit/token`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(host.play ? { "X-Mexty-Play": host.play } : {}) },
    // participantName keeps the player's generated nickname as the LiveKit name (never an account name)
    body: JSON.stringify({ roomId: room, participantName: name }),
  });
  const data = r.ok ? await r.json() : null;
  if (!data || !data.success || !data.token || !data.serverUrl) throw new Error(`room token refused (${r.status})`);
  return { token: data.token, serverUrl: data.serverUrl };
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const TOPIC = "qkr";

class Emitter<A extends any[]> {
  private fns: ((...a: A) => void)[] = [];
  on(f: (...a: A) => void) {
    this.fns.push(f);
    return () => {
      const i = this.fns.indexOf(f);
      if (i >= 0) this.fns.splice(i, 1);
    };
  }
  emit(...a: A) {
    this.fns.slice().forEach((f) => {
      try {
        f(...a);
      } catch (e) {
        console.warn("[net] listener", e);
      }
    });
  }
}

// ------------------------------------------------------------------ LiveKit
export class LiveKitTransport implements Transport {
  id = "";
  status: NetStatus = "idle";
  private room: Room | null = null;
  private msg = new Emitter<[string, NetMsg]>();
  private peer = new Emitter<[string, boolean]>();
  private st = new Emitter<[NetStatus]>();
  private warned = false;

  constructor(private roomName: string, private name: string, private fallbackApi: string) {}
  private wire(lk: LK) {
    const { Room, RoomEvent, ConnectionState } = lk;
    this.room = new Room({ adaptiveStream: false, dynacast: false, stopLocalTrackOnUnpublish: true, disconnectOnPageLeave: true });
    this.room.on(RoomEvent.DataReceived, (payload: Uint8Array, p?: RemoteParticipant, _k?: unknown, topic?: string) => {
      if (topic && topic !== TOPIC) return;
      if (!p) return;
      try {
        this.msg.emit(p.identity, JSON.parse(dec.decode(payload)));
      } catch {
        /* not ours */
      }
    });
    this.room.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => this.peer.emit(p.identity, true));
    this.room.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => this.peer.emit(p.identity, false));
    this.room.on(RoomEvent.ConnectionStateChanged, (s: any) => {
      const m: NetStatus =
        s === ConnectionState.Connected ? "connected" : s === ConnectionState.Reconnecting || s === ConnectionState.SignalReconnecting ? "reconnecting" : s === ConnectionState.Connecting ? "connecting" : this.status === "closed" ? "closed" : "error";
      this.setStatus(m);
    });
  }
  private setStatus(s: NetStatus) {
    if (this.status === s) return;
    this.status = s;
    this.st.emit(s);
  }
  async connect() {
    this.setStatus("connecting");
    try {
      const [lk, c] = await Promise.all([loadLiveKit(), fetchToken(this.roomName, this.name, this.fallbackApi)]);
      if (this.status === "closed") return;
      this.wire(lk);
      const room = this.room!;
      await room.connect(c.serverUrl, c.token, { autoSubscribe: false });
      this.id = room.localParticipant.identity;
      this.setStatus("connected");
      room.remoteParticipants.forEach((p) => this.peer.emit(p.identity, true));
    } catch (e) {
      if (this.status === "closed") return; // closed while still connecting (left the screen): nothing went wrong
      console.warn("[net] connect failed", e);
      this.setStatus("error");
      throw e;
    }
  }
  send(m: NetMsg, o: { reliable?: boolean; to?: string[] } = {}) {
    if (this.status !== "connected" || !this.room) return;
    try {
      void this.room.localParticipant
        .publishData(enc.encode(JSON.stringify(m)), { reliable: o.reliable !== false, topic: TOPIC, destinationIdentities: o.to })
        .catch((e) => {
          if (!this.warned) console.warn("[net] publish failed", e && e.message ? e.message : e);
          this.warned = true;
        });
    } catch {
      /* closing */
    }
  }
  onMessage(cb: (from: string, m: NetMsg) => void) {
    return this.msg.on(cb);
  }
  onPeer(cb: (id: string, joined: boolean) => void) {
    return this.peer.on(cb);
  }
  onStatus(cb: (s: NetStatus) => void) {
    return this.st.on(cb);
  }
  peers() {
    const out: string[] = [];
    if (this.room) this.room.remoteParticipants.forEach((p) => out.push(p.identity));
    return out;
  }
  close() {
    this.setStatus("closed");
    if (this.room) void this.room.disconnect().catch(() => {});
  }
}

// ------------------------------------------------------------------ BroadcastChannel (dev)
export class LocalTransport implements Transport {
  id = "loc_" + Math.random().toString(36).slice(2, 9);
  status: NetStatus = "idle";
  private ch: BroadcastChannel | null = null;
  private seen: { [id: string]: number } = {};
  private beat = 0;
  private msg = new Emitter<[string, NetMsg]>();
  private peer = new Emitter<[string, boolean]>();
  private st = new Emitter<[NetStatus]>();
  private lat = Number(query().get("lat") || 0);

  constructor(private roomName: string) {}
  async connect() {
    this.status = "connecting";
    this.st.emit(this.status);
    this.ch = new BroadcastChannel("qkr:" + this.roomName);
    this.ch.onmessage = (e) => {
      const d = e.data as { from: string; to?: string[]; m?: NetMsg; hb?: boolean; bye?: boolean };
      if (!d || d.from === this.id) return;
      if (d.to && d.to.indexOf(this.id) < 0) return;
      const fresh = !this.seen[d.from];
      if (d.bye) {
        if (this.seen[d.from]) {
          delete this.seen[d.from];
          this.peer.emit(d.from, false);
        }
        return;
      }
      this.seen[d.from] = Date.now();
      if (fresh) {
        this.peer.emit(d.from, true);
        this.post({ from: this.id, hb: true, to: [d.from] });
      }
      if (d.m) {
        const m = d.m;
        if (this.lat > 0) setTimeout(() => this.msg.emit(d.from, m), this.lat);
        else this.msg.emit(d.from, m);
      }
    };
    await new Promise((r) => setTimeout(r, 60));
    this.post({ from: this.id, hb: true });
    this.beat = window.setInterval(() => {
      this.post({ from: this.id, hb: true });
      const now = Date.now();
      Object.keys(this.seen).forEach((id) => {
        if (now - this.seen[id] > 3500) {
          delete this.seen[id];
          this.peer.emit(id, false);
        }
      });
    }, 1000);
    this.status = "connected";
    this.st.emit(this.status);
  }
  private post(d: any) {
    try {
      this.ch && this.ch.postMessage(d);
    } catch {
      /* closed */
    }
  }
  send(m: NetMsg, o: { reliable?: boolean; to?: string[] } = {}) {
    if (this.status !== "connected") return;
    if (o.reliable === false && Number(query().get("loss") || 0) > Math.random()) return;
    this.post({ from: this.id, to: o.to, m });
  }
  onMessage(cb: (from: string, m: NetMsg) => void) {
    return this.msg.on(cb);
  }
  onPeer(cb: (id: string, joined: boolean) => void) {
    return this.peer.on(cb);
  }
  onStatus(cb: (s: NetStatus) => void) {
    return this.st.on(cb);
  }
  peers() {
    return Object.keys(this.seen);
  }
  close() {
    this.post({ from: this.id, bye: true });
    window.clearInterval(this.beat);
    this.status = "closed";
    this.st.emit(this.status);
    try {
      this.ch && this.ch.close();
    } catch {
      /* already */
    }
    this.ch = null;
  }
}

export function makeTransport(room: string, name: string, fallbackApi: string): Transport {
  return netMode() === "local" ? new LocalTransport(room) : new LiveKitTransport(room, name, fallbackApi);
}

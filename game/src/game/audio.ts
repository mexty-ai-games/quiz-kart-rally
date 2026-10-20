/**
 * All sound is synthesised with WebAudio (no audio files): the kart engine, race jingles,
 * answer chimes, bonus sounds and a light looping tune. Respects the store's mute.
 */
type Wave = OscillatorType;

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private eng: { o1: OscillatorNode; o2: OscillatorNode; f: BiquadFilterNode; g: GainNode } | null = null;
  private muted = false;
  private musicOn = false;
  private musicTimer = 0;
  private nextBeat = 0;
  private beat = 0;
  private noiseBuf: AudioBuffer | null = null;

  /** Create/resume the audio context (must follow a user gesture). */
  ensure() {
    try {
      if (!this.ctx) {
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC() as AudioContext;
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.9;
        this.master.connect(this.ctx.destination);
        this.sfxBus = this.ctx.createGain();
        this.sfxBus.gain.value = 0.75;
        this.sfxBus.connect(this.master);
        this.musicBus = this.ctx.createGain();
        this.musicBus.gain.value = 0.22;
        this.musicBus.connect(this.master);
        const len = this.ctx.sampleRate * 0.6;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  private tone(freq: number, dur: number, o: { type?: Wave; vol?: number; at?: number; slide?: number; attack?: number; bus?: "sfx" | "music" } = {}) {
    const c = this.ctx;
    if (!c || !this.sfxBus || !this.musicBus) return;
    const t = c.currentTime + (o.at ?? 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type ?? "square";
    osc.frequency.setValueAtTime(freq, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * o.slide), t + dur);
    const v = o.vol ?? 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + (o.attack ?? 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(o.bus === "music" ? this.musicBus : this.sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private noise(dur: number, o: { vol?: number; at?: number; from?: number; to?: number; q?: number } = {}) {
    const c = this.ctx;
    if (!c || !this.sfxBus || !this.noiseBuf) return;
    const t = c.currentTime + (o.at ?? 0);
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = o.q ?? 1.2;
    f.frequency.setValueAtTime(o.from ?? 800, t);
    f.frequency.exponentialRampToValueAtTime(o.to ?? 3000, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol ?? 0.25, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxBus);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // ---------------------------------------------------------------- engine
  engine(speed01: number, boost: boolean, on: boolean) {
    const c = this.ctx;
    if (!c || !this.sfxBus) return;
    if (!this.eng && on) {
      const o1 = c.createOscillator();
      const o2 = c.createOscillator();
      o1.type = "sawtooth";
      o2.type = "square";
      const f = c.createBiquadFilter();
      f.type = "lowpass";
      f.Q.value = 3;
      const g = c.createGain();
      g.gain.value = 0;
      o1.connect(f);
      o2.connect(f);
      f.connect(g);
      g.connect(this.sfxBus);
      o1.start();
      o2.start();
      this.eng = { o1, o2, f, g };
    }
    if (!this.eng) return;
    const t = c.currentTime;
    const base = 55 + speed01 * 120 + (boost ? 30 : 0);
    this.eng.o1.frequency.setTargetAtTime(base, t, 0.06);
    this.eng.o2.frequency.setTargetAtTime(base * 0.5 + 3, t, 0.06);
    this.eng.f.frequency.setTargetAtTime(380 + speed01 * 1300 + (boost ? 900 : 0), t, 0.08);
    this.eng.g.gain.setTargetAtTime(on ? 0.05 + speed01 * 0.05 : 0, t, 0.1);
  }

  stopEngine() {
    if (!this.eng || !this.ctx) return;
    const e = this.eng;
    e.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    window.setTimeout(() => {
      try {
        e.o1.stop();
        e.o2.stop();
      } catch {
        /* already stopped */
      }
    }, 300);
    this.eng = null;
  }

  // ---------------------------------------------------------------- one-shots
  countBeep() {
    this.tone(NOTE(69), 0.22, { type: "square", vol: 0.18 });
  }
  go() {
    this.tone(NOTE(81), 0.5, { type: "square", vol: 0.2 });
    this.tone(NOTE(76), 0.5, { type: "triangle", vol: 0.15 });
  }
  coin() {
    this.tone(NOTE(88), 0.07, { type: "square", vol: 0.1 });
    this.tone(NOTE(95), 0.18, { type: "square", vol: 0.1, at: 0.06 });
  }
  question() {
    this.tone(NOTE(76), 0.12, { type: "triangle", vol: 0.16 });
    this.tone(NOTE(83), 0.18, { type: "triangle", vol: 0.16, at: 0.1 });
  }
  correct() {
    [72, 76, 79, 84].forEach((n, k) => this.tone(NOTE(n), 0.22, { type: "triangle", vol: 0.2, at: k * 0.07 }));
    this.tone(NOTE(96), 0.4, { type: "sine", vol: 0.12, at: 0.28 });
  }
  wrong() {
    this.tone(NOTE(62), 0.35, { type: "sawtooth", vol: 0.12, slide: 0.5 });
    this.tone(NOTE(57), 0.45, { type: "square", vol: 0.08, at: 0.12, slide: 0.6 });
  }
  roulette(k: number) {
    this.tone(NOTE(79 + (k % 4) * 2), 0.05, { type: "square", vol: 0.07 });
  }
  bonusGet() {
    this.tone(NOTE(84), 0.12, { type: "square", vol: 0.12 });
    this.tone(NOTE(91), 0.25, { type: "square", vol: 0.12, at: 0.08 });
  }
  boost() {
    this.noise(0.7, { vol: 0.25, from: 400, to: 4000, q: 0.8 });
    this.tone(NOTE(55), 0.6, { type: "sawtooth", vol: 0.08, slide: 3 });
  }
  miniTurbo(level: number) {
    this.noise(0.35, { vol: 0.18, from: 1200, to: 5000 });
    this.tone(NOTE(level === 2 ? 79 : 74), 0.2, { type: "square", vol: 0.08 });
  }
  driftStart() {
    this.noise(0.2, { vol: 0.08, from: 2500, to: 1800, q: 4 });
  }
  spin() {
    this.tone(NOTE(84), 0.6, { type: "triangle", vol: 0.12, slide: 0.35 });
    this.noise(0.5, { vol: 0.12, from: 3000, to: 600 });
  }
  shieldPop() {
    this.tone(NOTE(90), 0.15, { type: "sine", vol: 0.18, slide: 0.5 });
    this.noise(0.15, { vol: 0.12, from: 4000, to: 2000 });
  }
  peel() {
    this.tone(NOTE(70), 0.12, { type: "triangle", vol: 0.12, slide: 1.5 });
  }
  nova() {
    [84, 88, 91, 96, 100].forEach((n, k) => this.tone(NOTE(n), 0.16, { type: "square", vol: 0.08, at: k * 0.05 }));
  }
  bump(s: number) {
    this.noise(0.12, { vol: 0.08 + s * 0.15, from: 300, to: 150, q: 0.7 });
  }
  wall(s: number) {
    this.noise(0.18, { vol: 0.1 + s * 0.2, from: 220, to: 90, q: 0.6 });
  }
  lap() {
    [79, 84].forEach((n, k) => this.tone(NOTE(n), 0.18, { type: "square", vol: 0.14, at: k * 0.12 }));
  }
  finalLap() {
    [72, 76, 79, 84, 79, 84].forEach((n, k) => this.tone(NOTE(n), 0.14, { type: "square", vol: 0.13, at: k * 0.1 }));
  }
  finish(win: boolean) {
    const seq = win ? [72, 76, 79, 84, 88, 91, 96] : [72, 74, 76, 79];
    seq.forEach((n, k) => this.tone(NOTE(n), 0.3, { type: "square", vol: 0.13, at: k * 0.11 }));
    this.tone(NOTE(seq[seq.length - 1] - 12), 0.9, { type: "triangle", vol: 0.15, at: seq.length * 0.11 });
  }
  uiClick() {
    this.tone(NOTE(84), 0.05, { type: "square", vol: 0.06 });
  }
  uiHover() {
    this.tone(NOTE(91), 0.03, { type: "sine", vol: 0.03 });
  }

  // ---------------------------------------------------------------- music
  /** A cheerful 4-bar loop (bass + arpeggio), scheduled ahead with a small timer. */
  music(on: boolean) {
    if (on === this.musicOn) return;
    this.musicOn = on;
    window.clearInterval(this.musicTimer);
    if (!on || !this.ctx) return;
    this.nextBeat = this.ctx.currentTime + 0.1;
    this.beat = 0;
    this.musicTimer = window.setInterval(() => this.schedule(), 60);
  }

  private schedule() {
    const c = this.ctx;
    if (!c || !this.musicOn) return;
    const spb = 60 / 132 / 2; // eighth notes at 132 bpm
    const chords = [
      [60, 64, 67],
      [57, 60, 64],
      [65, 69, 72],
      [67, 71, 74],
    ];
    while (this.nextBeat < c.currentTime + 0.3) {
      const b = this.beat;
      const bar = Math.floor(b / 8) % 4;
      const ch = chords[bar];
      const at = this.nextBeat - c.currentTime;
      if (b % 2 === 0) this.tone(NOTE(ch[0] - 24 + (b % 4 === 2 ? 12 : 0)), spb * 1.6, { type: "triangle", vol: 0.5, at, bus: "music" });
      const arp = ch[(b * 2) % 3] + (b % 8 >= 4 ? 12 : 0);
      this.tone(NOTE(arp + 12), spb * 0.9, { type: "square", vol: 0.12, at, bus: "music" });
      if (b % 4 === 0) this.noiseHat(at);
      this.nextBeat += spb;
      this.beat++;
    }
  }

  private noiseHat(at: number) {
    const c = this.ctx;
    if (!c || !this.musicBus || !this.noiseBuf) return;
    const t = c.currentTime + at;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 6000;
    const g = c.createGain();
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(f);
    f.connect(g);
    g.connect(this.musicBus);
    src.start(t);
    src.stop(t + 0.08);
  }

  close() {
    this.music(false);
    this.stopEngine();
    try {
      this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
  }
}

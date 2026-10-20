/**
 * Arcade kart physics: auto-throttle friendly, forgiving grip, drift with mini-turbos,
 * jumps with tricks (tap drift in the air, boost on landing), turbo/nova/spin-out states,
 * grass slow-down and a soft barrier. The ground (banked corners, hills, ramps) comes from the
 * track samples, so karts follow it without a physics engine.
 */
import * as THREE from "three";
import { BuiltTrack, Located, VERGE, locate } from "./track";

export interface KartInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 left .. 1 right
  drift: boolean;
}

export const VMAX = 27; // m/s ≈ 97 km/h (feels fast at kart scale)
export const VMAX_BOOST = 38;
export const VMAX_NOVA = 33;
export const VMAX_GRASS = 12;
export const KART_R = 1.15; // collision radius
export const COIN_MAX = 10;
const G = 26; // gamey gravity: short, punchy jumps

export type MiniTurbo = 0 | 1 | 2;

export interface KartEvents {
  wall: number;
  miniTurbo: MiniTurbo;
  driftStart: boolean;
  jump: boolean;
  land: number; // landing impact 0..1
  trick: boolean;
  trickBoost: boolean;
}

export const newKartEvents = (): KartEvents => ({ wall: 0, miniTurbo: 0, driftStart: false, jump: false, land: 0, trick: false, trickBoost: false });
export function resetKartEvents(e: KartEvents) {
  e.wall = 0;
  e.miniTurbo = 0;
  e.driftStart = false;
  e.jump = false;
  e.land = 0;
  e.trick = false;
  e.trickBoost = false;
}

export class Kart {
  p = new THREE.Vector3();
  yaw = 0;
  speed = 0;
  vlat = 0;
  vy = 0;
  steerSm = 0;
  idx = 0;
  lat = 0;
  onGrass = false;
  air = false;
  airT = 0;
  // states (seconds left)
  boostT = 0;
  spinT = 0;
  shieldT = 0;
  novaT = 0;
  coins = 0;
  // drift
  drifting = false;
  driftDir = 0;
  driftT = 0;
  private prevDrift = false;
  private prevRamp = 0;
  private prevRampSlope = 0;
  // tricks
  trickT = 0;
  tricked = false;
  trickDir = 1;
  /** visual: extra yaw while spinning out, body hop while drifting, squash after landing */
  spinYaw = 0;
  hop = 0;
  squash = 0;
  wheelSpin = 0;
  wallContact = false;
  /** visual tilt of the body: road bank and slope */
  roll = 0;
  pitch = 0;
  /** race progress */
  lap = 0;
  s = 0;
  halfway = false;
  finished = false;
  finishMs = 0;
  loc: Located = { i: 0, lat: 0, along: 0, y: 0, ramp: 0, rampSlope: 0 };
  /** speed multiplier (AI difficulty / rubber band) */
  power = 1;

  constructor(public track: BuiltTrack, public id: number) {}

  reset(s: number, lat: number) {
    const T = this.track;
    const N = T.samples.length;
    const i = Math.round(((s % T.length) + T.length) % T.length / T.step) % N;
    const S = T.samples[i];
    this.p.copy(S.p).addScaledVector(S.R, lat);
    this.yaw = S.yaw;
    this.speed = 0;
    this.vlat = 0;
    this.vy = 0;
    this.air = false;
    this.steerSm = 0;
    this.idx = i;
    this.boostT = this.spinT = this.shieldT = this.novaT = 0;
    this.coins = 0;
    this.drifting = false;
    this.driftT = 0;
    this.spinYaw = 0;
    this.hop = 0;
    this.squash = 0;
    this.trickT = 0;
    this.tricked = false;
    this.lap = 0;
    this.halfway = false;
    this.finished = false;
    this.finishMs = 0;
    this.s = S.s;
    this.lat = lat;
    locate(T, this.p, i, this.loc);
    this.p.y = this.loc.y;
  }

  get forward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** Total distance raced, for positions. */
  progress() {
    return this.lap * this.track.length + this.s;
  }

  vmax() {
    if (this.spinT > 0) return 7;
    if (this.onGrass && this.boostT <= 0 && this.novaT <= 0) return VMAX_GRASS;
    const coinBonus = (Math.min(COIN_MAX, this.coins) / COIN_MAX) * 2.4;
    if (this.boostT > 0) return VMAX_BOOST * this.power + coinBonus;
    if (this.novaT > 0) return VMAX_NOVA * this.power + coinBonus;
    return VMAX * this.power + coinBonus;
  }

  step(dt: number, inp: KartInput, ev: KartEvents) {
    const T = this.track;
    const L = locate(T, this.p, this.idx, this.loc);
    this.idx = L.i;
    this.lat = L.lat;
    this.s = T.samples[L.i].s;
    this.onGrass = !this.air && Math.abs(L.lat) > T.halfW + 0.6;

    if (this.boostT > 0) this.boostT = Math.max(0, this.boostT - dt);
    if (this.shieldT > 0) this.shieldT = Math.max(0, this.shieldT - dt);
    if (this.novaT > 0) this.novaT = Math.max(0, this.novaT - dt);
    if (this.spinT > 0) {
      this.spinT = Math.max(0, this.spinT - dt);
      this.spinYaw += dt * 11 * Math.min(1, this.spinT + 0.3);
      if (this.spinT === 0) this.spinYaw = 0;
    }
    const driftEdge = inp.drift && !this.prevDrift;
    this.prevDrift = inp.drift;

    // steering: quick but smooth; less authority while spinning or flying
    const target = THREE.MathUtils.clamp(inp.steer, -1, 1) * (this.spinT > 0 ? 0.2 : 1);
    this.steerSm += THREE.MathUtils.clamp(target - this.steerSm, -7 * dt, 7 * dt);

    // tricks: tap drift in the air shortly after take-off
    if (this.air) {
      this.airT += dt;
      if (driftEdge && !this.tricked && this.airT < 0.5 && this.spinT <= 0) {
        this.tricked = true;
        this.trickT = 0.45;
        this.trickDir = this.steerSm < -0.2 ? -1 : this.steerSm > 0.2 ? 1 : Math.random() < 0.5 ? -1 : 1;
        ev.trick = true;
      }
    }
    if (this.trickT > 0) this.trickT = Math.max(0, this.trickT - dt);

    // drift: hold the drift button while steering at speed; release for a mini-turbo
    const canDrift = this.speed > 11 && this.spinT <= 0 && !this.onGrass;
    if (!this.drifting && !this.air && inp.drift && canDrift && Math.abs(this.steerSm) > 0.35) {
      this.drifting = true;
      this.driftDir = Math.sign(this.steerSm);
      this.driftT = 0;
      this.hop = 0.35;
      ev.driftStart = true;
    }
    if (this.drifting) {
      if (!this.air) this.driftT += dt * (0.6 + (0.6 * Math.abs(this.steerSm + this.driftDir)) / 2);
      if (!inp.drift || !canDrift) {
        this.drifting = false;
        if (canDrift || this.speed > 8) {
          if (this.driftT > 1.7) ev.miniTurbo = 2;
          else if (this.driftT > 0.8) ev.miniTurbo = 1;
          if (ev.miniTurbo) this.boostT = Math.max(this.boostT, ev.miniTurbo === 2 ? 1.2 : 0.65);
        }
        this.driftT = 0;
      }
    }
    this.hop = Math.max(0, this.hop - dt * 2.2);
    this.squash = Math.max(0, this.squash - dt * 3.5);

    // yaw rate: tighter at low speed, drifts turn harder in the drift direction
    const sp = Math.max(0, this.speed);
    let turn = THREE.MathUtils.lerp(2.3, 1.4, Math.min(1, sp / VMAX)) * Math.min(1, sp / 4);
    let steer = this.steerSm;
    if (this.drifting) steer = this.driftDir * (0.75 + 0.45 * this.steerSm * this.driftDir);
    if (this.drifting) turn *= 1.25;
    if (this.air) turn *= 0.45;
    this.yaw -= steer * turn * dt * (this.speed < 0 ? -1 : 1);

    // longitudinal
    const vmax = this.vmax();
    let acc = 0;
    if (!this.air) {
      if (inp.throttle > 0.05 && this.speed < vmax) acc += inp.throttle * (12 * (1 - this.speed / vmax) + 3.8) + (this.boostT > 0 ? 20 : 0);
      if (this.speed > vmax) acc -= (this.speed - vmax) * (this.onGrass ? 3.2 : 1.4);
      if (inp.brake > 0.05) acc -= this.speed > 0.5 ? 22 * inp.brake : 7 * inp.brake;
      if (inp.throttle < 0.05 && inp.brake < 0.05) acc -= Math.sign(this.speed) * 3;
      acc -= 9.8 * T.samples[L.i].slope * 0.6;
      if (this.drifting) acc -= 1.5;
    } else if (this.boostT > 0 && this.speed < vmax) acc += 8;
    this.speed = Math.max(-8, this.speed + acc * dt);

    // lateral slide (drift lets the kart slide, grip pulls it back)
    if (this.drifting && !this.air) this.vlat += -this.driftDir * sp * 0.55 * dt;
    this.vlat *= Math.exp(-dt * (this.drifting ? 2.2 : this.air ? 0.6 : 7));

    const f = this.forward;
    const r = new THREE.Vector3(-f.z, 0, f.x);
    this.p.addScaledVector(f, this.speed * dt).addScaledVector(r, this.vlat * dt);
    this.wheelSpin += (this.speed * dt) / 0.32;

    // ground, jumps and barrier
    const L2 = locate(T, this.p, this.idx, this.loc);
    const S2 = T.samples[L2.i];
    if (this.air) {
      this.vy -= G * dt;
      this.p.y += this.vy * dt;
      if (this.p.y <= L2.y) {
        const impact = Math.min(1, Math.max(0, -this.vy / 14));
        this.p.y = L2.y;
        this.air = false;
        this.vy = 0;
        this.squash = 0.25 + impact * 0.4;
        ev.land = Math.max(0.2, impact);
        if (this.tricked && this.spinT <= 0) {
          this.boostT = Math.max(this.boostT, 1.0);
          ev.trickBoost = true;
        }
        this.tricked = false;
        this.trickT = 0;
      }
    } else if (this.prevRamp > 0.3 && L2.ramp === 0 && this.speed > 6) {
      // left the lip: fly
      this.air = true;
      this.airT = 0;
      this.tricked = false;
      this.vy = this.speed * this.prevRampSlope * 1.15 + 2.5;
      this.drifting = false;
      ev.jump = true;
      this.p.y = Math.max(this.p.y, L2.y);
    } else {
      this.p.y = L2.y;
    }
    this.prevRamp = this.air ? 0 : L2.ramp;
    this.prevRampSlope = L2.rampSlope;

    // body tilt for the visuals: bank across, slope (or ramp / flight) along
    const along = this.air ? THREE.MathUtils.clamp(this.vy / 30, -0.35, 0.35) : Math.atan(S2.slope + L2.rampSlope);
    const f2 = this.forward;
    const cosA = f2.x * S2.T.x + f2.z * S2.T.z; // facing along the track (+1) or backwards (-1)
    const bankRoll = this.air ? 0 : S2.bank * cosA;
    this.roll += (bankRoll - this.roll) * Math.min(1, dt * 8);
    this.pitch += (along * cosA - this.pitch) * Math.min(1, dt * 10);

    const lim = T.halfW + VERGE - KART_R;
    if (Math.abs(L2.lat) > lim) {
      const side = Math.sign(L2.lat);
      this.p.addScaledVector(S2.R, -side * (Math.abs(L2.lat) - lim));
      // how much the kart points into the barrier (0 = sliding along it, 1 = head-on)
      const into = Math.max(0, (f2.x * S2.R.x + f2.z * S2.R.z) * side * Math.sign(this.speed || 1));
      if (!this.wallContact) {
        // the impact costs speed in proportion to the angle; grazing is almost free
        const loss = Math.min(0.6, into * 1.1);
        this.speed *= 1 - loss;
        ev.wall = Math.max(ev.wall, Math.min(1, (into * Math.abs(this.speed)) / 12 + 0.1));
      } else this.speed *= Math.exp(-dt * 0.6);
      this.vlat = -side * Math.min(3, 1 + into * 3);
      // turn the nose along the barrier
      let d = S2.yaw - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) < Math.PI / 2) this.yaw += d * Math.min(1, dt * 10);
      this.drifting = false;
      this.wallContact = true;
    } else this.wallContact = false;
  }

  spinOut(seconds = 1.2) {
    if (this.novaT > 0) return false;
    this.spinT = seconds;
    this.speed *= 0.45;
    this.drifting = false;
    this.boostT = 0;
    return true;
  }
}

/** Something a kart can bump into: another kart (local or remote). */
export interface Bumpable {
  p: THREE.Vector3;
  speed: number;
  novaT: number;
  /** only local karts get pushed */
  movable: boolean;
}

/** Pushes overlapping karts apart (nova karts knock the others into a spin). */
export function collideKarts(karts: Bumpable[], onBump: (a: number, b: number, strength: number) => void) {
  for (let a = 0; a < karts.length; a++) {
    for (let b = a + 1; b < karts.length; b++) {
      const A = karts[a],
        B = karts[b];
      if (!A.movable && !B.movable) continue;
      const dx = B.p.x - A.p.x,
        dz = B.p.z - A.p.z;
      const d2 = dx * dx + dz * dz;
      const min = KART_R * 2;
      if (d2 >= min * min || d2 < 1e-6 || Math.abs(A.p.y - B.p.y) > 1.6) continue;
      const d = Math.sqrt(d2);
      const both = A.movable && B.movable;
      const push = (min - d) / (both ? 2 : 1);
      const nx = dx / d,
        nz = dz / d;
      if (A.movable) {
        A.p.x -= nx * push;
        A.p.z -= nz * push;
      }
      if (B.movable) {
        B.p.x += nx * push;
        B.p.z += nz * push;
      }
      // trade a little speed: the faster kart slows, the slower one gets nudged
      const dv = (A.speed - B.speed) * 0.2;
      if (A.movable) A.speed -= dv;
      if (B.movable) B.speed += dv;
      onBump(a, b, Math.min(1, Math.abs(dv) / 4 + 0.2));
    }
  }
}

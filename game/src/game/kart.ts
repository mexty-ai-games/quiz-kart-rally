/**
 * Arcade kart physics: auto-throttle friendly, forgiving grip, drift with mini-turbos,
 * turbo/nova/spin-out states, grass slow-down and a soft barrier. The ground height comes
 * from the track samples, so karts follow hills without a physics engine.
 */
import * as THREE from "three";
import { BuiltTrack, Located, VERGE, locate } from "./track";

export interface KartInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 left .. 1 right
  drift: boolean;
}

export const VMAX = 25; // m/s ≈ 90 km/h (feels fast at kart scale)
export const VMAX_BOOST = 35;
export const VMAX_NOVA = 31;
export const VMAX_GRASS = 11;
export const KART_R = 1.15; // collision radius
export const COIN_MAX = 10;

export type MiniTurbo = 0 | 1 | 2;

export interface KartEvents {
  wall: number;
  miniTurbo: MiniTurbo;
  driftStart: boolean;
}

export const newKartEvents = (): KartEvents => ({ wall: 0, miniTurbo: 0, driftStart: false });

export class Kart {
  p = new THREE.Vector3();
  yaw = 0;
  speed = 0;
  vlat = 0;
  steerSm = 0;
  idx = 0;
  lat = 0;
  onGrass = false;
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
  /** visual: extra yaw while spinning out, body hop while drifting */
  spinYaw = 0;
  hop = 0;
  wheelSpin = 0;
  wallContact = false;
  /** race progress */
  lap = 0;
  s = 0;
  halfway = false;
  finished = false;
  finishMs = 0;
  loc: Located = { i: 0, lat: 0, along: 0, y: 0 };
  /** speed multiplier (AI difficulty / rubber band) */
  power = 1;

  constructor(public track: BuiltTrack, public id: number) {}

  reset(s: number, lat: number) {
    const T = this.track;
    const N = T.samples.length;
    const i = Math.round(((s % T.length) + T.length) % T.length / (T.length / N)) % N;
    const S = T.samples[i];
    this.p.copy(S.p).addScaledVector(S.R, lat);
    this.yaw = S.yaw;
    this.speed = 0;
    this.vlat = 0;
    this.steerSm = 0;
    this.idx = i;
    this.boostT = this.spinT = this.shieldT = this.novaT = 0;
    this.coins = 0;
    this.drifting = false;
    this.driftT = 0;
    this.spinYaw = 0;
    this.hop = 0;
    this.lap = 0;
    this.halfway = false;
    this.finished = false;
    this.finishMs = 0;
    this.s = S.s;
    this.lat = lat;
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
    const coinBonus = (Math.min(COIN_MAX, this.coins) / COIN_MAX) * 2.2;
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
    this.onGrass = Math.abs(L.lat) > T.halfW + 0.6;

    for (const k of ["boostT", "shieldT", "novaT"] as const) if (this[k] > 0) this[k] = Math.max(0, this[k] - dt);
    if (this.spinT > 0) {
      this.spinT = Math.max(0, this.spinT - dt);
      this.spinYaw += dt * 11 * Math.min(1, this.spinT + 0.3);
      if (this.spinT === 0) this.spinYaw = 0;
    }

    // steering: quick but smooth; less authority while spinning
    const target = THREE.MathUtils.clamp(inp.steer, -1, 1) * (this.spinT > 0 ? 0.2 : 1);
    this.steerSm += THREE.MathUtils.clamp(target - this.steerSm, -7 * dt, 7 * dt);

    // drift: hold the drift button while steering at speed; release for a mini-turbo
    const canDrift = this.speed > 11 && this.spinT <= 0 && !this.onGrass;
    if (!this.drifting && inp.drift && canDrift && Math.abs(this.steerSm) > 0.35) {
      this.drifting = true;
      this.driftDir = Math.sign(this.steerSm);
      this.driftT = 0;
      this.hop = 0.35;
      ev.driftStart = true;
    }
    if (this.drifting) {
      this.driftT += dt * (0.6 + 0.6 * Math.abs(this.steerSm + this.driftDir) / 2);
      if (!inp.drift || !canDrift) {
        this.drifting = false;
        if (canDrift || this.speed > 8) {
          if (this.driftT > 1.7) ev.miniTurbo = 2;
          else if (this.driftT > 0.8) ev.miniTurbo = 1;
          if (ev.miniTurbo) this.boostT = Math.max(this.boostT, ev.miniTurbo === 2 ? 1.1 : 0.6);
        }
        this.driftT = 0;
      }
    }
    this.hop = Math.max(0, this.hop - dt * 2.2);

    // yaw rate: tighter at low speed, drifts turn harder in the drift direction
    const sp = Math.max(0, this.speed);
    let turn = THREE.MathUtils.lerp(2.3, 1.35, Math.min(1, sp / VMAX)) * Math.min(1, sp / 4);
    let steer = this.steerSm;
    if (this.drifting) steer = this.driftDir * (0.75 + 0.45 * this.steerSm * this.driftDir);
    if (this.drifting) turn *= 1.25;
    this.yaw -= steer * turn * dt * (this.speed < 0 ? -1 : 1);

    // longitudinal
    const vmax = this.vmax();
    let acc = 0;
    if (inp.throttle > 0.05 && this.speed < vmax) acc += inp.throttle * (11 * (1 - this.speed / vmax) + 3.5) + (this.boostT > 0 ? 18 : 0);
    if (this.speed > vmax) acc -= (this.speed - vmax) * (this.onGrass ? 3.2 : 1.4);
    if (inp.brake > 0.05) acc -= this.speed > 0.5 ? 22 * inp.brake : 7 * inp.brake;
    if (inp.throttle < 0.05 && inp.brake < 0.05) acc -= Math.sign(this.speed) * 3;
    acc -= 9.8 * T.samples[L.i].slope * 0.6;
    if (this.drifting) acc -= 1.5;
    this.speed = Math.max(-8, this.speed + acc * dt);

    // lateral slide (drift lets the kart slide, grip pulls it back)
    if (this.drifting) this.vlat += -this.driftDir * sp * 0.55 * dt;
    this.vlat *= Math.exp(-dt * (this.drifting ? 2.2 : 7));

    const f = this.forward;
    const r = new THREE.Vector3(-f.z, 0, f.x);
    this.p.addScaledVector(f, this.speed * dt).addScaledVector(r, this.vlat * dt);
    this.wheelSpin += (this.speed * dt) / 0.32;

    // ground height + barrier
    const L2 = locate(T, this.p, this.idx, this.loc);
    const S2 = T.samples[L2.i];
    this.p.y = L2.y;
    const lim = T.halfW + VERGE - KART_R;
    if (Math.abs(L2.lat) > lim) {
      const side = Math.sign(L2.lat);
      this.p.addScaledVector(S2.R, -side * (Math.abs(L2.lat) - lim));
      // how much the kart points into the barrier (0 = sliding along it, 1 = head-on)
      const f2 = this.forward;
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

/** Pushes overlapping karts apart (nova karts knock the others into a spin). */
export function collideKarts(karts: Kart[], onBump: (a: Kart, b: Kart, strength: number) => void) {
  for (let a = 0; a < karts.length; a++) {
    for (let b = a + 1; b < karts.length; b++) {
      const A = karts[a],
        B = karts[b];
      const dx = B.p.x - A.p.x,
        dz = B.p.z - A.p.z;
      const d2 = dx * dx + dz * dz;
      const min = KART_R * 2;
      if (d2 >= min * min || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const push = (min - d) / 2;
      const nx = dx / d,
        nz = dz / d;
      A.p.x -= nx * push;
      A.p.z -= nz * push;
      B.p.x += nx * push;
      B.p.z += nz * push;
      // trade a little speed: the faster kart slows, the slower one gets nudged
      const dv = (A.speed - B.speed) * 0.2;
      A.speed -= dv;
      B.speed += dv;
      onBump(A, B, Math.min(1, Math.abs(dv) / 4 + 0.2));
    }
  }
}

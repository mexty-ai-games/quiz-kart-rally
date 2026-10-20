/**
 * Closed-circuit track: the cup's control points become a smooth loop, sampled every metre
 * (position + frame + curvature + banking per sample). Physics, AI, meshes and race logic all read it.
 * s = 0 is the start/finish line at the first control point; karts drive towards increasing s.
 *
 * Road surface: the cross-section is tilted by the bank angle around the centre line (corners lean
 * inwards like a velodrome) and jump ramps add their own profile in the middle of the road.
 */
import * as THREE from "three";
import type { Cup } from "./types";

export const DS = 1;
/** Grass verge between the kerb and the barrier (m). */
export const VERGE = 5;
/** Jump ramp: length (m), height at the lip (m), half width (m). */
export const RAMP_LEN = 7;
export const RAMP_H = 1.6;
export const RAMP_HW = 4.5;

export interface Sample {
  p: THREE.Vector3;
  T: THREE.Vector3; // forward (unit, may slope)
  R: THREE.Vector3; // right (horizontal unit)
  s: number;
  yaw: number; // heading: forward = (-sin yaw, 0, -cos yaw)
  curv: number; // signed curvature (1/m), + turning left
  slope: number; // dy/ds
  bank: number; // radians, + = right side higher (left turn)
}

export interface Row {
  index: number; // row number within a lap
  s: number;
  i: number;
  lanes: number[];
}

export interface Ramp {
  /** s of the lip (end of the ramp) */
  s: number;
  lat: number;
}

export interface BuiltTrack {
  samples: Sample[];
  length: number;
  step: number;
  halfW: number;
  rows: Row[];
  boosts: { s: number; lat: number }[];
  ramps: Ramp[];
  coinLines: { s: number; lat: number }[];
  bounds: THREE.Box3;
  /** Track outline for the mini-map (x, z), one point every ~6 m. */
  outline: [number, number][];
}

const wrapS = (s: number, L: number) => ((s % L) + L) % L;

export function buildTrack(cup: Cup): BuiltTrack {
  const pts = (cup.points ?? []).map((p) => new THREE.Vector3(p.x, p.y ?? 0, p.z));
  if (pts.length < 4) {
    // a safe fallback oval so the game never breaks on bad props
    pts.length = 0;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.sin(a) * 120, 0, Math.cos(a) * 70));
    }
  }
  const curve = new THREE.CatmullRomCurve3(pts, true, "centripetal");
  const approx = curve.getLength();
  const n = Math.max(200, Math.round(approx / DS));
  const raw = curve.getSpacedPoints(n);
  raw.pop(); // closed: last == first
  const step = approx / raw.length;
  const L = raw.length * step;
  const halfW = Math.max(6, Math.min(12, (cup.width ?? 16) / 2));
  const samples: Sample[] = raw.map((p, i) => ({
    p: p.clone(),
    T: new THREE.Vector3(),
    R: new THREE.Vector3(),
    s: i * step,
    yaw: 0,
    curv: 0,
    slope: 0,
    bank: 0,
  }));
  const N = samples.length;
  const tmp = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const a = samples[(i - 1 + N) % N].p;
    const b = samples[(i + 1) % N].p;
    const sm = samples[i];
    sm.T.copy(tmp.subVectors(b, a)).normalize();
    const hz = Math.hypot(sm.T.x, sm.T.z) || 1;
    sm.R.set(-sm.T.z / hz, 0, sm.T.x / hz);
    sm.yaw = Math.atan2(-sm.T.x, -sm.T.z);
    sm.slope = sm.T.y / hz;
  }
  // curvature from the heading change over ±4 m, smoothed
  const raw2: number[] = [];
  for (let i = 0; i < N; i++) {
    let d = samples[(i + 4) % N].yaw - samples[(i - 4 + N) % N].yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    raw2.push(d / (8 * step));
  }
  for (let i = 0; i < N; i++) {
    let acc = 0;
    for (let k = -3; k <= 3; k++) acc += raw2[(i + k + N) % N];
    samples[i].curv = acc / 7;
  }
  // banking: proportional to curvature, capped, smoothed over ±18 m so it eases in and out
  const maxBank = THREE.MathUtils.degToRad(Math.max(0, Math.min(16, cup.bank ?? 9)));
  const b0 = samples.map((sm) => THREE.MathUtils.clamp(sm.curv * 22, -1, 1) * maxBank);
  const W = Math.round(18 / step);
  for (let i = 0; i < N; i++) {
    let acc = 0;
    let wsum = 0;
    for (let k = -W; k <= W; k++) {
      const w = 1 - Math.abs(k) / (W + 1);
      acc += b0[(i + k + N) % N] * w;
      wsum += w;
    }
    samples[i].bank = acc / wsum;
  }

  const idxAt = (s: number) => Math.round(wrapS(s, L) / step) % N;
  const lift = () => {
    // banked sections rise so their low (inner) edge stays at ground level, then the slopes are refreshed
    for (let i = 0; i < N; i++) samples[i].p.y = pts0[i] + Math.abs(Math.sin(samples[i].bank)) * (halfW + VERGE + 0.9);
    for (let i = 0; i < N; i++) {
      const a = samples[(i - 1 + N) % N].p;
      const b = samples[(i + 1) % N].p;
      const sm = samples[i];
      sm.T.copy(tmp.subVectors(b, a)).normalize();
      sm.slope = sm.T.y / (Math.hypot(sm.T.x, sm.T.z) || 1);
    }
  };
  const pts0 = samples.map((sm) => sm.p.y);
  const rowFr = cup.rows && cup.rows.length ? cup.rows : [0.3, 0.62, 0.86];
  const rows: Row[] = rowFr.map((f, k) => {
    const s = wrapS(f, 1) * L;
    return { index: k, s, i: idxAt(s), lanes: [] };
  });
  const boosts = (cup.boosts ?? []).map((b, k) => ({ s: wrapS(b, 1) * L, lat: (k % 2 ? 1 : -1) * halfW * 0.35 }));
  const ramps: Ramp[] = (cup.jumps ?? []).map((f) => ({ s: wrapS(f, 1) * L, lat: 0 }));
  // flatten the bank around ramps so jumps are straight
  ramps.forEach((r) => {
    for (let k = -40; k <= 25; k++) {
      const sm = samples[(idxAt(r.s) + k + N) % N];
      const w = Math.min(1, Math.abs(k) / (k < 0 ? 40 : 25));
      sm.bank *= w * w;
    }
  });
  lift();
  // a short line of coins halfway between consecutive rows (and after the start)
  const coinLines: { s: number; lat: number }[] = [];
  const stops = [0].concat(rows.map((r) => r.s)).sort((a, b) => a - b);
  for (let k = 0; k < stops.length; k++) {
    const a = stops[k];
    const b = k + 1 < stops.length ? stops[k + 1] : stops[0] + L;
    let mid = a + (b - a) * 0.5;
    // keep coins off ramps
    ramps.forEach((r) => {
      const d = wrapS(mid - r.s + L / 2, L) - L / 2;
      if (d > -RAMP_LEN - 26 && d < 26) mid += 40;
    });
    const lat = ((k % 3) - 1) * halfW * 0.45;
    for (let c = 0; c < 6; c++) coinLines.push({ s: wrapS(mid + c * 4, L), lat });
  }
  const bounds = new THREE.Box3();
  samples.forEach((sm) => bounds.expandByPoint(sm.p));
  const outline: [number, number][] = [];
  for (let i = 0; i < N; i += 6) outline.push([samples[i].p.x, samples[i].p.z]);
  return { samples, length: L, step, halfW, rows, boosts, ramps, coinLines, bounds, outline };
}

export interface Located {
  i: number;
  lat: number;
  along: number;
  /** road surface height under the point (banking + ramps included) */
  y: number;
  /** ramp height under the point (0 off ramps) and the ramp's slope there */
  ramp: number;
  rampSlope: number;
}

/** Height of the ramp profile at distance d before the lip (d in [0, RAMP_LEN]), else 0. */
export function rampProfile(track: BuiltTrack, s: number, lat: number): { h: number; slope: number } {
  for (let k = 0; k < track.ramps.length; k++) {
    const r = track.ramps[k];
    let d = r.s - s; // > 0 before the lip
    const L = track.length;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    if (d >= 0 && d <= RAMP_LEN && Math.abs(lat - r.lat) <= RAMP_HW) {
      const u = 1 - d / RAMP_LEN; // 0 at the foot, 1 at the lip (a straight slope, like the ramp model)
      return { h: RAMP_H * u, slope: RAMP_H / RAMP_LEN };
    }
  }
  return { h: 0, slope: 0 };
}

const _d = new THREE.Vector3();
/** Nearest sample to p, searched around a hint index (global search when far). */
export function locate(track: BuiltTrack, p: THREE.Vector3, hint: number, out: Located): Located {
  const S = track.samples;
  const N = S.length;
  let best = hint,
    bd = Infinity;
  for (let k = -30; k <= 30; k++) {
    const i = (hint + k + N) % N;
    const dx = S[i].p.x - p.x,
      dz = S[i].p.z - p.z;
    const d = dx * dx + dz * dz;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  if (bd > 30 * 30) {
    for (let i = 0; i < N; i += 2) {
      const dx = S[i].p.x - p.x,
        dz = S[i].p.z - p.z;
      const d = dx * dx + dz * dz;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
  }
  const sm = S[best];
  _d.subVectors(p, sm.p);
  out.i = best;
  out.lat = _d.x * sm.R.x + _d.z * sm.R.z;
  const hz = Math.hypot(sm.T.x, sm.T.z) || 1;
  out.along = (_d.x * sm.T.x + _d.z * sm.T.z) / hz;
  const latC = THREE.MathUtils.clamp(out.lat, -(track.halfW + VERGE), track.halfW + VERGE);
  const rp = rampProfile(track, sm.s + out.along, out.lat);
  out.ramp = rp.h;
  out.rampSlope = rp.slope;
  out.y = sm.p.y + out.along * sm.slope + Math.sin(sm.bank) * latC + rp.h;
  return out;
}

/** Signed distance along the track from a to b in (-L/2, L/2]. */
export function deltaS(a: number, b: number, L: number) {
  let d = b - a;
  while (d > L / 2) d -= L;
  while (d <= -L / 2) d += L;
  return d;
}

export function sampleAt(track: BuiltTrack, s: number): Sample {
  const N = track.samples.length;
  return track.samples[Math.round(wrapS(s, track.length) / track.step) % N];
}

/** Point on the road surface at distance s and lateral offset lat (banking included). */
export function pointAt(track: BuiltTrack, s: number, lat: number, out = new THREE.Vector3()) {
  const sm = sampleAt(track, s);
  return out.copy(sm.p).addScaledVector(sm.R, lat * Math.cos(sm.bank)).setY(sm.p.y + Math.sin(sm.bank) * lat);
}

/** Point of the tilted cross-section: lat across the road, h up from its surface. */
export function sectionPoint(sm: Sample, lat: number, h: number, out: THREE.Vector3) {
  const cb = Math.cos(sm.bank),
    sb = Math.sin(sm.bank);
  // R' = R cos b + Up sin b ; N' = Up cos b - R sin b
  out.copy(sm.p);
  out.x += sm.R.x * (lat * cb - h * sb);
  out.z += sm.R.z * (lat * cb - h * sb);
  out.y += lat * sb + h * cb;
  return out;
}

export { wrapS };

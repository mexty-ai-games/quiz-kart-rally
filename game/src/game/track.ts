/**
 * Closed-circuit track: the cup's control points become a smooth loop, sampled every metre
 * (position + frame + curvature per sample). Physics, AI, mesh and race logic all read it.
 * s = 0 is the start/finish line at the first control point; karts drive towards increasing s.
 */
import * as THREE from "three";
import type { Cup } from "./types";

export const DS = 1;
/** Grass verge between the kerb and the barrier (m). */
export const VERGE = 5;

export interface Sample {
  p: THREE.Vector3;
  T: THREE.Vector3; // forward (unit, may slope)
  R: THREE.Vector3; // right (horizontal unit)
  s: number;
  yaw: number; // heading: forward = (-sin yaw, 0, -cos yaw)
  curv: number; // signed curvature (1/m), + turning left
  slope: number; // dy/ds
}

export interface Row {
  index: number; // row number within a lap
  s: number;
  i: number;
  lanes: number[]; // lateral centre of each lane, left → right (filled per question)
}

export interface BuiltTrack {
  samples: Sample[];
  length: number;
  halfW: number;
  rows: Row[];
  boosts: { s: number; lat: number }[];
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
  const L = raw.length * DS * (approx / n / DS);
  const step = approx / raw.length;
  const halfW = Math.max(6, Math.min(12, (cup.width ?? 16) / 2));
  const samples: Sample[] = raw.map((p, i) => ({
    p: p.clone(),
    T: new THREE.Vector3(),
    R: new THREE.Vector3(),
    s: i * step,
    yaw: 0,
    curv: 0,
    slope: 0,
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

  const idxAt = (s: number) => Math.round(wrapS(s, L) / step) % N;
  const rowFr = cup.rows && cup.rows.length ? cup.rows : [0.3, 0.62, 0.86];
  const rows: Row[] = rowFr.map((f, k) => {
    const s = wrapS(f, 1) * L;
    return { index: k, s, i: idxAt(s), lanes: [] };
  });
  const boosts = (cup.boosts ?? []).map((b, k) => ({ s: wrapS(b, 1) * L, lat: (k % 2 ? 1 : -1) * halfW * 0.35 }));
  // a short line of coins halfway between consecutive rows (and after the start)
  const coinLines: { s: number; lat: number }[] = [];
  const stops = [0].concat(rows.map((r) => r.s)).sort((a, b) => a - b);
  for (let k = 0; k < stops.length; k++) {
    const a = stops[k];
    const b = k + 1 < stops.length ? stops[k + 1] : stops[0] + L;
    const mid = a + (b - a) * 0.5;
    const lat = ((k % 3) - 1) * halfW * 0.45;
    for (let c = 0; c < 6; c++) coinLines.push({ s: wrapS(mid + c * 4, L), lat });
  }
  const bounds = new THREE.Box3();
  samples.forEach((sm) => bounds.expandByPoint(sm.p));
  const outline: [number, number][] = [];
  for (let i = 0; i < N; i += 6) outline.push([samples[i].p.x, samples[i].p.z]);
  return { samples, length: L, halfW, rows, boosts, coinLines, bounds, outline };
}

export interface Located {
  i: number;
  lat: number;
  along: number;
  y: number; // road height under the point
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
  out.y = sm.p.y + out.along * sm.slope;
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
  const step = track.length / N;
  return track.samples[Math.round(wrapS(s, track.length) / step) % N];
}

/** Point on the track at distance s and lateral offset lat. */
export function pointAt(track: BuiltTrack, s: number, lat: number, out = new THREE.Vector3()) {
  const sm = sampleAt(track, s);
  return out.copy(sm.p).addScaledVector(sm.R, lat);
}

export { wrapS };

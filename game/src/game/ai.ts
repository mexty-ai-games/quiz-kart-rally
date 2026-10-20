/**
 * Rival drivers: follow the track with a personal racing line, slow for corners, pick an answer
 * box before each row (right with a skill-dependent chance) and use their bonuses.
 * A gentle rubber band keeps the pack close to the player so every race stays lively.
 */
import * as THREE from "three";
import { BuiltTrack, deltaS } from "./track";
import { Kart, KartInput, VMAX } from "./kart";

export interface AiTarget {
  /** lateral offset to aim for while approaching a row (the chosen answer's lane) */
  lat: number;
  /** distance along the track of the row being aimed at */
  s: number;
}

export class Driver {
  lineOff: number;
  wobbleT = Math.random() * 10;
  target: AiTarget | null = null;
  useItemIn = -1;

  constructor(public kart: Kart, public skill: number) {
    this.lineOff = (Math.random() * 2 - 1) * 0.35;
  }

  /** Chance to choose the right answer (0..1). */
  accuracy() {
    return 0.45 + this.skill * 0.35;
  }

  drive(track: BuiltTrack, dt: number, playerProgress: number): KartInput {
    const k = this.kart;
    const S = track.samples;
    const N = S.length;
    this.wobbleT += dt;
    // rubber band: a little faster when behind the player, a little slower when far ahead
    const gap = k.progress() - playerProgress;
    const band = THREE.MathUtils.clamp(-gap / 160, -0.12, 0.12);
    k.power = (0.86 + this.skill * 0.1) * (1 + band);

    const sp = Math.max(6, k.speed);
    const look = Math.round(6 + sp * 0.5);
    const j = (k.idx + look) % N;
    let lat = track.halfW * (this.lineOff + 0.08 * Math.sin(this.wobbleT * 0.45 + k.id));
    // aim at the chosen answer when a row is near
    if (this.target) {
      const d = deltaS(k.s, this.target.s, track.length);
      if (d > -2 && d < 55) lat = this.target.lat;
      else if (d <= -2) this.target = null;
    }
    const tgt = S[j].p.clone().addScaledVector(S[j].R, lat);
    const want = Math.atan2(-(tgt.x - k.p.x), -(tgt.z - k.p.z));
    let dy = want - k.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const steer = THREE.MathUtils.clamp(-dy * 2.4, -1, 1);

    // corner speed from the curvature ahead
    let vt = VMAX * 1.5;
    for (let a = 4; a < 70; a += 6) {
      const c = Math.abs(S[(k.idx + a) % N].curv);
      if (c > 1e-4) {
        const v = Math.sqrt(15 / c);
        vt = Math.min(vt, Math.sqrt(v * v + 2 * 18 * a));
      }
    }
    const brake = k.speed > vt + 1.5 ? 1 : 0;
    return { throttle: brake ? 0 : 1, brake, steer, drift: false };
  }
}

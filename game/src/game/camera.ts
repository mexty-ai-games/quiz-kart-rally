/**
 * Camera rig. Modes:
 *  chase   spring-arm behind the kart; looks into corners, rises on jumps, widens on boosts, shakes on hits
 *  intro   flyover from high above the start straight down to behind the kart (before the countdown)
 *  orbit   slow orbit around a kart (menus, racer select, after the finish)
 *  podium  framing of the winners' podium
 */
import * as THREE from "three";
import type { Kart } from "./kart";
import { BuiltTrack, sampleAt, VERGE } from "./track";
import { VMAX } from "./kart";

export type CamMode = "chase" | "intro" | "orbit" | "podium";

export class CameraRig {
  mode: CamMode = "orbit";
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private yaw = 0;
  private shakeA = 0;
  private t = 0;
  private introT = 0;
  private introDur = 3.6;
  private introPath: THREE.CatmullRomCurve3 | null = null;
  private introLook: THREE.CatmullRomCurve3 | null = null;
  private podiumPos = new THREE.Vector3();
  private podiumLook = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private orbitT = 0;
  baseFov = 62;

  constructor(public camera: THREE.PerspectiveCamera) {}

  setAspect(aspect: number) {
    this.camera.aspect = aspect;
    this.baseFov = aspect < 1 ? 78 : aspect < 1.4 ? 68 : 62;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
  }

  shake(a: number) {
    this.shakeA = Math.min(1.2, Math.max(this.shakeA, a));
  }

  /** Place the camera behind a kart at once. */
  snap(k: Kart) {
    const f = k.forward;
    this.yaw = k.yaw;
    this.pos.copy(k.p).addScaledVector(f, -7.4).setY(k.p.y + 3.7);
    this.look.copy(k.p).addScaledVector(f, 9).setY(k.p.y + 1.0);
    this.apply();
  }

  /** Flyover from above the start area down to the chase position behind `k`. */
  startIntro(track: BuiltTrack, k: Kart, dur: number) {
    this.mode = "intro";
    this.introT = 0;
    this.introDur = dur;
    const L = track.length;
    const ahead = sampleAt(track, k.s + 95);
    const over = sampleAt(track, k.s + 40);
    const f = k.forward;
    const side = new THREE.Vector3(-f.z, 0, f.x);
    // high in front of the start, over the middle of the arch, then down behind the kart
    const p0 = ahead.p.clone().addScaledVector(ahead.R, track.halfW + VERGE + 30).setY(ahead.p.y + 38);
    const p1 = over.p.clone().setY(over.p.y + 25);
    const p2 = k.p.clone().addScaledVector(f, -16).addScaledVector(side, 5).setY(k.p.y + 8);
    const p3 = k.p.clone().addScaledVector(f, -7.4).setY(k.p.y + 3.7);
    this.introPath = new THREE.CatmullRomCurve3([p0, p1, p2, p3], false, "centripetal");
    const arch = sampleAt(track, 0).p.clone().setY(sampleAt(track, 0).p.y + 5);
    this.introLook = new THREE.CatmullRomCurve3([arch.clone(), arch.clone().setY(arch.y - 3), k.p.clone().setY(k.p.y + 1.2), k.p.clone().addScaledVector(f, 9).setY(k.p.y + 1)], false);
    void L;
  }
  get introDone() {
    return this.mode !== "intro" || this.introT >= this.introDur;
  }

  setPodium(pos: THREE.Vector3, look: THREE.Vector3) {
    this.mode = "podium";
    this.podiumPos.copy(pos);
    this.podiumLook.copy(look);
    // a cut, like the TV coverage of a podium
    this.pos.copy(pos);
    this.look.copy(look);
    this.camera.fov = this.baseFov - 8;
    this.camera.updateProjectionMatrix();
    this.apply();
  }

  update(dt: number, k: Kart | null) {
    this.t += dt;
    const cam = this.camera;
    if (this.mode === "intro" && this.introPath && this.introLook) {
      this.introT += dt;
      const u = Math.min(1, this.introT / this.introDur);
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      this.introPath.getPoint(e, this.pos);
      this.introLook.getPoint(e, this.look);
      if (u >= 1 && k) {
        this.mode = "chase";
        this.yaw = k.yaw;
      }
      this.fov(this.baseFov + 6 * (1 - e), dt, 6);
    } else if (this.mode === "podium") {
      this.orbitT += dt * 0.25;
      const sway = this.tmp.set(Math.sin(this.orbitT) * 2.5, Math.sin(this.orbitT * 0.7) * 0.6, 0);
      this.pos.lerp(this.tmp2.copy(this.podiumPos).add(sway), 1 - Math.exp(-dt * 2));
      this.look.lerp(this.podiumLook, 1 - Math.exp(-dt * 3));
      this.fov(this.baseFov - 8, dt, 3);
    } else if (k && this.mode === "orbit") {
      this.orbitT += dt * 0.32;
      const a = k.yaw + Math.PI * 0.75 + Math.sin(this.orbitT) * 0.9;
      // a wider shot with the kart low in the frame, so the menus above it leave the kart visible
      const want = this.tmp.set(k.p.x + Math.sin(a) * 10.5, k.p.y + 5.2, k.p.z + Math.cos(a) * 10.5);
      this.pos.lerp(want, 1 - Math.exp(-dt * 2.5));
      this.look.lerp(this.tmp2.copy(k.p).setY(k.p.y + 2.6), 1 - Math.exp(-dt * 6));
      this.fov(this.baseFov, dt, 3);
    } else if (k) {
      // chase: follow the travel direction, not the spin
      let d = k.yaw - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * (1 - Math.exp(-dt * (k.drifting ? 3.6 : 5.2)));
      const f = this.tmp2.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const sp = Math.max(0, k.speed) / VMAX;
      const boost = k.boostT > 0 ? 1 : 0;
      const back = 7.0 + sp * 1.3 + boost * 1.1;
      const want = this.tmp.copy(k.p).addScaledVector(f, -back);
      const ground = k.air ? k.loc.y : k.p.y;
      want.y = Math.max(ground, k.p.y - (k.air ? 1.2 : 0)) + 3.5 + sp * 0.35 + (k.air ? 0.8 : 0);
      this.pos.lerp(want, 1 - Math.exp(-dt * 9));
      // look a little into the corner (drift) and ahead with speed
      const lookAhead = 8 + sp * 4;
      const look = this.tmp.copy(k.p).addScaledVector(f, lookAhead);
      look.x += -f.z * k.steerSm * 1.6;
      look.z += f.x * k.steerSm * 1.6;
      look.y = k.p.y + 1.1;
      this.look.lerp(look, 1 - Math.exp(-dt * 12));
      this.fov(this.baseFov + sp * 6 + boost * 9, dt, 4);
    }
    this.apply();
    // shake (impacts, landings)
    if (this.shakeA > 0.001) {
      const a = this.shakeA * 0.18;
      cam.position.x += (Math.sin(this.t * 61) + Math.sin(this.t * 37)) * a;
      cam.position.y += Math.sin(this.t * 53) * a;
      cam.rotation.z += Math.sin(this.t * 47) * a * 0.04;
      this.shakeA *= Math.exp(-dt * 7);
    }
  }

  private fov(target: number, dt: number, rate: number) {
    this.camera.fov += (target - this.camera.fov) * (1 - Math.exp(-dt * rate));
    this.camera.updateProjectionMatrix();
  }

  private apply() {
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}

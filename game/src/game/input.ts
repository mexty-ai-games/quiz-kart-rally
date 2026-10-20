/** Keyboard, gamepad and on-screen touch controls merged into one input state. */
import type { KartInput } from "./kart";

export type Action = "pause" | "bonus" | "look";

export class Input {
  keys: { [k: string]: boolean } = {};
  touch = { left: false, right: false, brake: false, drift: false, steer: 0 };
  autoGas = true;
  onAction: (a: Action) => void = () => {};
  private padPrev: boolean[] = [];

  private down = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].indexOf(k) >= 0) e.preventDefault();
    if (e.repeat) return;
    this.keys[k] = true;
    if (k === "escape" || k === "p") this.onAction("pause");
    if (k === " " || k === "e" || k === "enter" || k === "x") this.onAction("bonus");
  };
  private up = (e: KeyboardEvent) => {
    this.keys[e.key.toLowerCase()] = false;
  };
  private blur = () => {
    this.keys = {};
  };

  attach() {
    window.addEventListener("keydown", this.down);
    window.addEventListener("keyup", this.up);
    window.addEventListener("blur", this.blur);
  }
  detach() {
    window.removeEventListener("keydown", this.down);
    window.removeEventListener("keyup", this.up);
    window.removeEventListener("blur", this.blur);
  }

  read(): KartInput {
    const k = this.keys;
    const brake = k["arrowdown"] || k["s"] || this.touch.brake ? 1 : 0;
    let throttle = this.autoGas || k["arrowup"] || k["w"] || k["z"] ? 1 : 0;
    if (brake) throttle = 0;
    let steer = 0;
    if (k["arrowleft"] || k["a"] || k["q"] || this.touch.left) steer -= 1;
    if (k["arrowright"] || k["d"] || this.touch.right) steer += 1;
    if (this.touch.steer) steer = this.touch.steer;
    let drift = !!(k["shift"] || k["c"] || this.touch.drift);
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p) continue;
      const ax = p.axes[0] || 0;
      if (Math.abs(ax) > 0.15) steer = Math.max(-1, Math.min(1, ax));
      const b = p.buttons.map((x) => x.pressed);
      if (b[6] || b[1]) throttle = 0;
      if (b[5] || b[7] || b[4]) drift = true;
      if (b[0] && !this.padPrev[0]) this.onAction("bonus");
      if (b[9] && !this.padPrev[9]) this.onAction("pause");
      this.padPrev = b;
      break;
    }
    return { throttle, brake, steer, drift };
  }
}

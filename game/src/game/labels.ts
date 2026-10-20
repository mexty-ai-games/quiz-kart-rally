/** Canvas-drawn texts in the 3D world: answers above the boxes, the question on the gantry screen. */
import * as THREE from "three";

export const FONT = `"Baloo 2", "Fredoka", "Arial Rounded MT Bold", "Trebuchet MS", "Segoe UI", Arial, sans-serif`;

export function fitFont(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxH: number, weight = "800") {
  let size = Math.floor(maxH);
  ctx.font = `${weight} ${size}px ${FONT}`;
  while (size > 10 && ctx.measureText(text).width > maxW) {
    size -= 3;
    ctx.font = `${weight} ${size}px ${FONT}`;
  }
  return size;
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export interface CanvasTex {
  tex: THREE.CanvasTexture;
  ctx: CanvasRenderingContext2D;
}

export function canvasTexture(w: number, h: number, flipY = true): CanvasTex {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.flipY = flipY;
  return { tex, ctx };
}

export type AnswerState = "idle" | "right" | "wrong" | "dim";

const LANE_COLORS = ["#ff8a1e", "#39c6ff", "#7ee05a", "#ff5fa8"];
export const laneColor = (k: number) => LANE_COLORS[k % LANE_COLORS.length];

/** The answer card floating above a box. */
export function drawAnswer(ctx: CanvasRenderingContext2D, text: string, lane: number, state: AnswerState) {
  const { width: w, height: h } = ctx.canvas;
  ctx.clearRect(0, 0, w, h);
  const edge = state === "right" ? "#3ddc6b" : state === "wrong" ? "#ff5a6a" : laneColor(lane);
  const fill = state === "dim" ? "rgba(30,26,52,0.55)" : state === "right" ? "#0f5a2c" : state === "wrong" ? "#6a1422" : "#241d4a";
  ctx.save();
  // pointer under the card
  ctx.fillStyle = edge;
  ctx.beginPath();
  ctx.moveTo(w / 2 - 26, h - 46);
  ctx.lineTo(w / 2 + 26, h - 46);
  ctx.lineTo(w / 2, h - 6);
  ctx.closePath();
  ctx.fill();
  rounded(ctx, 10, 10, w - 20, h - 58, 40);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 14;
  ctx.strokeStyle = edge;
  ctx.stroke();
  ctx.fillStyle = state === "dim" ? "rgba(255,255,255,0.55)" : "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  fitFont(ctx, text, w * 0.84, (h - 58) * 0.66);
  ctx.fillText(text, w / 2, 10 + (h - 58) / 2 + 4);
  ctx.restore();
}

/** The big screen on the gantry. */
export function drawScreen(ctx: CanvasRenderingContext2D, title: string, prompt: string, accent = "#ff8a1e") {
  const { width: w, height: h } = ctx.canvas;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#2a1f63");
  g.addColorStop(1, "#120c33");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = "#000";
  for (let y = 0; y < h; y += 6) ctx.fillRect(0, y, w, 3);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 16;
  ctx.strokeStyle = accent;
  ctx.strokeRect(8, 8, w - 16, h - 16);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = accent;
  ctx.font = `800 ${Math.round(h * 0.13)}px ${FONT}`;
  if (title) ctx.fillText(title.toUpperCase(), w / 2, h * 0.17);
  ctx.fillStyle = "#fff";
  fitFont(ctx, prompt, w * 0.9, title ? h * 0.5 : h * 0.62);
  ctx.fillText(prompt, w / 2, title ? h * 0.58 : h * 0.52);
}

/** Makes a camera-facing answer card sprite (4 × 2 m). */
export function answerSprite(): { sprite: THREE.Sprite; ct: CanvasTex } {
  const ct = canvasTexture(512, 300);
  const mat = new THREE.SpriteMaterial({ map: ct.tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(4.2, 2.46, 1);
  sprite.renderOrder = 5;
  return { sprite, ct };
}

/** A small name tag over a rival. */
export function nameTag(text: string, color: string): THREE.Sprite {
  const { tex, ctx } = canvasTexture(256, 72);
  rounded(ctx, 6, 8, 244, 56, 26);
  ctx.fillStyle = "rgba(20,16,44,0.72)";
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(34, 36, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  fitFont(ctx, text, 180, 40, "700");
  ctx.fillText(text, 54, 38);
  tex.needsUpdate = true;
  // constant on-screen size: readable far away, never huge right next to the camera
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, sizeAttenuation: false }));
  sp.scale.set(0.11, 0.031, 1);
  sp.renderOrder = 6;
  return sp;
}

/** Tiling road texture: asphalt grain with white edge lines (u across, v along). */
export function roadTexture(): THREE.CanvasTexture {
  const { tex, ctx } = canvasTexture(256, 256);
  const w = 256,
    h = 256;
  ctx.fillStyle = "#4a4660";
  ctx.fillRect(0, 0, w, h);
  for (let k = 0; k < 2600; k++) {
    const v = 60 + Math.random() * 40;
    ctx.fillStyle = `rgba(${v},${v - 4},${v + 18},${0.25 + Math.random() * 0.25})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  ctx.fillStyle = "#f2efff";
  ctx.fillRect(6, 0, 7, h);
  ctx.fillRect(w - 13, 0, 7, h);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.flipY = false;
  return tex;
}

/** Kerb stripes along v (red/white like the Kenney tracks). */
export function kerbTexture(): THREE.CanvasTexture {
  const { tex, ctx } = canvasTexture(16, 64);
  ctx.fillStyle = "#ff5a3c";
  ctx.fillRect(0, 0, 16, 32);
  ctx.fillStyle = "#fff6f0";
  ctx.fillRect(0, 32, 16, 32);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

/** Start line checks. */
export function checkerTexture(): THREE.CanvasTexture {
  const { tex, ctx } = canvasTexture(128, 32);
  for (let x = 0; x < 16; x++)
    for (let y = 0; y < 4; y++) {
      ctx.fillStyle = (x + y) % 2 ? "#ffffff" : "#1c1830";
      ctx.fillRect(x * 8, y * 8, 8, 8);
    }
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

/** Soft grass texture (tiled on the ground). */
export function grassTexture(base: string): THREE.CanvasTexture {
  const { tex, ctx } = canvasTexture(256, 256);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  const c = new THREE.Color(base);
  for (let k = 0; k < 1800; k++) {
    const t = c.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.08);
    ctx.fillStyle = `#${t.getHexString()}`;
    const r = 1 + Math.random() * 3;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, r, r);
  }
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

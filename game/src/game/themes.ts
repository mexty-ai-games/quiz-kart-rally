/** The look of each cup: ground and road colours, backdrop, scenery sets, roadside furniture, sky extras. */
export type ThemeId = "meadow" | "hills" | "desert" | "night";

export interface ScatterSet {
  ids: string[];
  /** grid cell size (m): one candidate per cell */
  cell: number;
  prob: number;
  /** distance from the track centre line (m) */
  min: number;
  max: number;
  scale: [number, number];
  shadows?: boolean;
  /** sway amount in the wind (trees, grass) */
  wind?: number;
  /** keep at least this far from other big pieces */
  clear?: number;
}

export interface Theme {
  ground: string;
  ground2: string;
  verge: string;
  road: string;
  roadGrain: string;
  edge: string;
  kerbA: string;
  kerbB: string;
  barrierA: string;
  barrierB: string;
  /** emissive strip on the barrier top (night) */
  barrierGlow?: string;
  /** glowing road edge lines (night) */
  roadGlow?: string;
  backdrop: { kind: "hills" | "mountains" | "mesas" | "city"; a: string; b: string; snow?: boolean; height: number };
  scatter: ScatterSet[];
  landmarks: { ids: string[]; count: number; min: number; max: number; scale?: [number, number]; animated?: boolean }[];
  roadside: { ids: string[]; every: number; offset: number; both: boolean; scale?: number; lightPool?: string }[];
  arches?: { ids: string[]; every: number };
  clouds: number;
  balloons: number;
  water: number;
  waterColor: string;
  bloom: number;
}

export const THEMES: Record<ThemeId, Theme> = {
  meadow: {
    ground: "#79c25a",
    ground2: "#5fae4c",
    verge: "#8fd06a",
    road: "#55506e",
    roadGrain: "#6b6588",
    edge: "#f6f3ff",
    kerbA: "#ff5a3c",
    kerbB: "#fff6f0",
    barrierA: "#8c78ff",
    barrierB: "#f5f0ff",
    backdrop: { kind: "hills", a: "#5aa858", b: "#9fd0a0", height: 70 },
    scatter: [
      { ids: ["tree_round_a", "tree_round_b", "tree"], cell: 26, prob: 0.55, min: 24, max: 260, scale: [0.8, 1.35], shadows: true, wind: 1, clear: 6 },
      { ids: ["bush_a", "bush_b"], cell: 16, prob: 0.45, min: 17, max: 140, scale: [0.8, 1.4], wind: 0.6 },
      { ids: ["flower_patch"], cell: 18, prob: 0.4, min: 16, max: 120, scale: [0.8, 1.5], wind: 0.4 },
      { ids: ["rock_a", "rock_b"], cell: 40, prob: 0.2, min: 18, max: 200, scale: [0.5, 1.1] },
    ],
    landmarks: [
      { ids: ["windmill"], count: 3, min: 40, max: 160, scale: [1, 1.2], animated: true },
      { ids: ["barn"], count: 2, min: 35, max: 120 },
      { ids: ["cottage"], count: 2, min: 35, max: 140 },
    ],
    roadside: [{ ids: ["fence_segment"], every: 4.2, offset: 2.2, both: false }],
    clouds: 16,
    balloons: 4,
    water: 2,
    waterColor: "#3fb0e8",
    bloom: 0.75,
  },
  hills: {
    ground: "#8fb860",
    ground2: "#6d9a4e",
    verge: "#a5c870",
    road: "#57536a",
    roadGrain: "#6f6a84",
    edge: "#fffaf0",
    kerbA: "#ffb02e",
    kerbB: "#fff6e8",
    barrierA: "#ff8a1e",
    barrierB: "#fff3e6",
    backdrop: { kind: "mountains", a: "#7c8fb8", b: "#c9d6ee", snow: true, height: 150 },
    scatter: [
      { ids: ["pine_a", "pine_b", "pine_c", "tree_pine"], cell: 20, prob: 0.6, min: 22, max: 280, scale: [0.8, 1.4], shadows: true, wind: 0.7, clear: 5 },
      { ids: ["rock_a", "rock_b", "rock_c"], cell: 26, prob: 0.35, min: 18, max: 220, scale: [0.6, 1.6] },
      { ids: ["bush_a", "bush_b"], cell: 22, prob: 0.3, min: 17, max: 140, scale: [0.8, 1.2], wind: 0.5 },
    ],
    landmarks: [
      { ids: ["cottage"], count: 4, min: 35, max: 160 },
      { ids: ["windmill"], count: 1, min: 50, max: 140, animated: true },
    ],
    roadside: [],
    clouds: 12,
    balloons: 6,
    water: 1,
    waterColor: "#4aa8d8",
    bloom: 0.8,
  },
  desert: {
    ground: "#e2b878",
    ground2: "#d29d5e",
    verge: "#efc98c",
    road: "#615065",
    roadGrain: "#7a6676",
    edge: "#fff6e0",
    kerbA: "#ff5a3c",
    kerbB: "#ffeccc",
    barrierA: "#ff7aa2",
    barrierB: "#fff1e8",
    backdrop: { kind: "mesas", a: "#d07a48", b: "#f0b276", height: 90 },
    scatter: [
      { ids: ["cactus_a", "cactus_b"], cell: 24, prob: 0.45, min: 18, max: 240, scale: [0.8, 1.3], shadows: true, clear: 4 },
      { ids: ["desert_rock_a", "desert_rock_b"], cell: 26, prob: 0.4, min: 18, max: 240, scale: [0.6, 1.8] },
      { ids: ["palm"], cell: 60, prob: 0.25, min: 22, max: 150, scale: [0.9, 1.2], shadows: true, wind: 0.9 },
    ],
    landmarks: [
      { ids: ["mesa"], count: 7, min: 110, max: 330, scale: [0.9, 1.6] },
      { ids: ["arch_rock"], count: 2, min: 60, max: 160 },
    ],
    roadside: [],
    clouds: 6,
    balloons: 3,
    water: 0,
    waterColor: "#3ab8c8",
    bloom: 0.9,
  },
  night: {
    ground: "#2f4a3c",
    ground2: "#22382e",
    verge: "#3c5c48",
    road: "#2c2742",
    roadGrain: "#3b3458",
    edge: "#e8e0ff",
    kerbA: "#ff5fa8",
    kerbB: "#e8e0ff",
    barrierA: "#3a2d7d",
    barrierB: "#5a4aa8",
    barrierGlow: "#39c6ff",
    roadGlow: "#ff5fa8",
    backdrop: { kind: "city", a: "#141a38", b: "#2a3466", height: 60 },
    scatter: [
      { ids: ["crystal_cluster"], cell: 30, prob: 0.35, min: 18, max: 160, scale: [0.8, 1.6], clear: 4 },
      { ids: ["pine_a", "pine_b", "tree_pine"], cell: 26, prob: 0.35, min: 24, max: 200, scale: [0.8, 1.3], shadows: true, wind: 0.5 },
      { ids: ["rock_a", "rock_b"], cell: 34, prob: 0.25, min: 18, max: 200, scale: [0.6, 1.3] },
    ],
    landmarks: [{ ids: ["building_a", "building_b", "building_c"], count: 26, min: 90, max: 320, scale: [0.9, 1.5] }],
    roadside: [{ ids: ["lamp_post"], every: 34, offset: 1.4, both: true, lightPool: "#ffd9a0" }],
    arches: { ids: ["neon_ring_pink", "neon_ring_cyan"], every: 115 },
    clouds: 4,
    balloons: 0,
    water: 1,
    waterColor: "#1d3c78",
    bloom: 1.25,
  },
};

/** The theme a cup uses: its `theme` prop, else one from its lighting. */
export function themeFor(theme: string | undefined, mood: string | undefined): ThemeId {
  if (theme && (THEMES as any)[theme]) return theme as ThemeId;
  if (mood === "night") return "night";
  if (mood === "sunset") return "desert";
  if (mood === "morning") return "hills";
  return "meadow";
}

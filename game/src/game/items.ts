/**
 * The random bonuses a right answer gives. Racers further back draw stronger bonuses,
 * like in kart racers: the leader mostly gets coins, shields and peels.
 */
export type BonusId = "turbo" | "triple" | "shield" | "peel" | "coins" | "nova";

export const BONUS_IDS: BonusId[] = ["turbo", "triple", "shield", "peel", "coins", "nova"];

/** Weights per bonus by race position bucket: [leader, front, middle, back]. */
const WEIGHTS: Record<BonusId, [number, number, number, number]> = {
  turbo: [2, 4, 5, 4],
  triple: [0, 1, 3, 4],
  shield: [4, 3, 2, 1],
  peel: [5, 3, 2, 0],
  coins: [5, 3, 2, 1],
  nova: [0, 0, 1, 3],
};

export function rollBonus(position: number, racers: number, rnd = Math.random): BonusId {
  const f = racers <= 1 ? 0 : (position - 1) / (racers - 1);
  const b = position === 1 ? 0 : f < 0.4 ? 1 : f < 0.75 ? 2 : 3;
  let total = 0;
  for (const id of BONUS_IDS) total += WEIGHTS[id][b];
  let r = rnd() * total;
  for (const id of BONUS_IDS) {
    r -= WEIGHTS[id][b];
    if (r <= 0) return id;
  }
  return "turbo";
}

/** Short colours used by the HUD and effects. */
export const BONUS_COLOR: Record<BonusId, string> = {
  turbo: "#ff8a1e",
  triple: "#ff5a1e",
  shield: "#39c6ff",
  peel: "#ffd23a",
  coins: "#ffc21a",
  nova: "#c86bff",
};

/** Simple vector icons (SVG path data, 24×24 viewBox) — drawn in our own style. */
export const BONUS_ICON: Record<BonusId, string> = {
  // a flame/rocket chevron
  turbo: "M12 2c2 3 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.6 2-4.6.3 1.7 1.3 2.6 2.2 2.8C10.7 7.6 11 4.6 12 2z",
  // three chevrons
  triple: "M3 18l5-6-5-6h3l5 6-5 6H3zm6 0l5-6-5-6h3l5 6-5 6H9zm6 0l5-6-5-6h3l5 6-5 6h-3z",
  // a bubble shield
  shield: "M12 2l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5l8-3z",
  // a peel
  peel: "M7 4c1 0 1.6.6 1.8 1.5C10 10 13 14 18 16c1 .4 1.4 1.2 1 2s-1.2 1-2 .7C11 16.6 7.6 11.8 6.2 6.4 6 5.2 6.2 4 7 4z",
  // stacked coins
  coins: "M12 3c4 0 7 1.3 7 3s-3 3-7 3-7-1.3-7-3 3-3 7-3zm-7 6c0 1.7 3 3 7 3s7-1.3 7-3v3c0 1.7-3 3-7 3s-7-1.3-7-3V9zm0 6c0 1.7 3 3 7 3s7-1.3 7-3v3c0 1.7-3 3-7 3s-7-1.3-7-3v-3z",
  // a four-point sparkle
  nova: "M12 1l2.6 7.4L22 11l-7.4 2.6L12 21l-2.6-7.4L2 11l7.4-2.6L12 1z",
};

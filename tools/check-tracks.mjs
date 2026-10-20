// Validates cup circuits: corner radius, self-clearance, lap length; suggests row and boost positions.
// node tools/check-tracks.mjs tools/tracks.json   (run from the repo root, needs game/node_modules)
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const THREE = require('../game/node_modules/three/build/three.cjs');
const tracks = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const HALF = 8, VERGE = 5;
for (const [id, t] of Object.entries(tracks)) {
  const pts = t.points.map(p => new THREE.Vector3(p.x, p.y ?? 0, p.z));
  const c = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  const L = c.getLength(); const n = Math.round(L);
  const P = c.getSpacedPoints(n); P.pop();
  const N = P.length;
  const yaw = P.map((p, i) => { const a = P[(i - 1 + N) % N], b = P[(i + 1) % N]; return Math.atan2(-(b.x - a.x), -(b.z - a.z)); });
  const curv = yaw.map((_, i) => { let d = yaw[(i + 4) % N] - yaw[(i - 4 + N) % N]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d / 8; });
  const minR = Math.min(...curv.map(k => 1 / Math.max(1e-6, Math.abs(k))));
  // clearance between parts of the track that are far apart along it
  let minClear = Infinity, where = null;
  for (let i = 0; i < N; i += 3) for (let j = i + 60; j < N; j += 3) {
    if (N - (j - i) < 60) continue;
    const d = Math.hypot(P[i].x - P[j].x, P[i].z - P[j].z);
    if (d < minClear) { minClear = d; where = [i, j]; }
  }
  // straight stretches: windows of 50 m before the row with the least turning
  const score = i => { let s = 0; for (let k = -50; k <= 6; k++) s += Math.abs(curv[(i + k + N) % N]); return s; };
  const cand = [];
  for (let i = 0; i < N; i += 2) cand.push([score(i), i]);
  cand.sort((a, b) => a[0] - b[0]);
  const rows = [];
  for (const [, i] of cand) {
    const f = i / N;
    if (f < 0.12 || f > 0.95) continue;
    if (rows.every(r => Math.min(Math.abs(r - f), 1 - Math.abs(r - f)) > 0.22)) rows.push(f);
    if (rows.length === 3) break;
  }
  rows.sort();
  const tight = [];
  for (let i = 0; i < N; i++) if (1 / Math.max(1e-6, Math.abs(curv[i])) < 24) {
    let best = 0, bd = Infinity; pts.forEach((q, k) => { const d = Math.hypot(q.x - P[i].x, q.z - P[i].z); if (d < bd) { bd = d; best = k; } });
    if (!tight.includes(best)) tight.push(best);
  }
  if (tight.length) console.log(`   tight near control points ${JSON.stringify(tight)}`);
  const ys = pts.map(p => p.y);
  const ok = minR >= 22 && minClear >= 2 * (HALF + VERGE) + 4;
  console.log(`${ok ? 'OK ' : 'BAD'} ${id}: L=${L.toFixed(0)}m minR=${minR.toFixed(1)}m clear=${minClear.toFixed(1)}m @${where} ymax=${Math.max(...ys)} rows=${JSON.stringify(rows.map(r => +r.toFixed(3)))}`);
}

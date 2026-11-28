#!/usr/bin/env node
/**
 * Whether bigger `skulkr scour fix` batches save: fits each batch's cost and minutes on its defects, files and repairs
 * over every fix record, bootstraps the per-batch overhead, and gives the fixed share by size.
 * Usage: node scripts/fixBatchFit.mjs [<state>/scour]
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2] ?? join(process.env.HOME, '.local/state/weasel-skulkr/scour');
const rows = [];
for (const name of readdirSync(dir)) {
  const f = join(dir, name, 'record.json');
  if (!/^fix-\d+$/.test(name) || !existsSync(f)) continue;
  const r = JSON.parse(readFileSync(f, 'utf8'));
  for (const b of r.batches ?? []) {
    if (b.costUsd == null || !b.defects?.length) continue;
    const files = new Set(b.defects.flatMap((d) => d.files ?? [])).size;
    const fixed = (b.verdicts ?? []).filter((v) => v.verdict === 'fixed').length;
    rows.push({ run: r.run, area: r.area, n: b.defects.length, files, repairs: b.repairs ?? 0, usd: b.costUsd, min: b.minutes, fixed, testFiles: b.verify?.testFiles?.total ?? 0 });
  }
}
const solve = (X, y) => { // normal equations, Gaussian elimination
  const k = X[0].length, A = Array.from({ length: k }, (_, i) => [...Array.from({ length: k }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0)), X.reduce((s, r, t) => s + r[i] * y[t], 0)]);
  for (let i = 0; i < k; i++) { const p = A[i][i]; for (let j = i; j <= k; j++) A[i][j] /= p; for (let r = 0; r < k; r++) if (r !== i) { const f = A[r][i]; for (let j = i; j <= k; j++) A[r][j] -= f * A[i][j]; } }
  const beta = A.map((r) => r[k]);
  const res = y.map((v, t) => v - X[t].reduce((s, x, j) => s + x * beta[j], 0));
  const sse = res.reduce((s, e) => s + e * e, 0), mean = y.reduce((a, b) => a + b, 0) / y.length;
  const sst = y.reduce((s, v) => s + (v - mean) ** 2, 0);
  return { beta, r2: 1 - sse / sst, rmse: Math.sqrt(sse / (y.length - k)) };
};
console.log(`${rows.length} batches, ${new Set(rows.map((r) => r.run)).size} runs`);
for (const [label, cols] of [['n', (r) => [1, r.n]], ['n+files', (r) => [1, r.n, r.files]], ['n+files+repairs', (r) => [1, r.n, r.files, r.repairs]]]) {
  for (const target of ['usd', 'min']) {
    const fit = solve(rows.map(cols), rows.map((r) => r[target]));
    console.log(`${target.padEnd(4)} ~ ${label.padEnd(16)} beta ${fit.beta.map((b) => b.toFixed(3).padStart(7)).join(' ')}  r2 ${fit.r2.toFixed(2)}  rmse ${fit.rmse.toFixed(2)}`);
  }
}
const fixRate = rows.reduce((s, r) => s + r.fixed, 0) / rows.reduce((s, r) => s + r.n, 0);
console.log(`fixed share overall ${(fixRate * 100).toFixed(0)}%`);
for (const r of rows.filter((r) => r.n <= 2)) console.log('small', JSON.stringify(r));
const boot = (target) => { const out = []; for (let i = 0; i < 2000; i++) { const s = rows.map(() => rows[Math.floor(Math.random() * rows.length)]); try { out.push(solve(s.map((r) => [1, r.n]), s.map((r) => r[target])).beta); } catch {} } return [0, 1].map((j) => { const v = out.map((b) => b[j]).filter(Number.isFinite).sort((a, b) => a - b); return `${v[Math.floor(v.length * 0.05)].toFixed(2)}..${v[Math.floor(v.length * 0.95)].toFixed(2)}`; }); };
console.log('90% bootstrap usd [overhead, per defect]', boot('usd'), 'min', boot('min'));
for (const [lo, hi] of [[1, 3], [4, 6], [7, 8], [9, 99]]) { const g = rows.filter((r) => r.n >= lo && r.n <= hi); if (g.length) console.log(`size ${lo}-${hi}: ${g.length} batches, fixed ${(100 * g.reduce((s, r) => s + r.fixed, 0) / g.reduce((s, r) => s + r.n, 0)).toFixed(0)}%, repairs/batch ${(g.reduce((s, r) => s + r.repairs, 0) / g.length).toFixed(2)}`); }

/**
 * `skulkr scour batches`: every fix run's batches as one row each, from the runs' records, and what a defect cost at
 * each batch size, for telling whether batching defects saves spend or time.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { scourStateDirOf } from './scourPaths.mjs';
import { BATCH_MAX } from './scourTriage.mjs';

/** Each batch of every fix run recorded in `dir`, in run and batch order: its size, the cap its run planned at,
 *  files, verdicts fixed, cost and minutes (`null` where the record has none). */
export const fixBatchRowsIn = (dir) => {
  if (!existsSync(dir)) return [];
  const rows = [];
  for (const name of readdirSync(dir).filter((n) => /^fix-\d+$/.test(n))) {
    const file = join(dir, name, 'record.json');
    if (!existsSync(file)) continue;
    const r = JSON.parse(readFileSync(file, 'utf8'));
    for (const b of r.batches ?? []) {
      rows.push({
        run: r.run, area: r.area, batch: b.n, cap: r.size ?? BATCH_MAX, defects: b.defects.length,
        files: new Set(b.defects.flatMap((d) => d.files ?? [])).size,
        fixed: (b.verdicts ?? []).filter((v) => /^fixed/i.test(v.verdict)).length,
        usd: b.costUsd ?? null, minutes: b.minutes ?? null, repairs: Array.isArray(b.repairs) ? b.repairs.length : (b.repairs ?? 0),
      });
    }
  }
  return rows.sort((a, b) => a.run - b.run || a.batch - b.batch);
};

/** Per batch size, over the rows with a cost: how many batches, and dollars, minutes and fixes per defect. */
export const fixBatchSizesOf = (rows) => {
  const by = new Map();
  for (const r of rows) {
    if (r.usd === null) continue;
    const e = by.get(r.defects) ?? { size: r.defects, batches: 0, defects: 0, usd: 0, minutes: 0, fixed: 0 };
    e.batches++; e.defects += r.defects; e.usd += r.usd; e.minutes += r.minutes ?? 0; e.fixed += r.fixed;
    by.set(r.defects, e);
  }
  return [...by.values()].sort((a, b) => a.size - b.size)
    .map((e) => ({ ...e, usdPerDefect: e.usd / e.defects, minutesPerDefect: e.minutes / e.defects, fixedShare: e.fixed / e.defects }));
};

const num = (v, width, places) => (v === null ? '–'.padStart(width) : v.toFixed(places).padStart(width));

/** The rows and sizes as terminal lines, numbers right-aligned. */
export const fixBatchLines = (rows, sizes) => {
  const area = Math.max(4, ...rows.map((r) => r.area.length));
  return [
    `run ${'area'.padEnd(area)} batch cap defects files fixed    usd    min repairs`,
    ...rows.map((r) => `${String(r.run).padStart(3)} ${r.area.padEnd(area)} ${String(r.batch).padStart(5)} ${String(r.cap).padStart(3)} ${String(r.defects).padStart(7)} ${String(r.files).padStart(5)} ${String(r.fixed).padStart(5)} ${num(r.usd, 6, 2)} ${num(r.minutes, 6, 1)} ${String(r.repairs).padStart(7)}`),
    '',
    'size batches  $/defect  min/defect  fixed',
    ...sizes.map((s) => `${String(s.size).padStart(4)} ${String(s.batches).padStart(7)} ${num(s.usdPerDefect, 9, 2)} ${num(s.minutesPerDefect, 11, 1)} ${`${Math.round(100 * s.fixedShare)}%`.padStart(6)}`),
  ];
};

/** `skulkr scour batches [--json]`, each line to `say`; answers the rows and sizes. */
export const fixBatchesCommand = (cfg, { json = false } = {}, say = (line) => console.log(line)) => {
  const rows = fixBatchRowsIn(scourStateDirOf(cfg));
  const sizes = fixBatchSizesOf(rows);
  if (json) say(JSON.stringify({ rows, sizes }));
  else for (const line of fixBatchLines(rows, sizes)) say(line);
  return { rows, sizes };
};

/**
 * `skulkr trial`: the digest of every preload trial (`night --trial preload`) the state directory holds. Per area, each
 * pair's dollars, turns, cache writes and reads, output, findings, and overlap (shared over distinct); then each arm
 * over every area. The raw records stay at `<night>/trial/<area>.json`; this only reads them.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nightsByRound } from './recordFiles.mjs';

const sum = (xs) => xs.reduce((n, x) => n + x, 0);

/** Every trial record under `state`'s nights, rounds ascending. */
export const trialRecordsIn = (state) => [...nightsByRound(state).values()].flatMap((n) => {
  const dir = join(n.dir, 'trial');
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))) : [];
});

/** One arm of a trial record (`{ A, B, m }`) as the figures the digest prints. */
export const armFigures = (arm) => {
  const sides = [arm.A, arm.B];
  const tokens = (k) => sum(sides.map((s) => s.usage?.tokens?.[k] ?? 0));
  return {
    usd: sum(sides.map((s) => s.usage?.costUsd ?? 0)), turns: sum(sides.map((s) => s.usage?.turns ?? 0)),
    write: tokens('cacheWrite5m') + tokens('cacheWrite1h'), read: tokens('cacheRead'), out: tokens('output'),
    a: arm.A.findings, b: arm.B.findings, m: arm.m, distinct: arm.A.findings + arm.B.findings - arm.m,
  };
};

const row = (label, f) => [
  label.padEnd(40), f.usd.toFixed(2).padStart(7), String(f.turns).padStart(5), `${(f.write / 1e3).toFixed(0)}k`.padStart(7),
  `${(f.read / 1e6).toFixed(2)}M`.padStart(7), `${(f.out / 1e3).toFixed(0)}k`.padStart(5), `${f.a}+${f.b}`.padStart(7),
  String(f.m).padStart(3), (f.distinct ? f.m / f.distinct : 0).toFixed(2).padStart(7),
].join(' ');

/** The digest's lines for `records`. */
export const trialLines = (records) => {
  const lines = [['area · arm'.padEnd(40), '$ pair'.padStart(7), 'turns'.padStart(5), 'write'.padStart(7), 'read'.padStart(7), 'out'.padStart(5), 'A+B'.padStart(7), 'm'.padStart(3), 'overlap'.padStart(7)].join(' ')];
  const by = { base: [], preload: [] };
  for (const r of records) {
    for (const arm of ['base', 'preload']) {
      const f = armFigures(r[arm]);
      by[arm].push(f);
      lines.push(row(`r${r.round} ${r.area} · ${arm}`, f));
    }
  }
  if (!records.length) return lines;
  const add = (fs) => Object.fromEntries(Object.keys(fs[0]).map((k) => [k, sum(fs.map((f) => f[k]))]));
  lines.push('');
  for (const arm of ['base', 'preload']) lines.push(row(`${records.length} areas · ${arm}`, add(by[arm])));
  return lines;
};

/** `skulkr trial`: prints the digest, or says there is nothing to digest. */
export const trialCommand = (cfg) => {
  const records = trialRecordsIn(cfg.state);
  if (!records.length) {
    console.log('no preload trial has run yet: `skulkr night --trial preload` runs one');
    return;
  }
  for (const line of trialLines(records)) console.log(line);
};

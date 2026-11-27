#!/usr/bin/env node
/**
 * How long each `skulkr scour fix` run's steps took, so runs made one at a time and side by side can be compared.
 *
 *   node scripts/fixRunStats.mjs [--state <dir>] [--json] [run…]
 *
 * Reads `<state>/scour/fix-<N>/` (default state: weasel's, `~/.local/state/weasel-skulkr`): each batch's record and
 * its job folders. A step's span runs from its folder's creation to its newest file; a fixer's model time is its
 * `claude.json` `duration_ms`. `overlap` is the minutes of a run's span that another fix run was also live. The
 * records stay the raw data; this only derives from them. `--json` prints one line per batch instead of the tables.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('usage: node scripts/fixRunStats.mjs [--state <dir>] [--json] [run…]');
  process.exit(0);
}
const opts = { state: join(homedir(), '.local', 'state', 'weasel-skulkr'), json: false, runs: [] };
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--state') opts.state = argv[++i];
  else if (argv[i] === '--json') opts.json = true;
  else if (/^\d+$/.test(argv[i])) opts.runs.push(Number(argv[i]));
  else { console.error(`unknown argument ${argv[i]}`); process.exit(2); }
}
const dir = join(opts.state, 'scour');
const minutes = (ms) => ms / 60_000;

/** A job folder's span: its creation to its newest file, in epoch ms. */
const spanOf = (at) => {
  const files = readdirSync(at).map((f) => statSync(join(at, f)).mtimeMs);
  return { start: statSync(at).birthtimeMs, end: Math.max(statSync(at).mtimeMs, ...files) };
};

const readJson = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };

const runs = readdirSync(dir).flatMap((name) => {
  const n = Number(/^fix-(\d+)$/.exec(name)?.[1]);
  if (!n || (opts.runs.length && !opts.runs.includes(n))) return [];
  const record = readJson(join(dir, name, 'record.json'));
  if (!record) return [];
  const jobs = join(dir, name, 'jobs');
  const batches = record.batches.map((b) => {
    const at = join(jobs, `${record.area}~b${b.n}`);
    const steps = existsSync(at) ? readdirSync(at).filter((f) => statSync(join(at, f)).isDirectory()) : [];
    const spans = Object.fromEntries(steps.map((s) => [s, spanOf(join(at, s))]));
    const sum = (re) => steps.filter((s) => re.test(s)).reduce((t, s) => t + minutes(spans[s].end - spans[s].start), 0);
    const claude = readJson(join(at, 'fix', 'claude.json'));
    return {
      run: n, area: record.area, batch: b.n, defects: b.defects.length,
      fixed: b.verdicts.filter((v) => v.verdict === 'fixed').length,
      ok: b.verify?.ok === true, repairs: b.repairs, usd: b.costUsd, minutes: b.minutes,
      fixerModelMin: claude ? minutes(claude.duration_ms) : null, turns: claude?.num_turns ?? null,
      fixStepMin: sum(/^fix$/), verifyMin: sum(/^verify/), repairMin: sum(/^repair/),
      start: Math.min(...Object.values(spans).map((s) => s.start)), end: Math.max(...Object.values(spans).map((s) => s.end)),
    };
  });
  const start = Date.parse(record.started);
  const end = record.finished ? Date.parse(record.finished) : Math.max(...batches.map((b) => b.end), start);
  return [{ n, area: record.area, start, end, finished: Boolean(record.finished), batches }];
}).sort((a, b) => a.n - b.n);

const overlapOf = (run) => runs.filter((r) => r !== run)
  .reduce((t, r) => t + Math.max(0, Math.min(run.end, r.end) - Math.max(run.start, r.start)), 0);

if (opts.json) {
  for (const r of runs) for (const b of r.batches) console.log(JSON.stringify({ ...b, overlapMin: minutes(overlapOf(r)) }));
  process.exit(0);
}
const f1 = (x, w) => (x === null || x === undefined ? '–' : x.toFixed(1)).padStart(w);
console.log('run  area                        batches  defects  fixed   wall min  overlap   batch min  fixer min  verify min      $  $/fixed');
for (const r of runs) {
  const t = (k) => r.batches.reduce((s, b) => s + (b[k] ?? 0), 0);
  const fixed = t('fixed');
  const mean = (k) => {
    const xs = r.batches.map((b) => b[k]).filter((x) => x !== null && x > 0);
    return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
  };
  console.log([
    String(r.n).padStart(3), r.area.padEnd(26), String(r.batches.length).padStart(7), String(t('defects')).padStart(7),
    String(fixed).padStart(5), f1(minutes(r.end - r.start), 9) + (r.finished ? ' ' : '*'), f1(minutes(overlapOf(r)), 7),
    f1(mean('minutes'), 10), f1(mean('fixerModelMin'), 9), f1(mean('verifyMin'), 10),
    f1(t('usd'), 6), (fixed ? (t('usd') / fixed).toFixed(2) : '–').padStart(7),
  ].join('  '));
}
console.log('batch, fixer and verify minutes are per batch; * marks a run still going.');

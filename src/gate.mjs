/**
 * What the map says of a batch's gate runs: how far each has got, how each ended, the nodes running them, and a
 * finished round's batch running again. `gate` is the config's; `names` its `names`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveConfig } from './config.mjs';

const NAMES = resolveConfig().names;

/**
 * How far each of the batch gate's parallel runs has got, from the last progress line each wrote to the gate's log in
 * `nightDir` (`gate`, the config's: its `logSuffix` and `progress` prefixes): `{ <run>: { done, total } | null }`, or
 * null before the gate has a log.
 */
export const fleetProgressOf = (nightDir, gate) => {
  const file = nightDir ? readdirSafe(nightDir).find((f) => f.endsWith(gate.logSuffix)) : undefined;
  if (!file) return null;
  const lines = readFileSync(join(nightDir, file), 'utf8').replace(/\x1b\[[0-9;]*m/g, '').split('\n');
  const last = (prefix) => {
    const progress = new RegExp(`^${prefix}onto: progress (\\d+)\\/(\\d+)`);
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = progress.exec(lines[i]);
      if (m) return { done: Number(m[1]), total: Number(m[2]) };
    }
    return null;
  };
  return Object.fromEntries(Object.entries(gate.progress ?? {}).map(([run, prefix]) => [run, last(prefix)]));
};

const readdirSafe = (dir) => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

/**
 * How each of a finished batch's gate runs ended: `{ <run>: 'passed' | 'failed' | null }`. A run the config's
 * `gate.outcome` names is read from the last `<name> passed|failed` in the gate's log; any other from the night log's
 * `gate: <gate name> passed|failed` line, the gate as a whole. Null where neither says.
 */
export const gateOutcomesOf = (nightDir, gate) => {
  const file = nightDir ? readdirSafe(nightDir).find((f) => f.endsWith(gate.logSuffix)) : undefined;
  const text = file ? readFileSync(join(nightDir, file), 'utf8').replace(/\x1b\[[0-9;]*m/g, '') : '';
  const lastIn = (body, name) => {
    const m = [...body.matchAll(new RegExp(`\\b${escapeRe(name)} (passed|failed)\\b`, 'g'))].at(-1);
    return m ? m[1] : null;
  };
  const nightLog = nightDir && existsSync(join(nightDir, 'night.log')) ? readFileSync(join(nightDir, 'night.log'), 'utf8') : '';
  const whole = () => lastIn(nightLog.split('\n').filter((l) => l.startsWith('gate: ')).join('\n'), gate.name);
  return Object.fromEntries(Object.keys(gate.progress ?? {}).map((run) => [run, gate.outcome?.[run] ? lastIn(text, gate.outcome[run]) : whole()]));
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Each gate run's running jobs of round `round`'s batch, by run: a run whose `gate.jobs` pattern matches a job's
 * task takes it, and a run with no pattern takes the jobs no other run's pattern matches.
 */
const gateJobsOf = (round, jobs, gate, names) => {
  const own = jobs.filter((j) => !j.finished && names.batchJobOf(round).test(j.task ?? ''));
  const runs = Object.keys(gate.progress ?? {});
  const patterns = Object.fromEntries(runs.filter((r) => gate.jobs?.[r]).map((r) => [r, new RegExp(gate.jobs[r])]));
  const claimed = (j) => Object.values(patterns).some((re) => re.test(j.task));
  return Object.fromEntries(runs.map((r) => [r, own.filter((j) => (patterns[r] ? patterns[r].test(j.task) : !claimed(j)))]));
};

/** The nodes running each of a round's gate runs now, `{ <run>: nodes joined | null }`. */
export const gateNodesOf = (round, jobs, gate, names = NAMES) => {
  const names_ = (js) => [...new Set(js.map((j) => j.node).filter(Boolean))].join(' + ') || null;
  return Object.fromEntries(Object.entries(gateJobsOf(round, jobs, gate, names)).map(([r, js]) => [r, names_(js)]));
};

/**
 * A finished round's batch run again: each gate run's jobs running now, `{ <run>: { done, total } }` summing their
 * progress, null before any reports, or undefined where none runs; null when no job of the round's batch runs.
 */
export const rerunOf = (round, jobs, gate, names = NAMES) => {
  const by = gateJobsOf(round, jobs, gate, names);
  if (!Object.values(by).some((js) => js.length)) return null;
  const sum = (js) => {
    if (!js.length) return undefined;
    const counted = js.filter((j) => j.progress);
    return counted.length ? counted.reduce((t, j) => ({ done: t.done + j.progress.done, total: t.total + j.progress.total }), { done: 0, total: 0 }) : null;
  };
  return Object.fromEntries(Object.entries(by).map(([r, js]) => [r, sum(js)]));
};

/** A run's gate runs: `fleet`, how far each has got while it runs; `gates`, each one's state ('running', 'passed',
 *  'failed', or null before it starts); and the nodes running them. A finished round whose batch runs again reads as running. */
export const fleetOf = (run, running, jobs, gate, names) => {
  if (running) return { fleet: fleetProgressOf(run.nightDir, gate), gates: null, rerun: false, gateNodes: gateNodesOf(run.round, jobs, gate, names) };
  const again = rerunOf(run.round, jobs, gate, names);
  const ended = gateOutcomesOf(run.nightDir, gate);
  if (!again) return { fleet: null, gates: ended, rerun: false, gateNodes: null };
  const each = (f) => Object.fromEntries(Object.keys(again).map((r) => [r, f(r)]));
  return {
    fleet: each((r) => again[r] ?? null),
    gates: each((r) => (again[r] !== undefined ? 'running' : ended[r] ?? null)),
    rerun: true,
    gateNodes: gateNodesOf(run.round, jobs, gate, names),
  };
};


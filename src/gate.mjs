/**
 * What the map says of a batch's gate runs: how far each has got, how each ended, the nodes running them, and a
 * finished round's batch running again. `gate` is the config's; `names` its `names`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { stripAnsi } from './ansi.mjs';

/** The gate's parallel runs in the order the dashboard draws them, each with its label: `[{ id, label }]`. */
export const gateRunsOf = (gate) => Object.keys(gate.progress ?? {}).map((id) => ({ id, label: gate.labels?.[id] ?? id }));

/**
 * How far each of the batch gate's parallel runs has got, from the last progress line each wrote to the gate's log in
 * `nightDir` (`gate`, the config's: its `logSuffix` and `progress` prefixes): `{ <run>: { done, total } | null }`, or
 * null before the gate has a log.
 */
export const fleetProgressOf = (nightDir, gate) => {
  const file = gateLogIn(nightDir, gate);
  if (!file) return null;
  const lines = stripAnsi(readFileSync(join(nightDir, file), 'utf8')).split('\n');
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
 * The name of the gate's newest log in `nightDir`, or undefined before it has one: a round that tests its batch again
 * (after merging a moved `main` in, or after the capstone) writes a log per pass.
 */
const gateLogIn = (nightDir, gate) => {
  if (!nightDir) return undefined;
  const logs = readdirSafe(nightDir).filter((f) => f.endsWith(gate.logSuffix));
  const mtime = (f) => {
    try {
      return statSync(join(nightDir, f)).mtimeMs;
    } catch {
      return -Infinity;
    }
  };
  return logs.map((f) => ({ f, t: mtime(f) })).sort((a, b) => b.t - a.t)[0]?.f;
};

/**
 * How each of a finished batch's gate runs ended: `{ <run>: 'passed' | 'failed' | null }`. A run the config's
 * `gate.outcome` names is read from the last `<name> passed|failed` in the gate's log; any other from the night log's
 * `gate: <gate name> passed|failed` line, the gate as a whole. Null where neither says.
 */
export const gateOutcomesOf = (nightDir, gate) => {
  const file = gateLogIn(nightDir, gate);
  const text = file ? stripAnsi(readFileSync(join(nightDir, file), 'utf8')) : '';
  const lastIn = (body, name) => {
    const m = [...body.matchAll(new RegExp(`\\b${escapeRe(name)} (passed|failed)\\b`, 'g'))].at(-1);
    return m ? m[1] : null;
  };
  const nightLog = nightDir && existsSync(join(nightDir, 'night.log')) ? readFileSync(join(nightDir, 'night.log'), 'utf8') : '';
  const whole = () => lastIn(nightLog.split('\n').filter((l) => l.startsWith('gate: ')).join('\n'), gate.name);
  return Object.fromEntries(Object.keys(gate.progress ?? {}).map((run) => [run, gate.outcome?.[run] ? lastIn(text, gate.outcome[run]) : whole()]));
};

/** How many of a gate failure's files or steps the map names; the count covers the rest. */
const FAILURES_NAMED = 4;
/** How many files the map lists a run's failed tests for, and how many tests in each. */
const FAILED_FILES_LISTED = 30;
const FAILED_TESTS_LISTED = 12;

/** A vitest report's `FAIL <project> <file> > <test>` line, after any part prefix (`browser| `). */
const FAIL_LINE = /^(?:[\w:.-]+\| )?\s*FAIL\s+.*?\s(\S+\.(?:test|spec)\.[cm]?[jt]sx?) > (.+)$/;

/** Each failed test in `lines`, with the first line of its error: `{ file, test, error }`. */
const failedTestsIn = (lines) => {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = FAIL_LINE.exec(lines[i]);
    if (!m) continue;
    let error = '';
    for (let j = i + 1; j < Math.min(lines.length, i + 6) && !error; j++) {
      const text = lines[j].replace(/^[\w:.-]+\| ?/, '').trim();
      if (text && !FAIL_LINE.test(lines[j])) error = text.slice(0, 240);
    }
    out.push({ file: m[1], test: m[2].trim(), error });
  }
  return out;
};

/** The failed tests grouped by file, the files and the tests in each capped, each test once. */
const failedByFile = (tests) => {
  const by = new Map();
  for (const t of tests) {
    const list = by.get(t.file) ?? [];
    if (!list.some((x) => x.test === t.test)) list.push({ test: t.test, error: t.error });
    by.set(t.file, list);
  }
  return [...by].slice(0, FAILED_FILES_LISTED).map(([file, list]) => ({ file, count: list.length, tests: list.slice(0, FAILED_TESTS_LISTED) }));
};

/**
 * What each of the batch gate's runs has failed so far, from its log's `fleet-fail:` lines (`gate.failPrefix`, the
 * line's start; a run whose `gate.failRun` word follows it takes that line, the others take the rest):
 * `{ <run>: { count, files, names, list } }`: `count` the distinct failures, `files` the files or steps they are in,
 * `names` the first few of those, and `list` each file's failed tests with the first line of each error; null where
 * a run has failed nothing.
 */
export const gateFailuresOf = (nightDir, gate) => {
  const file = gateLogIn(nightDir, gate);
  if (!file || !gate.failPrefix) return null;
  return gateFailuresIn(readFileSync(join(nightDir, file), 'utf8'), gate);
};

export const failLinesIn = (lines, gate) => lines.filter((l) => l.startsWith(gate.failPrefix)).map((l) => l.slice(gate.failPrefix.length).trim());
/** Where a `fleet-fail:` line failed: a test's line names its project, file and test; a step's names its command. */
const whereOf = (l) => (l.includes(' :: ') ? l.split(' :: ')[0].split(' ').at(-1) : l.replace(/^\S+ /, ''));

/** The tests a gate log's `fleet-fail:` lines name in test file `file`, each as the line gives it after ` :: `. */
export const testsFailingIn = (text, gate, file) =>
  (gate.failPrefix ? [...new Set(failLinesIn(stripAnsi(text).split('\n'), gate).filter((l) => l.includes(' :: ') && whereOf(l) === file).map((l) => l.split(' :: ').slice(1).join(' :: ')))] : []);

/** Every file or step a gate log's `fleet-fail:` lines name, once each, across its runs. */
export const failedWhereIn = (text, gate) =>
  (gate.failPrefix ? [...new Set(failLinesIn(stripAnsi(text).split('\n'), gate).map(whereOf))] : []);

/** {@link gateFailuresOf} for one gate log's text. */
export const gateFailuresIn = (text, gate) => {
  if (!gate.failPrefix) return null;
  const all = stripAnsi(text).split('\n');
  const lines = failLinesIn(all, gate);
  const owned = Object.entries(gate.failRun ?? {});
  const runOf = (line) => owned.find(([, word]) => line.startsWith(`${word} `))?.[0];
  const runs = Object.keys(gate.progress ?? {});
  const fallback = runs.find((r) => !gate.failRun?.[r]);
  return Object.fromEntries(runs.map((run) => {
    const mine = [...new Set(lines.filter((l) => (runOf(l) ?? fallback) === run))];
    if (!mine.length) return [run, null];
    const files = [...new Set(mine.map(whereOf))];
    // A test run's failures, by file with each test's error; a run of steps lists the steps alone.
    const tests = failedTestsIn(all).filter((t) => files.includes(t.file));
    const list = tests.length ? failedByFile(tests) : files.slice(0, FAILED_FILES_LISTED).map((step) => ({ file: step, count: 1, tests: [] }));
    return [run, { count: mine.length, files: files.length, names: files.slice(0, FAILURES_NAMED), list }];
  }));
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
export const gateNodesOf = (round, jobs, gate, names) => {
  const names_ = (js) => [...new Set(js.map((j) => j.node).filter(Boolean))].join(' + ') || null;
  return Object.fromEntries(Object.entries(gateJobsOf(round, jobs, gate, names)).map(([r, js]) => [r, names_(js)]));
};

/**
 * A finished round's batch run again: each gate run's jobs running now, `{ <run>: { done, total } }` summing their
 * progress, null before any reports, or undefined where none runs; null when no job of the round's batch runs.
 */
export const rerunOf = (round, jobs, gate, names) => {
  const by = gateJobsOf(round, jobs, gate, names);
  if (!Object.values(by).some((js) => js.length)) return null;
  const sum = (js) => {
    if (!js.length) return undefined;
    const counted = js.filter((j) => j.progress);
    return counted.length ? counted.reduce((t, j) => ({ done: t.done + j.progress.done, total: t.total + j.progress.total }), { done: 0, total: 0 }) : null;
  };
  return Object.fromEntries(Object.entries(by).map(([r, js]) => [r, sum(js)]));
};

/** A run's gate runs: `gateRuns`, which they are and their labels; `fleet`, how far each has got while it runs; `gates`, each one's state ('running', 'passed',
 *  'failed', or null before it starts); and the nodes running them. A finished round whose batch runs again reads as running. */
export const fleetOf = (run, running, jobs, gate, names) => ({ gateRuns: gateRunsOf(gate), ...fleetStateOf(run, running, jobs, gate, names) });

const fleetStateOf = (run, running, jobs, gate, names) => {
  const failures = gateFailuresOf(run.nightDir, gate);
  if (running) return { fleet: fleetProgressOf(run.nightDir, gate), gates: null, rerun: false, gateNodes: gateNodesOf(run.round, jobs, gate, names), failures };
  const again = rerunOf(run.round, jobs, gate, names);
  const ended = gateOutcomesOf(run.nightDir, gate);
  if (!again) return { fleet: null, gates: ended, rerun: false, gateNodes: null, failures };
  // Every run of a capstone going again is under way, the ones with no job placed yet too: the past run's outcome is
  // not this one's.
  const each = (f) => Object.fromEntries(Object.keys(gate.progress ?? {}).map((r) => [r, f(r)]));
  return {
    fleet: each((r) => again[r] ?? null),
    gates: each(() => 'running'),
    rerun: true,
    gateNodes: gateNodesOf(run.round, jobs, gate, names),
    // A run going again has not failed yet this time; the last time's failures are the past run's.
    failures: null,
  };
};


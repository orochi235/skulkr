/**
 * The audit map's data: every area of the partition with its passes, whether it is settled, where it sits in
 * the queue, and how far the live run holding it has taken it. `skulkr map [--out <file>]` prints or writes the JSON
 * the dashboard reads. Functions taking `names` take the config's `names`; the default is the default config's.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitIn } from './batch.mjs';
import { resolveConfig } from './config.mjs';
import { fixTallyOf } from './findings.mjs';
import { fleetOf } from './gate.mjs';
import { areaIcons, iconsFor } from './icons.mjs';
import { partitionAt } from './partition.mjs';
import { correctedLeftOf } from './calibration.mjs';
import { COVERED, areaStats, areasInFlightFor, calibrationFor, chapman, drawnPassOf, gitTouched, incompleteByRound, passOf, passesIn, pickAreas } from './rounds.mjs';
import { openFindingsIn } from './carryRecords.mjs';
import { continuousOf } from './continuousOf.mjs';
import { lastFinished, liveRuns, readJson } from './runs.mjs';
import { parseEnvelope } from './usage.mjs';

const NAMES = resolveConfig().names;

/** Each area's furthest step in a night's log, from the lines `night.mjs` prints as jobs finish. */
export const nightStages = (log, names = NAMES) => {
  const stages = new Map();
  const reviews = new Map();
  const set = (id, stage) => stages.set(id, stage);
  for (const line of log.split('\n')) {
    let m;
    if ((m = /^review \d+\/\d+ (\S+) [AB] /.exec(line))) {
      const n = (reviews.get(m[1]) ?? 0) + 1;
      reviews.set(m[1], n);
      set(m[1], n >= 2 ? 'reviewed' : 'reviewing');
    } else if ((m = /^match \d+\/\d+ (\S+):/.exec(line))) set(m[1], 'matched');
    else if ((m = /^fix \d+\/\d+ (\S+) on /.exec(line))) set(m[1], 'fixed');
    else if ((m = /^patch (\S+): /.exec(line))) set(m[1], 'patched');
    else if ((m = names.leftOut(line)) && !m.earlier) set(m.area, 'conflict');
  }
  return stages;
};

const LANE_STEPS = ['A', 'B', 'match', 'fix', 'patch'];

/**
 * A lane's repair step from one of the log's `verify` or `repair` lines (`repair.mjs`): made by the first, running
 * while a failing verdict waits on a repair, done once one passes or times out, and failed once the area is left out.
 * `attempts` counts the repairs, `minutes` their time.
 */
const repairStep = (steps, line) => {
  const step = (steps.repair ??= { state: 'waiting', attempts: 0 });
  let m;
  if (/^verify \S+: passed/.test(line)) Object.assign(step, { state: 'done', outcome: 'passed' });
  else if (/^verify \S+: timed out/.test(line)) Object.assign(step, { state: 'done', outcome: 'timed out' });
  else if ((m = /^verify \S+: still failing after (\d+) repairs/.exec(line))) Object.assign(step, { state: 'failed', outcome: 'failed', why: `still failing after ${m[1]} repairs` });
  else if (/^verify \S+: failed/.test(line)) Object.assign(step, { state: 'running', outcome: 'failed' });
  else if ((m = /^repair \S+ \S+ on (\S+): (\d+) commits, ([\d.]+) min; verify (passed)?/.exec(line))) {
    Object.assign(step, {
      attempts: (step.attempts ?? 0) + 1, node: m[1], minutes: Number(((step.minutes ?? 0) + Number(m[3])).toFixed(1)),
      ...(m[4] ? { state: 'done', outcome: 'passed' } : { state: 'running', outcome: 'failed' }),
    });
  }
};

/** The finished onto job that most likely ran a step the log says took `minutes`: the one whose run is nearest that. */
const bestFinished = (jobs, minutes) => {
  const took = (j) => (Date.parse(j.finished) - Date.parse(j.started)) / 60_000;
  const off = (j) => (minutes === undefined ? -Date.parse(j.finished) : Math.abs(took(j) - minutes));
  return [...jobs].sort((x, y) => off(x) - off(y))[0];
};

/**
 * Each area's lane: for every step of its thread (reviews A and B, match, fix, patch), whether it is done,
 * with what the log says it produced, or running, from `jobs`' `audit<N>-<area>-<step>` onto tasks. A job with
 * no `finished` is running, and gives its step's `since`; a finished one gives a done step its `ended`, and its
 * `started` as that less the minutes the log reports. A done fix takes its report's tally from `reports`, by area.
 */
export const nightLanes = (log, areas, jobs = [], reports = new Map(), names = NAMES) => {
  const lanes = new Map(areas.map((id) => [id, Object.fromEntries(LANE_STEPS.map((s) => [s, { state: 'waiting' }]))]));
  const at = (id, step) => lanes.get(id)?.[step];
  for (const line of log.split('\n')) {
    let m;
    if ((m = /^review \d+\/\d+ (\S+) ([AB]) on (\S+): (\d+) findings, (\d+)\/(\d+) files read, ([\d.]+) min/.exec(line))) {
      Object.assign(at(m[1], m[2]) ?? {}, { state: 'done', node: m[3], findings: Number(m[4]), read: Number(m[5]), files: Number(m[6]), minutes: Number(m[7]) });
    } else if ((m = /^match \d+\/\d+ (\S+): (\d+) shared of (\d+) \+ (\d+)/.exec(line))) {
      Object.assign(at(m[1], 'match') ?? {}, { state: 'done', shared: Number(m[2]), a: Number(m[3]), b: Number(m[4]) });
    } else if ((m = /^fix \d+\/\d+ (\S+) on (\S+): (\d+) commits, ([\d.]+) min/.exec(line))) {
      const tally = fixTallyOf(reports.get(m[1]) ?? '');
      Object.assign(at(m[1], 'fix') ?? {}, { state: 'done', node: m[2], commits: Number(m[3]), minutes: Number(m[4]), ...(tally ?? {}) });
    } else if ((m = /^patch (\S+): (\d+) commits on /.exec(line))) {
      Object.assign(at(m[1], 'patch') ?? {}, { state: 'done', commits: Number(m[2]) });
    } else if ((m = /^patch (\S+): did not apply/.exec(line))) {
      Object.assign(at(m[1], 'patch') ?? {}, { state: 'failed', why: 'did not apply' });
    } else if ((m = /^patch (\S+): left out: (.+)$/.exec(line))) {
      Object.assign(at(m[1], 'patch') ?? {}, { state: 'failed', why: m[2] });
    } else if ((m = /^(?:verify|repair) ([^\s:]+)/.exec(line)) && lanes.has(m[1])) {
      repairStep(lanes.get(m[1]), line);
    } else if ((m = names.leftOut(line)) && !m.earlier) {
      Object.assign(at(m.area, 'patch') ?? {}, { state: 'failed', why: `${m.why}; left out of the batch` });
    }
  }
  // A reviewer who found nothing leaves nothing to pair, so no matcher runs and no match line is written.
  for (const steps of lanes.values()) {
    const { A, B, match } = steps;
    if (match.state === 'waiting' && A.state === 'done' && B.state === 'done' && (A.findings === 0 || B.findings === 0)) {
      Object.assign(match, { state: 'done', shared: 0, a: A.findings, b: B.findings, minutes: 0 });
    }
  }
  const finished = new Map();
  for (const job of jobs) {
    const m = names.step.exec(job.task ?? '');
    // A verify job and a repair job are both the lane's repair step.
    if (m && (m[2] === 'verify' || m[2] === 'repair')) {
      m[2] = 'repair';
      if (!job.finished && lanes.has(m[1])) lanes.get(m[1]).repair ??= { state: 'waiting' };
    }
    const step = m && at(m[1], m[2]);
    if (!step) continue;
    if (job.finished) {
      const key = `${m[1]}\n${m[2]}`;
      finished.set(key, [...(finished.get(key) ?? []), job]);
    } else if (step.state === 'waiting' || (m[2] === 'repair' && step.state === 'running')) {
      Object.assign(step, { state: 'running', node: job.node, since: job.started, ...(job.progress ? { done: job.progress.done, total: job.progress.total } : {}) });
    }
  }
  for (const [key, ran] of finished) {
    const [id, name] = key.split('\n');
    const step = at(id, name);
    if (step.state !== 'done') continue;
    const job = bestFinished(ran, step.minutes);
    const ended = Date.parse(job.finished);
    const started = step.minutes === undefined ? Date.parse(job.started) : ended - step.minutes * 60_000;
    Object.assign(step, { started: new Date(started).toISOString(), ended: new Date(ended).toISOString() });
  }
  return [...lanes].map(([id, steps]) => ({ id, steps }));
};

/**
 * Every branch a night's log says its batch left out: `{ area, round, why }`, `round` the branch's own, earlier than
 * `round` for a branch an earlier round left out and this one retried.
 */
export const nightLeftOut = (log, round, names = NAMES) => log.split('\n').flatMap((line) => {
  const m = names.leftOut(line);
  return m ? [{ area: m.area, round: m.earlier ?? round, why: m.why }] : [];
});

/** A run's night directory: the one its record names, or else the one `night.mjs` named for its round. */
const nightDirOf = (run, state) => {
  if (run.nightDir) return run.nightDir;
  const nights = join(state, 'nights');
  if (!existsSync(nights)) return null;
  const name = readdirSync(nights).filter((n) => n.endsWith(`-round${run.round}`)).sort().at(-1);
  return name ? join(nights, name) : null;
};

/** Each lane with the pass its round has made of the area once matched, as the record will hold it. */
export const withPasses = (lanes, run) => lanes.map((lane) => {
  const { match } = lane.steps;
  if (match.state !== 'done') return lane;
  const { a = 0, b = 0, shared = 0 } = match;
  return { ...lane, pass: passOf(run.round, run.started?.slice(0, 10) ?? '', a, b, shared, a + b - shared) };
});

/** Each area's fixer report that has come home, by area. */
const fixReports = (nightDir, ids) => new Map(nightDir ? ids.flatMap((id) => {
  const file = join(nightDir, 'jobs', id, 'fix', 'claude.json');
  return existsSync(file) ? [[id, parseEnvelope(readFileSync(file, 'utf8')).reply]] : [];
}) : []);

export { fleetOf, fleetProgressOf, gateFailuresOf, gateNodesOf, gateOutcomesOf, gateRunsOf, rerunOf } from './gate.mjs';

const DEFAULT_GATE = resolveConfig().gate;

/**
 * What one run, live (`running`) or finished, says about its areas; `jobs` are the runner's jobs, running and
 * finished; `sweepId` the config's sweep, whose running job marks `sweepRunning`; `gate` the config's, for `fleet`.
 */
export const readRun = (found, running, jobs = [], state, { names = NAMES, sweepId, gate = DEFAULT_GATE } = {}) => {
  const run = { ...found, nightDir: nightDirOf(found, state) };
  const logPath = run.nightDir ? join(run.nightDir, 'night.log') : null;
  const log = logPath && existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
  const lines = log.split('\n').filter(Boolean);
  const areaIds = run.areas?.map((a) => (typeof a === 'string' ? a : a.id)) ?? [];
  const ownRe = names.jobOf(run.round);
  const own = jobs.filter((j) => ownRe.test(j.task ?? ''));
  return {
    running,
    round: run.round,
    started: run.started,
    ended: run.ended ?? null,
    step: running ? run.step : 'done',
    ...(running && run.behind ? { behind: run.behind } : {}),
    costUsd: run.costUsd ?? 0,
    capUsd: run.capUsd ?? null,
    report: run.report ?? null,
    areas: areaIds,
    stages: Object.fromEntries(nightStages(log, names)),
    leftOut: nightLeftOut(log, run.round, names),
    lanes: withPasses(nightLanes(log, areaIds, running ? own : own.filter((j) => j.finished), fixReports(run.nightDir, areaIds), names), run),
    sweepRunning: Boolean(running && sweepId && jobs.some((j) => !j.finished && (j.task ?? '').endsWith(sweepId))),
    nightDir: run.nightDir ?? null,
    lastLine: lines.at(-1) ?? null,
    lines: lines.slice(-40),
    ...fleetOf(run, running, jobs, gate, names),
  };
};

/**
 * Every live run, then the one that finished last. `jobs` are the runner's jobs, or `listJobs(sinceIso)` is asked
 * for them (the runner's `jobs`), each running one given its progress from `listProgress()` (the runner's
 * `progress`, a Map by task); `opts` is `readRun`'s.
 */
/** @param {string} state @param {any[] | null} [jobs] @param {{ listJobs?: (since: string) => any[], listProgress?: () => Map<string, any>, names?: any, sweepId?: string, gate?: any }} [opts] */
export const readRuns = (state, jobs = null, { listJobs = () => [], listProgress = () => new Map(), ...opts } = {}) => {
  const legacy = !existsSync(join(state, 'runs'));
  const current = legacy ? readJson(join(state, 'current.json')) : null;
  // A service still on the one-night runner keeps current.json and last.json instead of runs/.
  const lastJson = legacy ? readJson(join(state, 'last.json')) : null;
  const last = legacy ? (lastJson && lastJson.round !== current?.round ? lastJson : null) : lastFinished(state);
  const live = legacy ? (current ? [current] : []) : liveRuns(state);
  const all = [...live, ...(last ? [last] : [])];
  const since = all.map((r) => r.started).filter(Boolean).sort()[0];
  const asked = all.length ? (jobs ?? (since ? listJobs(since) : [])) : [];
  // Only a running job reports progress, so the runner is asked for it only while one runs.
  const progress = !jobs && asked.some((j) => !j.finished) ? listProgress() : new Map();
  const known = asked.map((j) => (progress.has(j.task) ? { ...j, progress: progress.get(j.task) } : j));
  return [...live.map((r) => readRun(r, true, known, state, opts)), ...(last ? [readRun(last, false, known, state, opts)] : [])];
};

/**
 * What a run's night directory holds of each area it finished: `areas/<id>/match.json` (each reviewer's claims and
 * the pairs matched across them) and `files.txt`, the fields its `area.json` is made from.
 */
export const nightResults = (nightDir) => {
  const dir = nightDir ? join(nightDir, 'areas') : null;
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const matchPath = join(dir, entry.name, 'match.json');
    if (!entry.isDirectory() || !existsSync(matchPath)) return [];
    const match = readJson(matchPath);
    if (!match) return [];
    const filesPath = join(dir, entry.name, 'files.txt');
    const files = existsSync(filesPath) ? readFileSync(filesPath, 'utf8').split('\n').filter(Boolean).length : 0;
    const [a, b, m] = [match.a?.length ?? 0, match.b?.length ?? 0, match.pairs?.length ?? 0];
    return [{ id: entry.name, files, a, b, m, distinct: a + b - m, est: chapman(a, b, m) }];
  });
};

/** A run's bar on the rounds chart, from its night directory: `pending` says it is `live` or `unmerged`. Null for a
 *  run that has finished no area. */
export const nightRoundOf = (run) => {
  const results = nightResults(run.nightDir);
  // A live round has a bar from its start, empty until its first area reports; a finished one with no results has none.
  if (results.length === 0 && !run.running) return null;
  const sum = (key) => results.reduce((n, r) => n + r[key], 0);
  return {
    round: run.round, date: (run.started ?? '').slice(0, 10), areas: results.length,
    files: sum('files'), distinct: sum('distinct'), est: sum('est'), pending: run.running ? 'live' : 'unmerged',
  };
};

/**
 * Every round's night directory under `state`'s `nights/` (`<started>-round<N>`), the latest where a round has more
 * than one, each `running` while a live run in `runs` holds its round. A night holding an `abandoned` file (its reason)
 * is a round given up for good, which never lands: it is left out.
 */
export const nightsOf = (runs, state) => {
  const dir = join(state, 'nights');
  if (!existsSync(dir)) return [];
  const live = new Set(runs.filter((r) => r.running).map((r) => r.round));
  const latest = new Map();
  for (const name of readdirSync(dir).sort()) {
    const m = /^(\d{4}-\d{2}-\d{2})T.*-round(\d+)$/.exec(name);
    if (m && existsSync(join(dir, name, 'abandoned'))) latest.delete(Number(m[2]));
    else if (m) latest.set(Number(m[2]), { round: Number(m[2]), started: m[1], nightDir: join(dir, name), running: live.has(Number(m[2])) });
  }
  return [...latest.values()];
};

/** The whole map for the project at `root` under `cfg`, its runs' jobs asked of `runner`. */
export const buildMap = (cfg, root, runner) => {
  const git = gitIn(root);
  const head = git('rev-parse', '--short', 'HEAD');
  const areas = partitionAt(cfg, root, 'HEAD');
  const { history: passes, covered, staleLines, pairLines } = areaStats(cfg, git, areas, passesIn(cfg, git, root), root);
  const calibration = calibrationFor(passes, pairLines);
  const corrected = (p) => ({ ...p, leftCorrected: correctedLeftOf(p, calibration) });
  const { picked, settled } = pickAreas({ areas, passes, covered, staleLines, calibration, touched: gitTouched(git), count: Infinity, inFlight: areasInFlightFor(cfg, git) });
  const settledSet = new Set(settled);
  const runs = readRuns(cfg.state, null, { listJobs: (since) => runner.jobs(since), listProgress: () => runner.progress?.() ?? new Map(), names: cfg.names, sweepId: cfg.sweep?.id, gate: cfg.gate })
    .map((r) => ({ ...r, lanes: r.lanes.map((l) => (l.pass ? { ...l, pass: corrected(l.pass) } : l)) }));
  /** The live run holding each area. */
  const holder = new Map(runs.filter((r) => r.running).flatMap((r) => r.areas.map((id) => [id, r])));
  // A live run's areas are being audited, not waiting, so the queue counts from 1 past them.
  const queue = new Map(picked.filter((id) => !holder.has(id)).map((id, i) => [id, i + 1]));
  const icons = areaIcons(iconsFor(cfg, root), areas);
  const open = openFindingsIn(cfg, git, root);

  const out = areas.map((area) => {
    const own = passes.get(area.id) ?? [];
    const history = own.map((p) => corrected(drawnPassOf(p)));
    const run = holder.get(area.id);
    const audited = history.length > 0 && (covered.get(area.id) ?? 1) >= COVERED;
    const status = run ? 'tonight' : settledSet.has(area.id) ? 'settled' : audited ? 'due' : 'unaudited';
    const stale = history.length ? staleLines.get(area.id) ?? 0 : 0;
    return {
      id: area.id,
      group: area.id.split('.')[0],
      files: area.files.length,
      status,
      queue: queue.get(area.id) ?? null,
      passes: history,
      stage: run ? run.stages[area.id] ?? 'queued' : null,
      ...(stale ? { staleLines: stale } : {}),
      ...(open.get(area.id)?.length ? { openFindings: open.get(area.id).length, open: open.get(area.id).map(({ round, claim, where }) => ({ round, claim, where })) } : {}),
      ...(icons.byArea.has(area.id) ? { icon: icons.byArea.get(area.id) } : {}),
      _raw: own,
    };
  });

  // Each round's passes count once, as recorded, however many areas share one; their estimates by the shares inherited.
  const rounds = new Map();
  const counted = new Set();
  for (const a of out) {
    a._raw.forEach((raw, i) => {
      const p = a.passes[i];
      const r = rounds.get(p.round) ?? { round: p.round, date: p.date, areas: 0, files: 0, distinct: 0, est: 0 };
      const key = `${raw.round}\n${raw.id}`;
      if (!counted.has(key)) {
        counted.add(key);
        r.areas += 1;
        r.files += raw.files?.length ?? a.files;
        r.distinct += p.distinct;
      }
      r.est += p.est;
      rounds.set(p.round, r);
    });
    delete a._raw;
  }

  // A round whose areas came back incomplete says how many, so a bar drawn from the few that finished reads as that.
  for (const [round, incomplete] of incompleteByRound(root, cfg.record.dir)) {
    const r = rounds.get(round) ?? { round, date: null, areas: 0, files: 0, distinct: 0, est: 0 };
    rounds.set(round, { ...r, incomplete });
  }

  // A round whose record is not on this branch yet is drawn from its night directory, marked as such.
  for (const night of nightsOf(runs, cfg.state)) {
    const bar = rounds.has(night.round) ? null : nightRoundOf(night);
    if (bar) rounds.set(night.round, bar);
  }

  return {
    generated: new Date().toISOString(),
    project: cfg.name,
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    partition: { path: cfg.partition.path, maxFiles: cfg.partition.maxFiles },
    head,
    areasPerRound: cfg.areasPerRound,
    ...continuousOfMap(cfg),
    runs,
    areas: out,
    ...(Object.keys(icons.glyphs).length ? { icons: icons.glyphs } : {}),
    rounds: [...rounds.values()].sort((x, y) => x.round - y.round).map((r) => ({ ...r, est: Math.round(r.est) })),
    calibration,
  };
};

/** The map's `continuous`: the mode, what the next round waits on, and the night's spend, while the mode is on. */
const continuousOfMap = (cfg) => {
  const { mode, next, budget } = continuousOf(cfg, { fleet: { holder: null, waiting: [] } });
  if (!mode.on) return {};
  return { continuous: { until: mode.until, next: next.start ? 'starts now' : next.why, nightUsd: budget.nightUsd, spentUsd: budget.spentUsd, leftUsd: budget.leftUsd } };
};

/** `skulkr map [--out <file>]`: prints or writes the map. */
export const mapCommand = (cfg, root, runner, argv) => {
  const at = argv.indexOf('--out');
  const json = JSON.stringify(buildMap(cfg, root, runner));
  if (at >= 0) writeFileSync(argv[at + 1], json);
  else process.stdout.write(json + '\n');
};

/**
 * The audit map's data: every area of the partition with its passes, whether it is settled, where it sits in
 * the queue, and how far the live run holding it has taken it. `skulkr map [--out <file>]` prints or writes the JSON
 * the dashboard reads. Functions taking `names` take the config's `names`; the default is the default config's.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitIn } from './batch.mjs';
import { resolveConfig } from './config.mjs';
import { nightLanes, nightLeftOut, nightStages } from './nightLog.mjs';
import { fleetOf } from './gate.mjs';
import { areaIcons, iconsFor } from './icons.mjs';
import { partitionAt } from './partition.mjs';
import { correctedLeftOf } from './calibration.mjs';
import { COVERED, areaLocksFor, areaStats, calibrationFor, chapman, drawnPassOf, incompleteByRound, lastByRoundIn, lastDrawnPassIn, passOf, passesIn, pickAreas } from './rounds.mjs';
import { openFindingsIn } from './carryRecords.mjs';
import { recutsIn } from './recuts.mjs';
import { leftOutIn, retryable } from './leftOut.mjs';
import { abandonedRounds, nightsByRound, recordsFor } from './recordFiles.mjs';
import { continuousOf } from './continuousOf.mjs';
import { readJson } from './json.mjs';
import { lastFinished, liveRuns } from './runs.mjs';
import { agentFor } from './agent/index.mjs';

const NAMES = resolveConfig().names;

/** A run's night directory: the one its record names, or else the one `night.mjs` named for its round. */
const nightDirOf = (run, state) => run.nightDir ?? nightsByRound(state).get(run.round)?.dir ?? null;

/** Each lane with the pass its round has made of the area once matched, as the record will hold it. */
export const withPasses = (lanes, run) => lanes.map((lane) => {
  const { match } = lane.steps;
  if (match.state !== 'done') return lane;
  const { a = 0, b = 0, shared = 0 } = match;
  return { ...lane, pass: passOf(run.round, run.started?.slice(0, 10) ?? '', a, b, shared, a + b - shared) };
});

/** Each area's fixer report that has come home, by area. */
const fixReports = (agent, nightDir, ids) => new Map(nightDir ? ids.flatMap((id) => {
  const file = join(nightDir, 'jobs', id, 'fix', agent.resultFile);
  return existsSync(file) ? [[id, agent.resultOf(readFileSync(file, 'utf8')).reply]] : [];
}) : []);

export { fleetOf, fleetProgressOf, gateFailuresOf, gateNodesOf, gateOutcomesOf, gateRunsOf, rerunOf } from './gate.mjs';

const DEFAULT_GATE = resolveConfig().gate;

/**
 * What one run, live (`running`) or finished, says about its areas; `jobs` are the runner's jobs, running and
 * finished; `sweepId` the config's sweep, whose running job marks `sweepRunning`; `gate` the config's, for `fleet`;
 * `fixAgent` the agent whose result files hold the fixers' reports.
 */
export const readRun = (found, running, jobs = [], state, { names = NAMES, sweepId, gate = DEFAULT_GATE, fixAgent = agentFor(undefined, 'fix') } = {}) => {
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
    usdPerArea: run.usdPerArea ?? null,
    usdPerFile: run.usdPerFile ?? null,
    capUsd: run.capUsd ?? null,
    report: run.report ?? null,
    areas: areaIds,
    stages: Object.fromEntries(nightStages(log, names)),
    leftOut: nightLeftOut(log, run.round, names),
    lanes: withPasses(nightLanes(log, areaIds, running ? own : own.filter((j) => j.finished), fixReports(fixAgent, run.nightDir, areaIds), names), run),
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
  const live = legacy ? (current ? [current] : []) : liveRuns(state);
  // A resumed round is live again beside the summary its earlier run left: it is listed once, as the live run.
  const ended = legacy ? (lastJson && lastJson.round !== current?.round ? lastJson : null) : lastFinished(state);
  const last = ended && !live.some((r) => r.round === ended.round) ? ended : null;
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
 * Every round's night directory (`nightsByRound`'), each `running` while a live run in `runs` holds its round. A round
 * given up for good (`abandonedRounds`) never lands: it is left out.
 */
export const nightsOf = (runs, state) => {
  const live = new Set(runs.filter((r) => r.running).map((r) => r.round));
  const nights = nightsByRound(state);
  const abandoned = abandonedRounds(state, nights);
  return [...nights.values()].filter((n) => !abandoned.has(n.round))
    .map((n) => ({ round: n.round, started: n.started, nightDir: n.dir, running: live.has(n.round) }));
};

/** An area's `lastByRound` (`lastByRoundIn`), left out for an area no round has audited yet. */
const lastByRoundOf = (own, files, calibration) => {
  const entries = lastByRoundIn(own, files, calibration);
  return entries.length ? { lastByRound: entries } : {};
};

/** The whole map for the project at `root` under `cfg`, its runs' jobs asked of `runner`. */
export const buildMap = (cfg, root, runner) => {
  const git = gitIn(root);
  const head = git('rev-parse', '--short', 'HEAD');
  const areas = partitionAt(cfg, root, 'HEAD');
  const records = recordsFor(cfg, git, root);
  const { history: passes, covered, staleLines, pairLines, touched } = areaStats(cfg, git, areas, passesIn(cfg, git, root, records), root);
  const calibration = calibrationFor(passes, pairLines);
  const corrected = (p) => ({ ...p, leftCorrected: correctedLeftOf(p, calibration) });
  const locks = areaLocksFor(cfg, git);
  const { picked, settled } = pickAreas({ areas, passes, covered, staleLines, calibration, touched, count: Infinity, inFlight: new Set(locks.keys()) });
  const settledSet = new Set(settled);
  const runs = readRuns(cfg.state, null, { listJobs: (since) => runner.jobs(since), listProgress: () => runner.progress?.() ?? new Map(), names: cfg.names, sweepId: cfg.sweep?.id, gate: cfg.gate, fixAgent: agentFor(cfg, 'fix') })
    .map((r) => ({ ...r, lanes: r.lanes.map((l) => (l.pass ? { ...l, pass: corrected(l.pass) } : l)) }));
  /** The live run holding each area. */
  const holder = new Map(runs.filter((r) => r.running).flatMap((r) => r.areas.map((id) => [id, r])));
  // A live run's areas are being audited, not waiting, so the queue counts from 1 past them.
  const queue = new Map(picked.filter((id) => !holder.has(id)).map((id, i) => [id, i + 1]));
  const icons = areaIcons(iconsFor(cfg, root), areas);
  const open = openFindingsIn(cfg, git, root, records, areas);

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
      last: lastDrawnPassIn(own, calibration) ?? null,
      ...lastByRoundOf(own, area.files, calibration),
      stage: run ? run.stages[area.id] ?? 'queued' : null,
      ...(stale ? { staleLines: stale } : {}),
      // Held by an earlier round's unmerged branch, rather than by a live run, which `status` already says.
      ...(locks.has(area.id) && !run ? { locked: locks.get(area.id) } : {}),
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
      if (raw.unmerged) r.pending = 'unmerged';
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
  for (const [round, incomplete] of incompleteByRound(records.filter((r) => !r.ref))) {
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
    recuts: recutsIn(cfg, git, root, areas),
    leftOut: retryable(git, leftOutIn(cfg.state), cfg.git.main).map((e) => ({ area: cfg.names.idOf(e.branch), round: e.round, why: e.why })),
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

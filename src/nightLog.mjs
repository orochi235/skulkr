/**
 * What a night's log (`night.log`, the lines `night.mjs` prints as jobs finish) says of each area: its lane of steps
 * and the furthest stage it reached, read in one pass, and the branches its batch left out. Functions taking `names`
 * take the config's `names`; the default is the default config's.
 */
import { resolveConfig } from './config.mjs';
import { fixTallyOf } from './findings.mjs';

const NAMES = resolveConfig().names;

const LANE_STEPS = ['A', 'B', 'match', 'fix', 'patch'];
const waitingSteps = () => Object.fromEntries(LANE_STEPS.map((s) => [s, { state: 'waiting' }]));

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
  else if ((m = /^repair \S+ (\S+) on (\S+): (\d+) commits, ([\d.]+) min; verify (passed)?/.exec(line))) {
    // A capstone or conflict repair gets one try: one that fails its verify drops the branch from the batch.
    const once = m[1].startsWith('capstone') ? 'capstone' : m[1] === 'conflict' ? 'conflict' : null;
    const failed = once ? { state: 'failed', outcome: 'failed', why: `${once} repair failed its verify` } : { state: 'running', outcome: 'failed' };
    // A resumed round logs a reused repair's line again, so a numbered attempt counts once.
    const nth = /^(\d+)\/\d+$/.exec(m[1]);
    Object.assign(step, {
      attempts: nth ? Math.max(step.attempts ?? 0, Number(nth[1])) : (step.attempts ?? 0) + 1, node: m[2], minutes: Number(((step.minutes ?? 0) + Number(m[4])).toFixed(1)),
      ...(m[5] ? { state: 'done', outcome: 'passed' } : failed),
    });
  } else if ((m = /^repair \S+ capstone: not started, (.+)$/.exec(line))) Object.assign(step, { state: 'failed', outcome: 'failed', why: `capstone repair not started: ${m[1]}` });
  else if (/^repair \S+ capstone failed:/.test(line)) Object.assign(step, { state: 'failed', outcome: 'failed', why: 'capstone repair crashed' });
};

/** What a lane's patch step says of a branch merged after its conflict: by a conflict repair, or outside skulkr. */
export const RESOLVED_BY_REPAIR = 'merged after a conflict repair';
export const RESOLVED_OUTSIDE = 'merged outside skulkr';

/** `patch` (a lane's patch step) as done, its branch merged despite the conflict that failed it, `resolved` saying how. */
const resolvePatch = (patch, resolved) => {
  delete patch.why;
  return Object.assign(patch, { state: 'done', resolved });
};

/** The areas a `capstone: N failures; <area> <n>, …` line lays the gate's failures at (`capstone.mjs`), each about to
 *  be repaired. */
const capstoneLaid = (line) => {
  const m = /^capstone: \d+ failures; (.+?)(?:; \d+ unattributed)?$/.exec(line);
  if (!m || m[1] === 'none laid at a branch') return [];
  return m[1].split(', ').flatMap((part) => /^(\S+) \d+$/.exec(part)?.[1] ?? []);
};

/**
 * Every area the log names: `steps`, a Map by id of its lane's steps as the log alone tells them (a done fix without
 * its report's tally), and `stages`, a Map by id, in the order each first reached one, of the furthest step its lines
 * reach. A stage takes a line's kind alone, so a review line that gives no findings still counts toward `reviewing`;
 * a step needs the line's whole form.
 */
const readLog = (log, names) => {
  const steps = new Map();
  const stages = new Map();
  const at = (id) => {
    if (!steps.has(id)) steps.set(id, waitingSteps());
    return steps.get(id);
  };
  const reviews = new Map();
  for (const line of log.split('\n')) {
    let m;
    let done;
    if ((m = /^review \d+\/\d+ (\S+) ([AB]) /.exec(line))) {
      const n = (reviews.get(m[1]) ?? 0) + 1;
      reviews.set(m[1], n);
      stages.set(m[1], n >= 2 ? 'reviewed' : 'reviewing');
      if ((done = /^review \d+\/\d+ \S+ [AB] on (\S+): (\d+) findings, (\d+)\/(\d+) files read, ([\d.]+) min/.exec(line))) {
        Object.assign(at(m[1])[m[2]], { state: 'done', node: done[1], findings: Number(done[2]), read: Number(done[3]), files: Number(done[4]), minutes: Number(done[5]) });
      }
    } else if ((m = /^match \d+\/\d+ (\S+):/.exec(line))) {
      stages.set(m[1], 'matched');
      if ((done = /^match \d+\/\d+ \S+: (\d+) shared of (\d+) \+ (\d+)/.exec(line))) {
        Object.assign(at(m[1]).match, { state: 'done', shared: Number(done[1]), a: Number(done[2]), b: Number(done[3]) });
      }
    } else if ((m = /^fix \d+\/\d+ (\S+) on /.exec(line))) {
      stages.set(m[1], 'fixed');
      if ((done = /^fix \d+\/\d+ \S+ on (\S+): (\d+) commits, ([\d.]+) min/.exec(line))) {
        Object.assign(at(m[1]).fix, { state: 'done', node: done[1], commits: Number(done[2]), minutes: Number(done[3]) });
      }
    } else if ((m = /^patch (\S+): /.exec(line))) {
      stages.set(m[1], 'patched');
      if ((done = /^patch \S+: (\d+) commits on /.exec(line))) Object.assign(at(m[1]).patch, { state: 'done', commits: Number(done[1]) });
      else if (/^patch \S+: did not apply/.test(line)) Object.assign(at(m[1]).patch, { state: 'failed', why: 'did not apply' });
      else if (/^patch \S+: the capstone repair did not apply/.test(line)) Object.assign((at(m[1]).repair ??= { attempts: 0 }), { state: 'failed', outcome: 'failed', why: 'capstone repair did not apply' });
      else if ((done = /^patch \S+: left out: (.+)$/.exec(line))) Object.assign(at(m[1]).patch, { state: 'failed', why: done[1] });
    } else if ((m = /^(?:verify|repair) ([^\s:]+)/.exec(line))) {
      repairStep(at(m[1]), line);
    } else if (line.startsWith('capstone: ')) {
      for (const id of capstoneLaid(line)) Object.assign((at(id).repair ??= { attempts: 0 }), { state: 'running', outcome: 'failed' });
    } else if ((m = names.resolved(line))) {
      // A conflict repair merged the branch a build of the batch had left out.
      if (stages.get(m.area) === 'conflict') stages.set(m.area, 'patched');
      if (steps.has(m.area)) resolvePatch(at(m.area).patch, RESOLVED_BY_REPAIR);
    } else if ((m = names.leftOut(line)) && !m.earlier) {
      stages.set(m.area, 'conflict');
      Object.assign(at(m.area).patch, { state: 'failed', why: `${m.why}; left out of the batch` });
    }
  }
  return { steps, stages };
};

/** Each area's furthest step in a night's log (`readLog`'s `stages`). */
export const nightStages = (log, names = NAMES) => readLog(log, names).stages;

/** The finished onto job that most likely ran a step the log says took `minutes`: the one whose run is nearest that. */
const bestFinished = (jobs, minutes) => {
  const took = (j) => (Date.parse(j.finished) - Date.parse(j.started)) / 60_000;
  const off = (j) => (minutes === undefined ? -Date.parse(j.finished) : Math.abs(took(j) - minutes));
  return [...jobs].sort((x, y) => off(x) - off(y))[0];
};

/**
 * Each area's lane: for every step of its thread (reviews A and B, match, fix, patch), whether it is done,
 * with what the log says it produced (`readLog`'s `steps`), or running, from `jobs`' `audit<N>-<area>-<step>` onto
 * tasks. A job with no `finished` is running, and gives its step's `since`; a finished one gives a done step its
 * `ended`, and its `started` as that less the minutes the log reports. A done fix takes its report's tally from
 * `reports`, by area.
 */
export const nightLanes = (log, areas, jobs = [], reports = new Map(), names = NAMES) => {
  const { steps: read } = readLog(log, names);
  const lanes = new Map(areas.map((id) => [id, read.get(id) ?? waitingSteps()]));
  const at = (id, step) => lanes.get(id)?.[step];
  for (const [id, steps] of lanes) {
    if (steps.fix.state === 'done') Object.assign(steps.fix, fixTallyOf(reports.get(id) ?? '') ?? {});
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
    // A verify job and a repair job are both the lane's repair step, which says which of them runs.
    const kind = m?.[2];
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
      const { done, total, checks, tests, now } = job.progress ?? {};
      Object.assign(step, { state: 'running', node: job.node, since: job.started, ...(m[2] === 'repair' ? { job: kind } : {}),
        ...(Number.isFinite(total) ? { done, total } : {}),
        ...(checks ? { checks } : {}), ...(tests ? { tests } : {}), ...(now ? { now } : {}) });
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
export const nightLeftOut = (log, round, names = NAMES) => {
  let out = [];
  for (const line of log.split('\n')) {
    const m = names.leftOut(line);
    if (m) out.push({ area: m.area, round: m.earlier ?? round, why: m.why });
    const r = !m && names.resolved(line);
    // A later build's conflict repair merged it.
    if (r) out = out.filter((e) => e.area !== r.area || e.round !== r.round);
  }
  return out;
};

/**
 * `run` (`readRun`'s) with the branches `merged(round, area)` says are in its batch or `main` taken off its conflicts:
 * resolved outside skulkr, by hand after a red round, they are no longer left out, and their lanes' patch steps done.
 */
export const settleMerged = (run, merged) => {
  const conflicted = new Set([
    ...Object.entries(run.stages ?? {}).filter(([, s]) => s === 'conflict').map(([id]) => id),
    ...(run.leftOut ?? []).filter((e) => e.round === run.round).map((e) => e.area),
  ]);
  const settled = new Set([...conflicted].filter((id) => merged(run.round, id)));
  const leftOut = (run.leftOut ?? []).filter((e) => !(e.round === run.round ? settled.has(e.area) : merged(e.round, e.area)));
  if (!settled.size && leftOut.length === (run.leftOut ?? []).length) return run;
  return {
    ...run,
    leftOut,
    stages: Object.fromEntries(Object.entries(run.stages ?? {}).map(([id, s]) => [id, settled.has(id) && s === 'conflict' ? 'patched' : s])),
    lanes: (run.lanes ?? []).map((l) => (settled.has(l.id) && l.steps.patch.state === 'failed'
      ? { ...l, steps: { ...l.steps, patch: resolvePatch({ ...l.steps.patch }, RESOLVED_OUTSIDE) } }
      : l)),
  };
};

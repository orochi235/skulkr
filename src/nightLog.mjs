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
  else if ((m = /^repair \S+ \S+ on (\S+): (\d+) commits, ([\d.]+) min; verify (passed)?/.exec(line))) {
    Object.assign(step, {
      attempts: (step.attempts ?? 0) + 1, node: m[1], minutes: Number(((step.minutes ?? 0) + Number(m[3])).toFixed(1)),
      ...(m[4] ? { state: 'done', outcome: 'passed' } : { state: 'running', outcome: 'failed' }),
    });
  }
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
      else if ((done = /^patch \S+: left out: (.+)$/.exec(line))) Object.assign(at(m[1]).patch, { state: 'failed', why: done[1] });
    } else if ((m = /^(?:verify|repair) ([^\s:]+)/.exec(line))) {
      repairStep(at(m[1]), line);
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

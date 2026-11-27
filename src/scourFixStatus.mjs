/**
 * Where each of a ledger's defects stands in `skulkr scour fix`: the batch the plan puts it in, and the latest fix
 * run's verdict on it, read from the runs' records (`<state>/scour/fix-<N>/record.json`). For the Scour page's shelf.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scourStateDirOf } from './scourPaths.mjs';
import { FLAGGED, scourFlagsOf } from './scourFlags.mjs';
import { fixStagesIn } from './scourFixStage.mjs';
import { fixPlanFor } from './scourTriage.mjs';

/** Every fix run in the state directory, oldest first: its number, its directory, its record (null before its first
 *  batch ends), and the batches it has jobs out for. */
export const fixRunsIn = (cfg) => {
  const dir = scourStateDirOf(cfg);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const n = Number(/^fix-(\d+)$/.exec(name)?.[1]);
    if (!n) return [];
    const at = join(dir, name);
    let record = null;
    try { record = JSON.parse(readFileSync(join(at, 'record.json'), 'utf8')); } catch { /* not written yet */ }
    const jobs = existsSync(join(at, 'jobs')) ? readdirSync(join(at, 'jobs')) : [];
    return [{ n, dir: at, record, jobs }];
  }).sort((a, b) => a.n - b.n);
};

/**
 * Each defect's fix status for ledger `area` from the `runs` (`fixRunsIn`): the latest run's verdict (`fixed`, `not a
 * defect`, `question`, `not fixed`, `duplicate`, or `unread` when its line could not be read), with the run, branch, and
 * whether the batch's verify passed.
 * A batch with a job out in an unfinished run that has not recorded it is entered as `b<k>`, `fixing`. A defect no run
 * has touched has no entry.
 */
export const fixStatusesFor = (area, runs) => {
  const out = {};
  for (const run of runs) {
    const done = new Set();
    if (run.record?.area === area) {
      for (const b of run.record.batches ?? []) {
        done.add(b.n);
        for (const v of b.verdicts ?? []) out[v.id] = { status: v.verdict ?? 'unread', run: run.n, branch: b.branch ?? null, verified: b.verify?.ok === true };
      }
    }
    if (run.record?.finished) continue;
    for (const job of run.jobs) {
      const m = new RegExp(`^${area.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}~b(\\d+)$`).exec(job);
      if (!m || done.has(Number(m[1]))) continue;
      // Which defects the batch holds is the plan's to say (`fixShelfOf`); the record has none of an unfinished batch.
      out[`b${m[1]}`] = { status: 'fixing', run: run.n, branch: null };
    }
  }
  return out;
};

/** The latest fix run (a flush) on ledger `area` from the `runs` (`fixRunsIn`): its number, when it started, and when it
 *  finished, null while it runs; null when no run has touched the area. A run counts from its record, or before its
 *  first batch ends, from a job out on the area. */
export const lastFixRunOf = (area, runs) => {
  const jobOn = new RegExp(`^${area.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}~b\\d+$`);
  const run = runs.filter((r) => r.record?.area === area || (!r.record && r.jobs.some((j) => jobOn.test(j)))).at(-1);
  if (!run) return null;
  return { n: run.n, started: run.record?.started ?? null, finished: run.record?.finished ?? null };
};

/** A ledger's shelf: its plan's batches (ids in order, with each one's size and whether it recurs), what goes to ask,
 *  and each defect's fix status, with its `stage` (`fixStagesIn`) while its batch is out, and `flagged for repair` (with
 *  the `verdict` it overrides) where a person flagged it (`scourFlags.mjs`). */
export const fixShelfOf = (cfg, ledger, runs = fixRunsIn(cfg), flags = scourFlagsOf(cfg)) => {
  if (ledger.defects.length === 0) return null;
  const plan = fixPlanFor(ledger, { recurrent: cfg.saturate.recurrent });
  const statuses = fixStatusesFor(ledger.area, runs);
  // A batch out with no record yet names no ids; the plan, computed the same way, says which they are, and its job
  // directory where each one stands.
  for (const b of plan.batches) {
    const out = statuses[`b${b.n}`];
    if (out?.status !== 'fixing') continue;
    const dir = runs.find((r) => r.n === out.run)?.dir;
    const stages = fixStagesIn(dir ? join(dir, 'jobs', `${ledger.area}~b${b.n}`) : null, b.defects.map((d) => d.id));
    for (const d of b.defects) statuses[d.id] ??= { ...out, stage: stages[d.id] };
    delete statuses[`b${b.n}`];
  }
  // A person's flag outranks a fix run's verdict: the verdict is what is in doubt.
  for (const id of flags[ledger.area] ?? []) {
    const was = statuses[id];
    statuses[id] = { status: FLAGGED, run: was?.run ?? null, branch: was?.branch ?? null, verdict: was?.status ?? null };
  }
  return {
    lastRun: lastFixRunOf(ledger.area, runs),
    batches: plan.batches.map((b) => ({ n: b.n, defects: b.defects.map((d) => ({ id: d.id, size: d.size ?? null, recurrent: d.recurrent })) })),
    ask: plan.ask.map((d) => d.id),
    statuses,
  };
};

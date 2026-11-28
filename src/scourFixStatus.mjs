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

export const VERDICTS = ['not a defect', 'not fixed', 'duplicate', 'question', 'fixed'];

/**
 * A fixer's verdict line's verdict and where in the line it starts (`{ verdict, at }`, null and -1 for none): the first
 * verdict after the line's source, `(scour):`, since a claim may hold a verdict's word ("a duplicate id"); else a
 * `fixed <sha>`; else the line's first verdict word.
 */
export const verdictIn = (line) => {
  const lower = String(line ?? '').toLowerCase();
  const first = (from) => VERDICTS.map((v) => ({ verdict: v, at: lower.indexOf(v, from) })).filter((h) => h.at >= 0).sort((a, b) => a.at - b.at)[0];
  const source = /\((?:scour|carried|sweep|a\+b|a|b)\b[^)]*\)\s*:?/.exec(lower);
  const sha = /\bfixed\s+[0-9a-f]{7,40}\b/.exec(lower);
  return (source && first(source.index + source[0].length)) || (sha && { verdict: 'fixed', at: sha.index }) || first(0) || { verdict: null, at: -1 };
};

/** `record` with each verdict read again from its line, so a record written by an older reader reads as today's would. */
export const withVerdictsRead = (record) => (record ? {
  ...record,
  batches: (record.batches ?? []).map((b) => ({ ...b, verdicts: (b.verdicts ?? []).map((v) => (v.line ? { ...v, verdict: verdictIn(v.line).verdict } : v)) })),
} : record);

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
    try { record = withVerdictsRead(JSON.parse(readFileSync(join(at, 'record.json'), 'utf8'))); } catch { /* not written yet */ }
    const jobs = existsSync(join(at, 'jobs')) ? readdirSync(join(at, 'jobs')) : [];
    return [{ n, dir: at, record, jobs }];
  }).sort((a, b) => a.n - b.n);
};

/** What a verdict line says after its verdict, for any verdict but `fixed`: the fixer's reason, `(no longer applies).
 *  On release, …`; null where it gives none. */
export const whyOf = ({ verdict, line }) => {
  if (!verdict || verdict === 'fixed' || !line) return null;
  const { at } = verdictIn(line);
  const rest = at < 0 ? '' : line.slice(at + verdict.length).replace(/^[\s:.,;—–-]+/, '').trim();
  return rest || null;
};

/**
 * Each defect's fix status for `ledger` (its `area` and `commit`) from the `runs` (`fixRunsIn`): the latest run's verdict (`fixed`, `not a
 * defect`, `question`, `not fixed`, `duplicate`, or `unread` when its line could not be read), with the run, branch, and
 * whether the batch's verify passed, and `why`, the fixer's reason for any verdict but `fixed` where it gave one.
 * A batch with a job out in an unfinished run that has not recorded it is entered as `b<k>`, `fixing`. A defect no run
 * has touched has no entry. A run on an earlier ledger of the area counts for nothing: a fresh ledger numbers its
 * defects from D1 again.
 */
export const fixStatusesFor = (ledger, runs) => {
  const { area } = ledger;
  const out = /** @type {Record<string, any>} */ ({});
  for (const run of runs) {
    const done = new Set();
    if (isRunOn(run.record, ledger)) {
      for (const b of run.record.batches ?? []) {
        done.add(b.n);
        for (const v of b.verdicts ?? []) {
          const why = whyOf(v);
          out[v.id] = { status: v.verdict ?? 'unread', run: run.n, branch: b.branch ?? null, verified: b.verify?.ok === true, ...(why ? { why } : {}) };
        }
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

/** Whether a fix run's `record` is of `ledger`: its area, and its ledger's commit where it names one. */
const isRunOn = (record, ledger) => record?.area === ledger.area && (!record.ledgerCommit || !ledger.commit || record.ledgerCommit === ledger.commit);

/** The latest fix run (a flush) on `ledger` from the `runs` (`fixRunsIn`): its number, when it started, and when it
 *  finished, null while it runs; null when no run has touched the area. A run counts from its record, or before its
 *  first batch ends, from a job out on the area. */
export const lastFixRunOf = (ledger, runs) => {
  const jobOn = new RegExp(`^${ledger.area.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}~b\\d+$`);
  const run = runs.filter((r) => isRunOn(r.record, ledger) || (!r.record && r.jobs.some((j) => jobOn.test(j)))).at(-1);
  if (!run) return null;
  return { n: run.n, started: run.record?.started ?? null, finished: run.record?.finished ?? null };
};

/** A ledger's shelf: its plan's batches, less `fixedElsewhere` (`registryFixedIn`'s) as a fix run plans them (ids in order, with each one's size and whether it recurs), what goes to ask,
 *  and each defect's fix status, with its `stage` (`fixStagesIn`) while its batch is out, and `flagged` (with
 *  the `verdict` it overrides) where a person flagged it (`scourFlags.mjs`). */
export const fixShelfOf = (cfg, ledger, runs = fixRunsIn(cfg), flags = scourFlagsOf(cfg), fixedElsewhere = new Set()) => {
  if (ledger.defects.length === 0) return null;
  const plan = fixPlanFor(ledger, { open: (d) => !fixedElsewhere.has(d.id), recurrent: cfg.saturate.recurrent });
  const statuses = fixStatusesFor(ledger, runs);
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
    statuses[id] = { status: FLAGGED, run: was?.run ?? null, branch: was?.branch ?? null, verdict: was?.status ?? null, ...(was?.why ? { why: was.why } : {}) };
  }
  return {
    lastRun: lastFixRunOf(ledger, runs),
    batches: plan.batches.map((b) => ({ n: b.n, defects: b.defects.map((d) => ({ id: d.id, size: d.size ?? null, recurrent: d.recurrent })) })),
    ask: plan.ask.map((d) => d.id),
    statuses,
  };
};

/** The ids of the defects whose registry line (`lines`, by ledger defect id) records them fixed: closed outside a fix
 *  run, by a round's fixer or by hand, so no fix plan hands them to a fixer again. */
export const registryFixedIn = (lines) => new Set([...lines].filter(([, line]) => line?.status === 'fixed').map(([id]) => id));

/** A ledger summary's `defects` as registry lines by id, as `registryFixedIn` takes them. */
export const registryLinesIn = (defects) => new Map(defects.map((d) => [d.id, d.registry]));

/**
 * `shelf` with each defect the registry records fixed (`defects`, a ledger summary's, with their `registry` lines)
 * shown as fixed, where no fix run has fixed it: a round's fixer, or a hand fix, closed it outside skulkr's fix runs.
 */
export const withRegistryFixes = (shelf, defects) => {
  if (!shelf) return shelf;
  const elsewhere = registryFixedIn(registryLinesIn(defects));
  const fixed = defects.filter((d) => elsewhere.has(d.id) && shelf.statuses[d.id]?.status !== 'fixed');
  if (!fixed.length) return shelf;
  const statuses = { ...shelf.statuses };
  for (const d of fixed) statuses[d.id] = { status: 'fixed', run: null, branch: null, verified: true, sha: d.registry.sha ?? null, registry: true };
  return { ...shelf, statuses };
};

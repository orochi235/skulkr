/**
 * What a scour process holding a ledger is doing now, read from that ledger's directory: its lease, the jobs it has
 * out, and the end of its own log. `skulkr scour ls --json` carries it for the dashboard's Scour page.
 */
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { heldAlive, leaseAt } from './lease.mjs';
import { ledgerDirOf } from './ledger.mjs';
import { lineTextOf } from './progress.mjs';
import { scourStateDirOf } from './scourPaths.mjs';

/** The scour process's own log in a ledger's directory, started over by each process that holds the ledger. */
export const scourLogOf = (cfg, area) => join(ledgerDirOf(cfg, area), 'scour.log');

/** `say` that also appends each line to the ledger's `scour.log`, which it first empties unless told to `keep` it. */
export const loggingSay = (cfg, area, say, { keep = false } = {}) => {
  const path = scourLogOf(cfg, area);
  if (!keep) writeFileSync(path, '');
  return (line) => {
    appendFileSync(path, `${new Date().toISOString()} ${line}\n`);
    say(line);
  };
};

const TAIL_BYTES = 32 * 1024;

/** The last `n` non-empty lines of `path`, its terminal colors stripped. */
const lastLines = (path, n) => {
  const { size } = statSync(path);
  const length = Math.min(size, TAIL_BYTES);
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, buffer, 0, length, size - length);
  } finally {
    closeSync(fd);
  }
  const lines = buffer.toString('utf8').split('\n');
  if (length < size) lines.shift();
  return lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trimEnd()).filter(Boolean).slice(-n);
};

const PROGRESS = /^onto: progress (\d+)\/(\d+)/;

/** A job log's `skulkr:` lines worth showing as it works (its commits, notes, findings, tests, hand-offs), the commands
 *  it runs left out; the newest `n`, without the prefix. */
const recentOf = (lines, n = 5) => lines.filter((l) => l.startsWith('skulkr: ') && !l.startsWith('skulkr: running:'))
  .slice(-n).map((l) => lineTextOf(l.slice('skulkr: '.length)));

/** The log in job directory `dir` written last (`f`, its name, with its `stat`), whose name is the step the job is on;
 *  null before any. */
export const newestLogIn = (dir) => {
  if (!existsSync(dir)) return null;
  return readdirSync(dir).filter((f) => f.endsWith('.log'))
    .map((f) => ({ f, ...statSync(join(dir, f)) }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0] ?? null;
};

/**
 * Each job a scour process has out, from its occasion directories under `jobs/`: the occasion's key, the step its
 * newest log is for (`review`, `match1`, …), when that log last changed, its last line worth reading, its last few
 * `skulkr:` lines (`recent`), and onto's
 * progress counter where the job prints one.
 */
const jobsIn = (dir) => {
  const root = join(dir, 'jobs');
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name)).flatMap((occasion) => {
    const newest = newestLogIn(join(root, occasion.name));
    if (!newest) return [{ key: occasion.name, step: null, at: null, line: null, recent: [], progress: null }];
    const lines = newest.size ? lastLines(join(root, occasion.name, newest.f), 40) : [];
    const counter = lines.findLast((l) => PROGRESS.test(l))?.match(PROGRESS);
    return [{
      key: occasion.name,
      step: newest.f.replace(/\.log$/, ''),
      at: new Date(newest.mtimeMs).toISOString(),
      line: lines.findLast((l) => !PROGRESS.test(l)) ?? null,
      recent: recentOf(lines),
      progress: counter ? { done: Number(counter[1]), of: Number(counter[2]) } : null,
    }];
  });
};

/** A fix run's batches still out, keyed `b<k>`: its job directories stay after a batch ends, and its record holds a
 *  batch once it has. */
const fixJobsIn = (runDir) => {
  const path = join(runDir, 'record.json');
  let done = new Set();
  try {
    done = new Set(JSON.parse(readFileSync(path, 'utf8')).batches.map((b) => `b${b.n}`));
  } catch { /* no record yet */ }
  return jobsIn(runDir).map((j) => ({ ...verifyingOf(j), key: j.key.replace(/^.*~/, '') })).filter((j) => !done.has(j.key));
};

const VERIFYING = /^skulkr: verifying the fixer/;
const ON_FLEET = /^skulkr: on the fleet as (\S+)/;

/**
 * A job as the Scour page reads it: `fleet`, the fleet task its last line hands work to, where it does; and a fix or
 * repair job whose last line hands its commits to their verify, as on that verify: `step` `verify`, `of` the step it
 * verifies, and no progress until the fleet's is added (the log's last counter is the fixer's commits).
 */
export const verifyingOf = (job) => {
  const fleet = ON_FLEET.exec(job.line ?? '')?.[1] ?? null;
  const handed = job.step && /^(fix|repair-.+)$/.test(job.step) && (fleet || VERIFYING.test(job.line ?? ''));
  if (handed) return { ...job, step: 'verify', of: job.step, fleet, progress: null };
  return fleet ? { ...job, fleet } : job;
};

/**
 * `list`'s (`ledgerListOf`'s) live jobs with what `progress` (a runner's `progress()`: task to `{ done, total, tests,
 * checks }`) knows of them: a job on the fleet takes its fleet task's count; any other, the runner's own job for that
 * batch and step (a task ending `<area>~<key>-<step>`), its count where the log gave none, and its `tests` and `checks`.
 */
export const withJobProgress = (list, progress) => list.map((l) => {
  if (!l.running?.jobs.length || progress.size === 0) return l;
  const own = (j) => [...progress].find(([task]) => task.endsWith(`${l.area}~${j.key}-${(j.of ?? j.step ?? '').replace(/^verify-.*/, 'verify')}`))?.[1];
  return {
    ...l,
    running: { ...l.running, jobs: l.running.jobs.map((j) => {
      const fleet = j.fleet ? progress.get(j.fleet) : undefined;
      if (fleet?.total) return { ...j, progress: { done: fleet.done, of: fleet.total } };
      const p = own(j);
      if (!p) return j;
      return {
        ...j,
        ...(j.progress === null && j.step !== 'verify' && p.total ? { progress: { done: p.done, of: p.total } } : {}),
        ...(p.tests ? { tests: p.tests } : {}),
        ...(p.checks ? { checks: p.checks } : {}),
      };
    }) },
  };
});

/**
 * What the live process holding ledger `id` is doing: its `pid`, `since` it took the ledger, what it `does` (`delve`,
 * `fold`, `ingest`, `fix`, or null for a process that did not say), the occasion cap it runs to (a fix run's batches), its jobs out, and the last
 * `n` lines of its `scour.log`; null when no live process holds it.
 */
export const liveScourOf = (cfg, id, n = 8) => {
  const dir = ledgerDirOf(cfg, id);
  const lease = leaseAt(join(dir, 'lock'));
  if (!heldAlive(lease)) return null;
  const log = scourLogOf(cfg, id);
  // A fix run keeps its jobs in its own run directory (`fix-<N>`), one per batch, keyed `b<k>`.
  const jobs = lease.jobs ? fixJobsIn(join(scourStateDirOf(cfg), lease.jobs)) : jobsIn(dir);
  return {
    pid: lease.pid,
    since: lease.at,
    does: lease.does ?? null,
    max: lease.max ?? null,
    jobs,
    log: existsSync(log) && statSync(log).mtimeMs >= Date.parse(lease.at) ? lastLines(log, n) : [],
  };
};

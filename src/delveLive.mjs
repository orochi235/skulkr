/**
 * What a scour process holding a ledger is doing now, read from that ledger's directory: its lease, the jobs it has
 * out, and the end of its own log. `skulkr scour ls --json` carries it for the dashboard's Scour page.
 */
import { appendFileSync, closeSync, existsSync, openSync, readSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { heldAlive, leaseAt } from './lease.mjs';
import { ledgerDirOf } from './ledger.mjs';
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

/**
 * Each job a scour process has out, from its occasion directories under `jobs/`: the occasion's key, the step its
 * newest log is for (`review`, `match1`, …), when that log last changed, its last line worth reading, and onto's
 * progress counter where the job prints one.
 */
const jobsIn = (dir) => {
  const root = join(dir, 'jobs');
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name)).flatMap((occasion) => {
    const logs = readdirSync(join(root, occasion.name)).filter((f) => f.endsWith('.log'))
      .map((f) => ({ f, ...statSync(join(root, occasion.name, f)) }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (!logs.length) return [{ key: occasion.name, step: null, at: null, line: null, progress: null }];
    const newest = logs[0];
    const lines = newest.size ? lastLines(join(root, occasion.name, newest.f), 40) : [];
    const counter = lines.findLast((l) => PROGRESS.test(l))?.match(PROGRESS);
    return [{
      key: occasion.name,
      step: newest.f.replace(/\.log$/, ''),
      at: new Date(newest.mtimeMs).toISOString(),
      line: lines.findLast((l) => !PROGRESS.test(l)) ?? null,
      progress: counter ? { done: Number(counter[1]), of: Number(counter[2]) } : null,
    }];
  });
};

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
  const jobs = lease.jobs ? jobsIn(join(scourStateDirOf(cfg), lease.jobs)).map((j) => ({ ...j, key: j.key.replace(/^.*~/, '') })) : jobsIn(dir);
  return {
    pid: lease.pid,
    since: lease.at,
    does: lease.does ?? null,
    max: lease.max ?? null,
    jobs,
    log: existsSync(log) && statSync(log).mtimeMs >= Date.parse(lease.at) ? lastLines(log, n) : [],
  };
};

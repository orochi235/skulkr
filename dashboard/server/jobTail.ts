/** The end of an area's newest job log in a round, for the dashboard's live tail. */
import { execFile } from 'node:child_process';
import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** How much of a log's end is read: enough for its last lines, however long the file grows. */
const TAIL_BYTES = 128 * 1024;

/** The progress protocol's counters, which the lane already draws. */
const COUNTER = /^onto: (progress|failed) \d+\/\d+/;

/** The line a job sending its work to the onto fleet writes once onto has its task (`onFleetScript`). */
const ON_FLEET = /^skulkr: on the fleet as (\S+)$/;

/** How long `onto logs` may take before the tail answers without the fleet's lines. */
const FLEET_TIMEOUT_MS = 5_000;

/** What the tail route answers: the log's path under the area's job dir, when it last changed, and its last lines;
 *  with `fleet`, the onto task its newest lines hand the work to, whose own last lines follow. */
export interface JobTail {
  readonly file: string;
  readonly at: string;
  readonly lines: readonly string[];
  readonly fleet?: string;
}

/** The last `n` lines onto has of fleet task `task`, or none where it cannot say in time. */
export type FleetLines = (task: string, n: number) => Promise<string[]>;

/** {@link FleetLines} from `onto logs --tail`. */
export const ontoLines: FleetLines = (task, n) => new Promise((done) => {
  execFile('onto', ['logs', '--tail', String(n), '--task', task], { timeout: FLEET_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
    done(error && !stdout ? [] : stdout.split('\n').map(plain).filter(Boolean).slice(-n));
  });
});

/** A log line without its terminal colors or trailing space. */
const plain = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, '').trimEnd();

/** The `.log` files in `dir` and one directory below it, a job's own log and the verify logs its directory keeps. */
function logsIn(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.log')) found.push(path);
    else if (entry.isDirectory()) {
      for (const inner of readdirSync(path, { withFileTypes: true })) {
        if (inner.isFile() && inner.name.endsWith('.log')) found.push(join(path, inner.name));
      }
    }
  }
  return found;
}

/** The last `n` lines of `path` worth reading, protocol counters left out. */
export function lastLines(path: string, size: number, n: number): string[] {
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
  return lines.map(plain).filter((l) => l && !COUNTER.test(l)).slice(-n);
}

/**
 * Area `id`'s most recently written job log in the round at `nightDir`, its last `n` lines; null with none written.
 * Where that log's last line hands the job to the fleet, the fleet task's own last `n` lines follow, from `fleet`.
 */
export async function jobTailOf(nightDir: string, id: string, n = 40, fleet: FleetLines = ontoLines): Promise<JobTail | null> {
  const dir = join(nightDir, 'jobs', id);
  let logs: { path: string; size: number; mtimeMs: number }[];
  try {
    logs = logsIn(dir).map((path) => ({ path, ...statSync(path) })).filter((l) => l.size > 0);
  } catch {
    return null;
  }
  const newest = logs.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  if (!newest) return null;
  const lines = lastLines(newest.path, newest.size, n);
  const task = ON_FLEET.exec(lines.at(-1) ?? '')?.[1];
  const tail = { file: relative(dir, newest.path), at: new Date(newest.mtimeMs).toISOString(), lines };
  return task ? { ...tail, fleet: task, lines: [...lines, ...await fleet(task, n)] } : tail;
}

/** The end of the round at `nightDir`'s own log, `night.log`, its last `n` lines; null before it has one. */
export function nightLogTailOf(nightDir: string, n = 300): JobTail | null {
  const path = join(nightDir, 'night.log');
  try {
    const { size, mtimeMs } = statSync(path);
    return { file: 'night.log', at: new Date(mtimeMs).toISOString(), lines: lastLines(path, size, n) };
  } catch {
    return null;
  }
}

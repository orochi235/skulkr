/**
 * The local runner: every job runs on this machine, in a clone of the project kept under `<state>/trees/`. Each clone
 * shares the project's objects (`git clone --shared`) and is reset to the job's commit before it runs, keeping
 * `node_modules` so an install happens only when the lockfile changes. The clones are a pool, one per job running at
 * once, so their count is bounded by the config's slots.
 */
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { JOB_IN } from '../config.mjs';
import { readJson, writeJson } from '../json.mjs';
import { amendLease, heldAlive, takeLease } from '../lease.mjs';

/** How long a finished job's record is kept for `jobs()`. */
const KEEP_JOBS_MS = 7 * 24 * 3_600_000;

const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A runner duration (`55m`, `90s`, `2h`) in milliseconds, or undefined. */
export const durationMs = (d) => {
  const m = /^(\d+(?:\.\d+)?)([smh])$/.exec(String(d ?? ''));
  return m ? Number(m[1]) * { s: 1_000, m: 60_000, h: 3_600_000 }[m[2]] : undefined;
};

/** Leases a tree of the pool, cloning it the first time. Answers `{ dir, lease, release }`, `lease` the lease's path. */
const leaseTree = (state, source) => {
  const pool = join(state, 'trees');
  for (let k = 1; ; k++) {
    const dir = join(pool, `t${k}`);
    const lease = join(pool, `t${k}.lease`);
    const release = takeLease(lease, {});
    if (!release) continue;
    try {
      if (!existsSync(join(dir, '.git'))) {
        rmSync(dir, { recursive: true, force: true });
        execFileSync('git', ['clone', '-q', '--shared', '--no-checkout', source, dir], { stdio: 'ignore' });
      }
    } catch (error) {
      release();
      throw error;
    }
    return { dir, lease, release };
  }
};

/** Makes `dir` hold exactly `ref`'s tree plus what `from` has that git does not track (its `.skulkr/in` above all). */
const syncTree = (dir, from, ref) => {
  git(dir, ['checkout', '-q', '-f', '--detach', ref]);
  git(dir, ['clean', '-ffdqx', '-e', 'node_modules']);
  const untracked = execFileSync('git', ['-C', from, 'ls-files', '-o', '--exclude-standard', '-z'], { encoding: 'utf8' })
    .split('\0').filter(Boolean);
  for (const path of untracked) cpSync(join(from, path), join(dir, path), { recursive: true });
  if (existsSync(join(from, JOB_IN))) cpSync(join(from, JOB_IN), join(dir, JOB_IN), { recursive: true });
};

/** How long a timed-out job's process group has after SIGTERM before it gets SIGKILL. */
const KILL_GRACE_MS = 30_000;

const signalGroup = (pid, signal) => {
  try {
    process.kill(-pid, signal);
  } catch { /* already gone */ }
};

/** The process groups of the jobs running now, each killed when this process exits or is signaled to. */
const running = new Set();
let reaping = false;
const reapOnExit = () => {
  if (reaping) return;
  reaping = true;
  const reap = () => {
    for (const pid of running) signalGroup(pid, 'SIGTERM');
  };
  process.on('exit', reap);
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.once(signal, () => {
      reap();
      process.kill(process.pid, signal);
    });
  }
};

/**
 * Runs `bash -lc shell` in `cwd` as a process group of its own, its output to `log`, killed with its children after
 * `timeoutMs`: SIGTERM, then SIGKILL `graceMs` later if it has not closed. `onSpawn(pid)` hears the group's id.
 * Answers the exit status.
 */
const runShell = (shell, { cwd, env, log, timeoutMs, graceMs = KILL_GRACE_MS, onSpawn, onProgress }) =>
  new Promise((done) => {
    reapOnExit();
    const child = spawn('bash', ['-lc', shell], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    if (child.pid) {
      running.add(child.pid);
      onSpawn?.(child.pid);
    }
    child.stdout.pipe(log, { end: false });
    if (onProgress) child.stdout.on('data', (chunk) => {
      const last = latestProgress(String(chunk));
      if (last) onProgress(last);
    });
    child.stderr.pipe(log, { end: false });
    let kill;
    const timer = timeoutMs && setTimeout(() => {
      log.write(`\nskulkr local runner: timed out after ${timeoutMs / 60_000} min\n`);
      signalGroup(child.pid, 'SIGTERM');
      kill = setTimeout(() => signalGroup(child.pid, 'SIGKILL'), graceMs);
    }, timeoutMs);
    child.on('error', (error) => {
      log.write(`${error}\n`);
      done(1);
    });
    child.on('close', (status) => {
      running.delete(child.pid);
      clearTimeout(timer);
      clearTimeout(kill);
      done(status ?? 1);
    });
  });

/** The last `onto: progress N/M` count in `text`, the protocol a job's progress filter speaks, as `{ done, total }`. */
export const latestProgress = (text) => {
  const all = [...text.matchAll(/^onto: progress (\d+)\/(\d+)\b/gm)];
  const m = all.at(-1);
  return m ? { done: Number(m[1]), total: Number(m[2]) } : undefined;
};

/** Deletes the job records in `dir` older than {@link KEEP_JOBS_MS}, and answers the names of the rest. */
const pruneJobs = (dir) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => {
    const path = join(dir, name);
    try {
      if (Date.now() - statSync(path).mtimeMs <= KEEP_JOBS_MS) return true;
      rmSync(path, { force: true });
    } catch { /* gone already */ }
    return false;
  });
};

/**
 * The runner interface (documented in `onto.mjs`), with every job on this machine as node `local`. `graceMs`: how long
 * a timed-out job has between SIGTERM and SIGKILL.
 */
export const createLocalRunner = (cfg, { graceMs } = {}) => {
  const jobsDir = join(cfg.state, 'local-jobs');
  const record = (file, job) => writeJson(join(jobsDir, file), job);
  const listed = (since) => {
    const after = Date.parse(since);
    const out = [];
    for (const name of pruneJobs(jobsDir)) {
      let j = readJson(join(jobsDir, name));
      if (!j) continue;
      if (j.state === 'running' && !heldAlive(j)) j = { ...j, state: 'failed', finished: j.started };
      if (j.state === 'running' || Date.parse(j.finished) >= after || !Number.isFinite(after)) out.push(j);
    }
    return out;
  };
  return {
    run: async (job, { cwd, log }) => {
      pruneJobs(jobsDir);
      const file = `${Date.now()}-${process.pid}-${job.task.replace(/[^\w.-]+/g, '_')}.json`;
      const entry = { task: job.task, node: 'local', state: 'running', started: new Date().toISOString(), pid: process.pid };
      record(file, entry);
      let status = 1;
      let tree;
      try {
        tree = leaseTree(cfg.state, git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
        syncTree(tree.dir, cwd, job.ref ?? git(cwd, ['rev-parse', 'HEAD']));
        // A job outliving this process (killed with SIGKILL) keeps its tree and its record alive by its group.
        const onSpawn = (group) => {
          amendLease(tree.lease, { group });
          entry.group = group;
          record(file, entry);
        };
        const onProgress = (progress) => {
          entry.progress = progress;
          record(file, entry);
        };
        status = await runShell(job.shell, { cwd: tree.dir, env: job.env, log, timeoutMs: durationMs(job.timeout), graceMs, onSpawn, onProgress });
        const out = join(tree.dir, job.out);
        if (existsSync(out)) cpSync(out, job.to, { recursive: true });
      } catch (error) {
        log.write(`skulkr local runner: ${error.message ?? error}\n`);
      } finally {
        tree?.release();
        const { progress: _, ...ended } = entry;
        record(file, { ...ended, state: status === 0 ? 'done' : 'failed', exit: status, finished: new Date().toISOString() });
      }
      return { status, busy: false, refused: false };
    },
    unavailableNodes: () => new Set(),
    routesLocal: true,
    jobs: (since) => listed(since),
    progress: () => new Map(listed(new Date().toISOString()).flatMap((j) => (j.state === 'running' && j.progress ? [[j.task, j.progress]] : []))),
  };
};

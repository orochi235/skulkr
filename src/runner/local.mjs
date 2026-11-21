/**
 * The local runner: every job runs on this machine, in a clone of the project kept under `<state>/trees/`. Each clone
 * shares the project's objects (`git clone --shared`) and is reset to the job's commit before it runs, keeping
 * `node_modules` so an install happens only when the lockfile changes. The clones are a pool, one per job running at
 * once, so their count is bounded by the config's slots.
 */
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JOB_IN } from '../config.mjs';
import { heldAlive, takeLease } from '../lease.mjs';

/** How long a finished job's record is kept for `jobs()`. */
const KEEP_JOBS_MS = 7 * 24 * 3_600_000;

const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A runner duration (`55m`, `90s`, `2h`) in milliseconds, or undefined. */
export const durationMs = (d) => {
  const m = /^(\d+(?:\.\d+)?)([smh])$/.exec(String(d ?? ''));
  return m ? Number(m[1]) * { s: 1_000, m: 60_000, h: 3_600_000 }[m[2]] : undefined;
};

/** Leases a tree of the pool, cloning it the first time. Answers `{ dir, release }`. */
const leaseTree = (state, source) => {
  const pool = join(state, 'trees');
  for (let k = 1; ; k++) {
    const dir = join(pool, `t${k}`);
    const release = takeLease(join(pool, `t${k}.lease`), {});
    if (!release) continue;
    if (!existsSync(join(dir, '.git'))) {
      rmSync(dir, { recursive: true, force: true });
      execFileSync('git', ['clone', '-q', '--shared', '--no-checkout', source, dir], { stdio: 'ignore' });
    }
    return { dir, release };
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

/** Runs `bash -lc shell` in `cwd`, its output to `log`, killed with its children after `timeoutMs`. Answers the exit status. */
const runShell = (shell, { cwd, env, log, timeoutMs }) =>
  new Promise((done) => {
    const child = spawn('bash', ['-lc', shell], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    const timer = timeoutMs && setTimeout(() => {
      log.write(`\nskulkr local runner: timed out after ${timeoutMs / 60_000} min\n`);
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch { /* already gone */ }
    }, timeoutMs);
    child.on('error', (error) => {
      log.write(`${error}\n`);
      done(1);
    });
    child.on('close', (status) => {
      if (timer) clearTimeout(timer);
      done(status ?? 1);
    });
  });

/** The runner interface (documented in `onto.mjs`), with every job on this machine as node `local`. */
export const createLocalRunner = (cfg) => {
  const jobsDir = join(cfg.state, 'local-jobs');
  const record = (file, job) => {
    mkdirSync(jobsDir, { recursive: true });
    writeFileSync(join(jobsDir, file), JSON.stringify(job));
  };
  return {
    run: async (job, { cwd, log }) => {
      const source = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
      const tree = leaseTree(cfg.state, source);
      const file = `${Date.now()}-${process.pid}-${job.task.replace(/[^\w.-]+/g, '_')}.json`;
      const entry = { task: job.task, node: 'local', state: 'running', started: new Date().toISOString(), pid: process.pid };
      record(file, entry);
      let status = 1;
      try {
        syncTree(tree.dir, cwd, job.ref ?? git(cwd, ['rev-parse', 'HEAD']));
        status = await runShell(job.shell, { cwd: tree.dir, env: job.env, log, timeoutMs: durationMs(job.timeout) });
        const out = join(tree.dir, job.out);
        if (existsSync(out)) cpSync(out, job.to, { recursive: true });
      } catch (error) {
        log.write(`skulkr local runner: ${error.message ?? error}\n`);
      } finally {
        tree.release();
        record(file, { ...entry, state: status === 0 ? 'done' : 'failed', exit: status, finished: new Date().toISOString() });
      }
      return { status, busy: false, refused: false };
    },
    unavailableNodes: () => new Set(),
    jobs: (since) => {
      if (!existsSync(jobsDir)) return [];
      const after = Date.parse(since);
      const out = [];
      for (const name of readdirSync(jobsDir)) {
        const path = join(jobsDir, name);
        if (Date.now() - statSync(path).mtimeMs > KEEP_JOBS_MS) {
          rmSync(path, { force: true });
          continue;
        }
        let j;
        try {
          j = JSON.parse(readFileSync(path, 'utf8'));
        } catch {
          continue;
        }
        if (j.state === 'running' && !heldAlive(j)) j = { ...j, state: 'failed', finished: j.started };
        if (j.state === 'running' || Date.parse(j.finished) >= after || !Number.isFinite(after)) out.push(j);
      }
      return out;
    },
  };
};

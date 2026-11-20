/**
 * The nightly audit as a long-running service: requests on stdin, replies on stdout, one JSON object per line.
 * Everything else goes to stderr, which the service host (onto, launchd, …) keeps as its log. README.md "The service"
 * says how to bring it up and what each request does.
 */
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { after } from './after.mjs';
import { mainCheckout } from './batch.mjs';
import { lastFinished, lastStartedAt, liveRuns, requestStop } from './runs.mjs';
import { handle, msUntil, shouldAutoStart } from './serviceCore.mjs';

/**
 * The skulk each run starts: `SKULK_BIN` (a checkout's `bin/skulk.mjs`, so runs pick up its latest code without the
 * service's tree being synced), else this one.
 */
const BIN = process.env.SKULK_BIN ?? fileURLToPath(new URL('../bin/skulk.mjs', import.meta.url));
const log = (line) => process.stderr.write(`${new Date().toISOString()} ${line}\n`);

/** Runs the service for `cfg` until its stdin closes. Each run is `skulk night` from the project's main checkout. */
export const serve = (cfg) => {
  const root = mainCheckout(cfg);
  const state = cfg.state;
  /** Every run starts from the same config and checkout as this service. */
  const base = ['--config', cfg.file, '--root', root];
  const env = { ...process.env, SKULK_CONFIG: cfg.file, SKULK_ROOT: root };

  /** The runs this service started that have not exited, by pid, with the last line each printed. */
  const children = new Map();
  let startedHere;

  /** A run this service started counts before it has claimed its round, so the start-time check never starts a second. */
  const anyRunning = () => children.size > 0 || liveRuns(state).length > 0;

  const lastStarted = () => {
    const times = [lastStartedAt(state), startedHere].filter(Boolean);
    return times.length ? new Date(Math.max(...times)) : undefined;
  };

  const start = (args) => {
    startedHere = new Date();
    const child = spawn(process.execPath, [BIN, 'night', ...base, ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const entry = { lastLine: '' };
    children.set(child.pid, entry);
    log(`run started: skulk night ${args.join(' ')} (pid ${child.pid})`);
    for (const stream of [child.stdout, child.stderr]) {
      createInterface({ input: stream }).on('line', (line) => {
        entry.lastLine = line;
        log(`run ${child.pid}: ${line}`);
      });
    }
    child.on('close', (code) => {
      log(`run ${child.pid} exited ${code}`);
      children.delete(child.pid);
    });
    return args;
  };

  const deps = {
    build: (() => {
      try {
        return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
      } catch {
        return 'unknown';
      }
    })(),
    live: () => liveRuns(state).map((r) => r.round),
    status: () => {
      const runs = liveRuns(state).map((r) => (children.has(r.pid) ? { ...r, lastLine: children.get(r.pid).lastLine } : r));
      return { running: runs.length > 0, runs, last: lastFinished(state) ?? null };
    },
    plan: () =>
      new Promise((done) => {
        execFile(process.execPath, [BIN, 'night', ...base, '--dry'], { cwd: root, env }, (error, stdout, stderr) => {
          done((error ? `${stdout}${stderr}` : stdout).trim().split('\n'));
        });
      }),
    start,
    stop: (rounds) => {
      for (const round of rounds) requestStop(round, state);
      log(`stop requested for round ${rounds.join(', ')}`);
    },
  };

  const autoStart = () => {
    if (shouldAutoStart({ now: new Date(), running: anyRunning(), lastStarted: lastStarted(), startAt: cfg.schedule.startAt })) start([]);
  };

  const schedule = () => {
    const wait = msUntil(new Date(), cfg.schedule.startAt);
    log(`next automatic night check in ${(wait / 3_600_000).toFixed(2)} h`);
    after(wait, () => {
      autoStart();
      schedule();
    });
  };

  // No check at startup: a restart (every `onto sync`) never starts a night, only the start-time timer does.
  schedule();

  createInterface({ input: process.stdin }).on('line', async (line) => {
    if (!line.trim()) return;
    const reply = await handle(line, deps);
    process.stdout.write(`${JSON.stringify(reply)}\n`);
  });
};

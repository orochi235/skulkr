/**
 * The nightly audit as a long-running service: requests on stdin, replies on stdout, one JSON object per line.
 * Everything else goes to stderr, which the service host (onto, launchd, …) keeps as its log. It hosts one project
 * or every registered tenant (`host.mjs`). README.md "The service" and "Tenants" say how to bring it up and what each
 * request does.
 */
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { after } from './after.mjs';
import { mainCheckout } from './batch.mjs';
import { loadConfig, nextClock } from './config.mjs';
import { inModelSteps } from './continuous.mjs';
import { continuousOf } from './continuousOf.mjs';
import { createHost } from './host.mjs';
import { lastFinished, lastStartedAt, liveRuns, requestStop, writeContinuous } from './runs.mjs';
import { readTenants, tenantsPath } from './tenants.mjs';

/**
 * The skulkr each run starts: `SKULKR_BIN` (a checkout's `bin/skulkr.mjs`, so runs pick up its latest code without the
 * service's tree being synced), else this one.
 */
const BIN = process.env.SKULKR_BIN ?? fileURLToPath(new URL('../bin/skulkr.mjs', import.meta.url));
const log = (line) => process.stderr.write(`${new Date().toISOString()} ${line}\n`);
/** How often the host rereads the registry and checks each tenant's schedule. */
const TICK_MS = 30_000;

const commitIn = (dir) => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
};

/** One tenant as the host drives it: `cfg`'s project, each run `skulkr night` from its main checkout. */
export const createTenant = (name, cfg, { readOnly = false } = {}) => {
  const root = mainCheckout(cfg);
  const state = cfg.state;
  /** Every run starts from the same config and checkout as this tenant. */
  const base = ['--config', cfg.file, '--root', root];
  const env = { ...process.env, SKULKR_CONFIG: cfg.file, SKULKR_ROOT: root };
  const say = (line) => log(`${name}: ${line}`);

  /** The runs this service started that have not exited, by pid, with the last line each printed. */
  const children = new Map();
  let startedHere;
  /** Set when a continuous round exited without claiming one or failed, so another is not started every tick. */
  let idleUntil;
  /** Rounds this service started that have not claimed a round yet. */
  const pending = () => {
    const live = new Set(liveRuns(state).map((r) => r.pid));
    return [...children.keys()].filter((pid) => !live.has(pid)).length;
  };

  const start = (args, { continuous = false } = {}) => {
    const at = new Date();
    startedHere = at;
    const child = spawn(process.execPath, [BIN, 'night', ...base, ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const entry = { lastLine: '' };
    children.set(child.pid, entry);
    say(`run started: skulkr night ${args.join(' ')} (pid ${child.pid})`);
    for (const stream of [child.stdout, child.stderr]) {
      createInterface({ input: stream }).on('line', (line) => {
        entry.lastLine = line;
        say(`run ${child.pid}: ${line}`);
      });
    }
    child.on('close', (code) => {
      say(`run ${child.pid} exited ${code}`);
      children.delete(child.pid);
      const claimed = (lastStartedAt(state) ?? 0) >= at;
      // A continuous round that found nothing to do, or failed, would only be followed by another like it.
      if (continuous && (!claimed || code !== 0)) {
        idleUntil = nextClock(new Date(), cfg.schedule.stopAt).toISOString();
        say(`continuous: that round ${claimed ? 'failed' : 'found nothing to do'}; no more start until ${idleUntil}`);
      }
    });
    return args;
  };

  return {
    name,
    readOnly,
    startAt: cfg.schedule.startAt,
    /** A run this service started counts before it has claimed its round, so no second one starts beside it. */
    running: () => children.size > 0 || liveRuns(state).length > 0,
    modelBusy: () => pending() > 0 || liveRuns(state).some(inModelSteps),
    scheduledContinuous: Boolean(cfg.schedule.continuous && cfg.budget.nightUsd > 0),
    continuous: (now) => continuousOf(cfg, { now, pending: pending(), idleUntil, readOnly }),
    setContinuous: (on, now) => {
      const until = nextClock(now, cfg.schedule.stopAt).toISOString();
      writeContinuous(state, { on, until, at: now.toISOString() });
      if (on) idleUntil = undefined;
      say(`continuous mode ${on ? 'on' : 'off'} until ${until}`);
    },
    lastStarted: () => {
      const times = [lastStartedAt(state), startedHere].filter(Boolean);
      return times.length ? new Date(Math.max(...times)) : undefined;
    },
    deps: {
      build: commitIn(root),
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
        if (readOnly) throw new Error(`${name} is read-only here: its rounds run under another service`);
        for (const round of rounds) requestStop(round, state);
        say(`stop requested for round ${rounds.join(', ')}`);
      },
    },
  };
};

/**
 * The tenants from the registry at `path`, reread on each call: an entry whose config path and read-only flag are
 * unchanged keeps its tenant (and the runs it started); a new or changed one is loaded. A registry or config that
 * fails to read keeps what was there and logs why.
 */
const registryTenants = (path) => {
  const known = new Map();
  let list = [];
  const refresh = async () => {
    let entries;
    try {
      entries = readTenants(path);
    } catch (error) {
      log(`tenants: ${error.message}; keeping ${list.map((t) => t.name).join(', ') || 'none'}`);
      return;
    }
    const next = [];
    for (const e of entries) {
      const key = `${e.name}\n${e.config}\n${Boolean(e.readOnly)}`;
      if (!known.has(key)) {
        try {
          known.set(key, createTenant(e.name, await loadConfig({ config: e.config }), { readOnly: Boolean(e.readOnly) }));
          log(`tenants: hosting ${e.name}${e.readOnly ? ' (read-only)' : ''} from ${e.config}`);
        } catch (error) {
          log(`tenants: ${e.name}: ${error.message}`);
          continue;
        }
      }
      next.push(known.get(key));
    }
    list = next;
  };
  return { refresh, current: () => list };
};

/**
 * Runs the service until its stdin closes: for `cfg` alone when given, else for every tenant registered in
 * `tenantsPath()`, reread every tick and before each request, so a tenant added while it runs is picked up.
 */
export const serve = async (cfg) => {
  const source = cfg
    ? (() => {
      const only = [createTenant(cfg.name, cfg)];
      return { refresh: async () => {}, current: () => only };
    })()
    : registryTenants(tenantsPath());
  await source.refresh();
  const host = createHost({ tenants: source.current, log, build: commitIn(fileURLToPath(new URL('..', import.meta.url))) });

  // The first tick only arms each schedule: a restart (every `onto sync`) never starts a round by itself.
  const loop = async () => {
    await source.refresh();
    host.tick();
    after(TICK_MS, loop);
  };
  await loop();

  // Requests are answered in the order they arrive, and the service exits once stdin closes and the last is answered.
  let answered = Promise.resolve();
  const input = createInterface({ input: process.stdin });
  input.on('line', (line) => {
    if (!line.trim()) return;
    answered = answered.then(async () => {
      await source.refresh();
      const reply = await host.request(line);
      process.stdout.write(`${JSON.stringify(reply)}\n`);
      host.tick();
    });
  });
  input.on('close', () => answered.then(() => process.exit(0)));
};

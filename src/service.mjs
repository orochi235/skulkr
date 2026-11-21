/**
 * The nightly audit as a long-running service: requests on stdin, replies on stdout, one JSON object per line.
 * Everything else goes to stderr, which the service host (onto, launchd, …) keeps as its log. It hosts one project
 * or every registered tenant (`host.mjs`). README.md "The service" and "Tenants" say how to bring it up and what each
 * request does.
 */
import { execFile, execFileSync, spawn } from 'node:child_process';
import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { after } from './after.mjs';
import { mainCheckout } from './batch.mjs';
import { loadConfig, nextClock } from './config.mjs';
import { inModelSteps } from './continuous.mjs';
import { continuousOf } from './continuousOf.mjs';
import { createHost } from './host.mjs';
import { requestOf } from './serviceCore.mjs';
import { clearIdle, lastFinished, lastStartedAt, liveRuns, requestStop, writeContinuous, writeIdle } from './runs.mjs';
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

/** The last line of the file at `path`, read from its tail, or undefined. */
export const lastLineOf = (path) => {
  let fd;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    const buf = Buffer.alloc(Math.min(size, 4096));
    readSync(fd, buf, 0, buf.length, size - buf.length);
    return buf.toString('utf8').split('\n').filter(Boolean).at(-1);
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
};

/**
 * One tenant as the host drives it: `cfg`'s project, each run `skulkr night` from its main checkout. `runtime` is what the tenant knows that is not on disk: the runs it started and when it last started one. A tenant
 * reloaded from an edited config takes its predecessor's, so its runs are not forgotten.
 */
export const createTenant = (name, cfg, { readOnly = false, runtime = { children: new Map() } } = {}) => {
  const root = mainCheckout(cfg);
  const state = cfg.state;
  /** Every run starts from the same config and checkout as this tenant. */
  const base = ['--config', cfg.file, '--root', root];
  const env = { ...process.env, SKULKR_CONFIG: cfg.file, SKULKR_ROOT: root };
  const say = (line) => log(`${name}: ${line}`);

  /** The runs this service started that have not exited, by pid, with the last line each printed. */
  const { children } = runtime;
  /** Rounds this service started that have not claimed a round yet. */
  const pending = () => {
    const live = new Set(liveRuns(state).map((r) => r.pid));
    return [...children.keys()].filter((pid) => !live.has(pid)).length;
  };

  /** Starts no continuous round until the night's stop time, after one that `why`. */
  const idle = (why) => {
    const now = new Date();
    const until = nextClock(now, cfg.schedule.stopAt).toISOString();
    writeIdle(state, { until, why, at: now.toISOString() });
    say(`continuous: that round ${why}; no more start until ${until}`);
  };

  const start = (args, { continuous = false } = {}) => {
    const at = new Date();
    /** Logs why, idles continuous mode, and throws, so the start is answered as not started. */
    const failed = (why) => {
      const message = `run could not start: skulkr night ${args.join(' ')}: ${why}`;
      say(message);
      if (continuous) idle('could not start');
      throw new Error(message);
    };
    let child;
    try {
      // A process group of its own, so a restarting service (every `onto sync`) never takes its runs down with it.
      child = spawn(process.execPath, [BIN, 'night', ...base, ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    } catch (error) {
      failed(error.message ?? error);
    }
    if (child.pid === undefined) {
      // Node says why only on the next turn, in an 'error' event that must have a listener.
      child.on('error', (error) => say(`run could not start: ${error.message}`));
      failed(`no process (is ${root} there?)`);
    }
    child.on('error', (error) => say(`run ${child.pid}: ${error.message}`));
    runtime.startedHere = at;
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
      if (continuous && (!claimed || code !== 0)) idle(claimed ? 'failed' : 'found nothing to do');
    });
    return args;
  };

  return {
    name,
    readOnly,
    runtime,
    startAt: cfg.schedule.startAt,
    stopAt: cfg.schedule.stopAt,
    /** A run this service started counts before it has claimed its round, so no second one starts beside it. */
    running: () => children.size > 0 || liveRuns(state).length > 0,
    modelBusy: () => pending() > 0 || liveRuns(state).some(inModelSteps),
    scheduledContinuous: Boolean(cfg.schedule.continuous && cfg.budget.nightUsd > 0),
    continuous: (now) => continuousOf(cfg, { now, pending: pending(), readOnly }),
    setContinuous: (on, now) => {
      const until = nextClock(now, cfg.schedule.stopAt).toISOString();
      writeContinuous(state, { on, until, at: now.toISOString() });
      if (on) clearIdle(state);
      say(`continuous mode ${on ? 'on' : 'off'} until ${until}`);
    },
    lastStarted: () => {
      const times = [lastStartedAt(state), runtime.startedHere].filter(Boolean);
      return times.length ? new Date(Math.max(...times)) : undefined;
    },
    deps: {
      build: () => commitIn(root),
      live: () => liveRuns(state).map((r) => r.round),
      status: () => {
        const runs = liveRuns(state).map((r) => {
          const lastLine = children.get(r.pid)?.lastLine || (r.nightDir ? lastLineOf(join(r.nightDir, 'night.log')) : undefined);
          return lastLine ? { ...r, lastLine } : r;
        });
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
 * The tenants from the registry at `path`, reread on each call: an entry whose config path, read-only flag and config
 * file's mtime are unchanged keeps its tenant; a new one is loaded, and a changed one reloaded, keeping the runs it
 * started. A registry or config that fails to read keeps what was there and logs why, once.
 */
export const registryTenants = (path) => {
  /** By tenant name: `{ key, tenant, failed? }`, `failed` the key that last failed to load. */
  const known = new Map();
  let list = [];
  const reload = async () => {
    let entries;
    try {
      entries = readTenants(path);
    } catch (error) {
      log(`tenants: ${error.message}; keeping ${list.map((t) => t.name).join(', ') || 'none'}`);
      return;
    }
    const next = [];
    for (const e of entries) {
      let mtime = 0;
      try {
        mtime = statSync(e.config).mtimeMs;
      } catch { /* loadConfig says why */ }
      const key = `${e.config}\n${Boolean(e.readOnly)}\n${mtime}`;
      const had = known.get(e.name);
      if (had?.key !== key && had?.failed !== key) {
        try {
          const tenant = createTenant(e.name, await loadConfig({ config: e.config, fresh: true }), { readOnly: Boolean(e.readOnly), runtime: had?.tenant.runtime });
          known.set(e.name, { key, tenant });
          log(`tenants: ${had ? 'reloaded' : 'hosting'} ${e.name}${e.readOnly ? ' (read-only)' : ''} from ${e.config}`);
        } catch (error) {
          log(`tenants: ${e.name}: ${error.message}${had ? '; keeping its last config' : ''}`);
          if (had) had.failed = key;
          else known.set(e.name, { key: undefined, tenant: undefined, failed: key });
        }
      }
      const tenant = known.get(e.name)?.tenant;
      if (tenant) next.push(tenant);
    }
    for (const name of [...known.keys()]) if (!entries.some((e) => e.name === name)) known.delete(name);
    list = next;
  };
  /** A refresh asked for while one runs (the tick's and a request's) joins it, so no entry is loaded twice. */
  let inFlight;
  const once = () => {
    inFlight ??= reload().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };
  return { refresh: once, current: () => list };
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
  const host = createHost({ tenants: source.current, log, build: () => commitIn(fileURLToPath(new URL('..', import.meta.url))) });

  // The first tick only arms each schedule: a restart (every `onto sync`) never starts a round by itself.
  const loop = async () => {
    try {
      await source.refresh();
      host.tick();
    } catch (error) {
      log(`tick: ${error.stack ?? error}`);
    }
    after(TICK_MS, loop);
  };
  await loop();

  // Requests are answered in the order they arrive, and the service exits once stdin closes and the last is answered.
  let answered = Promise.resolve();
  const input = createInterface({ input: process.stdin });
  input.on('line', (line) => {
    if (!line.trim()) return;
    answered = answered.then(async () => {
      let reply;
      try {
        await source.refresh();
        reply = await host.request(line);
      } catch (error) {
        log(`request ${line}: ${error.stack ?? error}`);
        reply = { id: requestOf(line)?.id, error: error.message ?? String(error) };
      }
      process.stdout.write(`${JSON.stringify(reply)}\n`);
      try {
        host.tick();
      } catch (error) {
        log(`tick: ${error.stack ?? error}`);
      }
    });
  });
  input.on('close', () => answered.then(() => process.exit(0)));
};

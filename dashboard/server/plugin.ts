/**
 * Dev-server Vite plugin serving the dashboard's data: the tenants it reads at `<base>api/tenants`, and for each,
 * the JSON `skulkr map` prints at `<base>api/t/<name>/map` and one area's defects at `<base>api/t/<name>/area?id=<area>`,
 * from `skulkr defects <area>`, the end of an area's newest job log in the running round at `<base>api/t/<name>/tail?id=<area>`
 * and the end of the running round's `night.log` at `<base>api/t/<name>/log` (both read here, not through the CLI, as
 * they are asked for every few seconds), and a POST to `<base>api/t/<name>/pin?id=<area>&on=1|0` runs `skulkr pin|unpin <area>`
 * and answers once the map has been built again; `<base>api/t/<name>/events` pushes the map as it changes (`feed.ts`). It runs the pipeline's CLI in a child process, since building a map asks the runner
 * for its jobs and may wait seconds on it, and the server must keep answering meanwhile; requests for one tenant's
 * map that arrive while its build runs share it.
 *
 * The tenants are the registry's (`skulkr tenants ls`, `SKULKR_TENANTS` passing through). With none registered, the
 * one project the CLI finds by itself is the only tenant: `SKULKR_CONFIG` and `SKULKR_ROOT` from this server's
 * environment, else `skulkr.config.mjs` in the directory the child runs in.
 */
import { execFile, spawn, type ExecFileException } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { STALE_HEADER, TENANTS_PATH, parseTenantPath } from '../shared/routes.ts';
import { createFeed } from './feed.ts';
import { jobTailOf, nightLogTailOf } from './jobTail.ts';

/** The pipeline's CLI, beside the dashboard in its repository. */
export const SKULKR_BIN = fileURLToPath(new URL('../../bin/skulkr.mjs', import.meta.url));

/** Runs the CLI with `args` and answers its stdout. */
export type SkulkrRunner = (args: readonly string[]) => Promise<string>;

export interface SkulkrRunnerOptions {
  readonly bin?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  /** How a child is started; tests swap it. */
  readonly exec?: typeof execFile;
  /** `false` keeps no map on disk between server runs. */
  readonly cache?: boolean;
  /** The event feed's timings and watcher; tests swap them. */
  readonly feed?: Partial<Pick<import('./feed.ts').FeedOptions, 'watch' | 'debounceMs' | 'gapMs' | 'everyMs'>>;
}

const MAP_TIMEOUT_MS = 120_000;

/** Why a CLI run that printed nothing to stderr failed: killed at the timeout, by a signal, or its exit code. */
const failureOf = (error: ExecFileException): string =>
  error.killed && error.signal === 'SIGTERM' ? `${error.message} (killed after ${MAP_TIMEOUT_MS / 1000} s)`
    : error.signal ? `${error.message} (killed by ${error.signal})` : `${error.message} (exit ${error.code ?? '?'})`;

/**
 * Lifts macOS's background policy off a child the server started. A server started by a launchd agent runs its children
 * as background work, held to the efficiency cores; on a loaded machine a map build then got 0.23 s of CPU in 32 s and
 * hit its timeout, where the same build from a terminal took 13 s (2026-11-25).
 */
const foreground = (pid: number | undefined) => {
  if (process.platform !== 'darwin' || !pid) return;
  execFile('taskpolicy', ['-B', '-p', String(pid)], () => {});
};

/** A runner for the CLI at `bin`, in `cwd`, with `env`: the server's own unless given. */
export function createSkulkrRunner({ bin = SKULKR_BIN, env = process.env, cwd, exec = execFile }: SkulkrRunnerOptions = {}): SkulkrRunner {
  const dir = cwd ?? env.SKULKR_ROOT ?? process.cwd();
  return (args) => new Promise((done, fail) => {
    // A map takes seconds, and a minute or more on a machine a round has loaded; past this it is killed, and the page
    // keeps the map before it.
    const child = exec(process.execPath, [bin, ...args], { cwd: dir, env, maxBuffer: 32 * 1024 * 1024, timeout: MAP_TIMEOUT_MS },
      (error, stdout, stderr) => (error ? fail(new Error(String(stderr).trim() || failureOf(error))) : done(String(stdout))));
    foreground(child?.pid);
  });
}

/** Starts a long-running CLI child with `args`; answers how to stop it. */
export type SkulkrStarter = (args: readonly string[]) => { stop: () => void };

/** Starts `skulkr <args>` as a child that runs until its stdin closes, as `skulkr fetch` does; stopping closes it. */
export function createSkulkrStarter({ bin = SKULKR_BIN, env = process.env, cwd }: SkulkrRunnerOptions = {}): SkulkrStarter {
  const dir = cwd ?? env.SKULKR_ROOT ?? process.cwd();
  return (args) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd: dir, env, stdio: ['pipe', 'ignore', 'inherit'] });
    child.on('error', () => {});
    foreground(child.pid);
    return {
      stop: () => {
        child.stdin?.end();
        // One stuck in a fleet call ends at that call's timeout; past it, kill it.
        setTimeout(() => { if (child.exitCode === null) child.kill(); }, 20_000).unref();
      },
    };
  };
}

/** Runs the CLI with `args` (`['map']`, or a tenant's map or defects), one run at a time; a call during a run gets that run's answer. */
export function createSharedRun(run: SkulkrRunner = createSkulkrRunner(), args: readonly string[] = ['map']): () => Promise<string> {
  let pending: Promise<string> | null = null;
  return () => {
    pending ??= run(args).finally(() => {
      pending = null;
    });
    return pending;
  };
}

/** How old a kept map may be before a request for it also starts a fresh build. */
export const FRESH_MS = 5_000;

/** Where a tenant's last good map is kept between server runs: one file per tenant, overwritten. */
export const mapCachePath = (tenant: string, home = homedir()) => join(home, '.cache', 'skulkr', tenant.replace(/[^\w.-]+/g, '-'), 'map.json');

/** A kept map, and why the builds since it failed: null once one succeeds. */
export interface KeptAnswer {
  readonly text: string;
  readonly error: string | null;
}

/** A kept map's reader, and `rebuild`, which builds it again after any build already running and answers that build. */
export type KeptMap = (() => Promise<KeptAnswer>) & { readonly rebuild: () => Promise<string>; readonly listen: (fn: (text: string) => void) => void };

/**
 * `build` with its last good answer kept: a request gets the kept map at once, and starts a build in the background
 * when that map is older than `freshMs`; only with nothing kept does a request wait for the build. `file` keeps the
 * map across server restarts. A failed build keeps the last good map, answered with the failure beside it until a
 * build succeeds, and fails a request only when there is none. `listen(fn)` hears each good build's map.
 */
export function createKeptMap(build: () => Promise<string>, file: string | null, { freshMs = FRESH_MS, now = Date.now } = {}): KeptMap {
  let kept: { text: string; at: number } | null = null;
  if (file) {
    try {
      kept = { text: readFileSync(file, 'utf8'), at: statSync(file).mtimeMs };
    } catch {
      kept = null;
    }
  }
  let error: string | null = null;
  let building: Promise<string> | null = null;
  const listeners: ((text: string) => void)[] = [];
  const refresh = () => {
    building ??= build().then((text) => {
      kept = { text, at: now() };
      error = null;
      for (const fn of listeners) fn(text);
      if (file) {
        try {
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, text);
        } catch {
          // The kept copy is a convenience; a disk that refuses it costs only a slower first load after a restart.
        }
      }
      return text;
    }, (e: Error) => {
      error = e.message;
      throw e;
    }).finally(() => {
      building = null;
    });
    return building;
  };
  const read = () => {
    if (!kept) return refresh().then((text) => ({ text, error: null }));
    // A failure reaches the requests after it, as `error`.
    if (now() - kept.at > freshMs) refresh().catch(() => {});
    return Promise.resolve({ text: kept.text, error });
  };
  // A build already running may have read the state before the change that asks for this one.
  const rebuild = () => (building ?? Promise.resolve('')).catch(() => '').then(refresh);
  return Object.assign(read, { rebuild, listen: (fn: (text: string) => void) => void listeners.push(fn) });
}

/** One tenant the dashboard reads: its name, and whether the CLI names it with `--tenant` (a registered one). */
export interface DashTenant {
  readonly name: string;
  readonly registered: boolean;
}

/** The tenants now: the registry's, or the one project the CLI finds by itself when none is registered. */
export async function listTenants(run: SkulkrRunner): Promise<DashTenant[]> {
  const registered = JSON.parse(await run(['tenants', 'ls', '--json'])) as { name: string }[];
  if (registered.length) return registered.map((t) => ({ name: t.name, registered: true }));
  const cfg = JSON.parse(await run(['config'])) as { name: string };
  return [{ name: cfg.name, registered: false }];
}

/** What a tenant route asks the CLI: its map (from the fleet listings `skulkr fetch` keeps), one area's defects, to pin
 *  or unpin one, or its saturation ledgers; null for a tenant there is none of. */
export function tenantArgs(tenants: readonly DashTenant[], name: string, what: 'map' | 'area' | 'pin' | 'unpin' | 'saturation', area: string | null): string[] | null {
  const t = tenants.find((x) => x.name === name);
  if (!t) return null;
  // Options first, so an area id the CLI would read as a flag is never placed before them.
  const pick = t.registered ? ['--tenant', t.name] : [];
  if (what === 'map') return ['map', ...pick, '--cached-jobs'];
  if (what === 'saturation') return ['saturate', ...pick, 'ls', '--json'];
  return [what === 'area' ? 'defects' : what, ...pick, area ?? ''];
}

/** A request the routes refuse, told to the client as it is. */
class Refusal extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** The part of a CLI failure worth showing a viewer: its `Error:` line, else its first, never the stack. */
export function summaryOf(message: string): string {
  const lines = message.split('\n').map((l) => l.trim()).filter(Boolean);
  return (lines.find((l) => /^\w*Error: /.test(l)) ?? lines[0] ?? 'failed').slice(0, 300);
}

/** The area ids in a map's JSON, read once per map text. */
function createAreaIds(): (text: string) => ReadonlySet<string> {
  let last: { text: string; ids: ReadonlySet<string> } | null = null;
  return (text) => {
    if (last?.text !== text) last = { text, ids: new Set((JSON.parse(text) as { areas: { id: string }[] }).areas.map((a) => a.id)) };
    return last.ids;
  };
}

/** The data routes' handler, with its kept tenants and maps. Each CLI failure is logged here in full, and a viewer sees its summary. */
export function createRoutes(options: SkulkrRunnerOptions, cli: SkulkrRunner = createSkulkrRunner(options), log: (text: string) => void = console.error, start: SkulkrStarter = createSkulkrStarter(options)) {
  const run: SkulkrRunner = (args) => cli(args).catch((e: Error) => {
    log(`skulkr ${args.join(' ')} failed:\n${e.message}`);
    throw e;
  });
  const maps = new Map<string, { kept: KeptMap; ids: (text: string) => ReadonlySet<string>; feed: ReturnType<typeof createFeed> }>();
  const mapOf = (tenant: string, args: readonly string[]) => {
    const key = args.join('\n');
    if (!maps.has(key)) {
      const kept = createKeptMap(createSharedRun(run, args), options.cache === false ? null : mapCachePath(tenant));
      // While a page watches, `skulkr fetch` keeps the fleet listings fresh, so no build waits on the fleet.
      let fetching: { stop: () => void } | null = null;
      const onWatched = (on: boolean) => {
        if (on) fetching ??= start(['fetch', ...args.slice(1).filter((a) => a !== '--cached-jobs')]);
        else (fetching?.stop(), fetching = null);
      };
      const feed = createFeed({ current: () => kept().then((a) => a.text), rebuild: kept.rebuild, onWatched, ...options.feed });
      kept.listen(feed.built);
      maps.set(key, { kept, ids: createAreaIds(), feed });
    }
    return maps.get(key)!;
  };
  // One per area asked for, so viewers asking for one area at once share its run.
  const areaRuns = new Map<string, () => Promise<string>>();
  const keptTenants = createKeptMap(() => listTenants(run).then((list) => JSON.stringify(list)), null);
  const json = (res: ServerResponse, body: Promise<string | KeptAnswer>) => body.then((answer) => {
    const { text, error } = typeof answer === 'string' ? { text: answer, error: null } : answer;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (error) res.setHeader(STALE_HEADER, encodeURIComponent(summaryOf(error)));
    res.end(text);
  }, (e: Error) => {
    res.statusCode = e instanceof Refusal ? e.status : 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end(e instanceof Refusal ? e.message : summaryOf(e.message));
  });
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const [path, query = ''] = (req.url ?? '').split('?') as [string, string?];
    const route = parseTenantPath(path);
    const listing = path.endsWith(`/${TENANTS_PATH}`);
    if (!route && !listing) return next();
    const method = route?.what === 'pin' ? 'POST' : 'GET';
    if (req.method !== method) {
      res.statusCode = 405;
      res.end(`${method} only`);
      return;
    }
    // The registry is kept like a map, so a tenant added while the server runs shows up within FRESH_MS.
    const tenants = keptTenants().then(({ text }) => JSON.parse(text) as DashTenant[]);
    if (listing) return void json(res, tenants.then((list) => JSON.stringify(list.map(({ name }) => ({ name })))));
    const { tenant, what } = route!;
    if (what === 'events') {
      tenants.then((list) => {
        const mapArgs = tenantArgs(list, tenant, 'map', null);
        if (!mapArgs) throw new Refusal(400, `no tenant ${tenant}`);
        mapOf(tenant, mapArgs).feed.subscribe(res, (fn) => req.on('close', fn));
      }).catch((e: Error) => {
        res.statusCode = e instanceof Refusal ? e.status : 500;
        res.end(e instanceof Refusal ? e.message : summaryOf(e.message));
      });
      return;
    }
    void json(res, tenants.then(async (list) => {
      const mapArgs = tenantArgs(list, tenant, 'map', null);
      if (!mapArgs) throw new Refusal(400, `no tenant ${tenant}; this dashboard reads ${list.map((t) => t.name).join(', ')}`);
      if (what === 'saturation') return run(tenantArgs(list, tenant, 'saturation', null)!);
      const map = mapOf(tenant, mapArgs);
      if (what === 'map') return map.kept();
      if (what === 'log') {
        const { runs } = JSON.parse((await map.kept()).text) as { runs: { running?: boolean; nightDir?: string | null }[] };
        const nightDir = runs.findLast((r) => r.running)?.nightDir ?? runs.at(-1)?.nightDir;
        return JSON.stringify(nightDir ? nightLogTailOf(nightDir) : null);
      }
      const params = new URLSearchParams(query);
      const id = params.get('id') ?? '';
      if (id.startsWith('-') || !map.ids((await map.kept()).text).has(id)) throw new Refusal(400, `no area ${JSON.stringify(id)} in ${tenant}`);
      if (what === 'tail') {
        const { runs } = JSON.parse((await map.kept()).text) as { runs: { running?: boolean; nightDir?: string | null }[] };
        const nightDir = runs.findLast((r) => r.running)?.nightDir;
        return JSON.stringify(nightDir ? await jobTailOf(nightDir, id) : null);
      }
      if (what === 'pin') {
        await run(tenantArgs(list, tenant, params.get('on') === '1' ? 'pin' : 'unpin', id)!);
        await map.kept.rebuild();
        return JSON.stringify({ ok: true });
      }
      const args = tenantArgs(list, tenant, 'area', id)!;
      const key = args.join('\n');
      if (!areaRuns.has(key)) areaRuns.set(key, createSharedRun(run, args));
      return areaRuns.get(key)!();
    }));
  };
}

export function skulkrMapPlugin(options: SkulkrRunnerOptions = {}): Plugin {
  let made: ReturnType<typeof createRoutes> | null = null;
  const routes = () => (made ??= createRoutes(options));
  return {
    name: 'skulkr:map',
    // The preview server too: a built page loads its few bundles in a fraction of the time the dev server's
    // unbundled modules take, so a dashboard left open to watch runs as a build.
    configureServer(server) {
      server.middlewares.use(routes());
    },
    configurePreviewServer(server) {
      server.middlewares.use(routes());
    },
  };
}

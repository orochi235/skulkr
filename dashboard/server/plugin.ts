/**
 * Dev-server Vite plugin serving the dashboard's data: the tenants it reads at `<base>api/tenants`, and for each,
 * the JSON `skulkr map` prints at `<base>api/t/<name>/map` and one area's defects at `<base>api/t/<name>/area?id=<area>`,
 * from `skulkr defects <area>`. It runs the pipeline's CLI in a child process, since building a map asks the runner
 * for its jobs and may wait seconds on it, and the server must keep answering meanwhile; requests for one tenant's
 * map that arrive while its build runs share it.
 *
 * The tenants are the registry's (`skulkr tenants ls`, `SKULKR_TENANTS` passing through). With none registered, the
 * one project the CLI finds by itself is the only tenant: `SKULKR_CONFIG` and `SKULKR_ROOT` from this server's
 * environment, else `skulkr.config.mjs` in the directory the child runs in.
 */
import { execFile } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { STALE_HEADER, TENANTS_PATH, parseTenantPath } from '../shared/routes.ts';

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
}

/** A runner for the CLI at `bin`, in `cwd`, with `env`: the server's own unless given. */
export function createSkulkrRunner({ bin = SKULKR_BIN, env = process.env, cwd, exec = execFile }: SkulkrRunnerOptions = {}): SkulkrRunner {
  const dir = cwd ?? env.SKULKR_ROOT ?? process.cwd();
  return (args) => new Promise((done, fail) => {
    exec(process.execPath, [bin, ...args], { cwd: dir, env, maxBuffer: 32 * 1024 * 1024, timeout: 60_000 },
      (error, stdout, stderr) => (error ? fail(new Error(String(stderr).trim() || error.message)) : done(String(stdout))));
  });
}

/** Builds a map JSON with `args` (`['map']`, or a tenant's), one build at a time; a call during a build gets that build's answer. */
export function createMapBuilder(run: SkulkrRunner = createSkulkrRunner(), args: readonly string[] = ['map']): () => Promise<string> {
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

/**
 * `build` with its last good answer kept: a request gets the kept map at once, and starts a build in the background
 * when that map is older than `freshMs`; only with nothing kept does a request wait for the build. `file` keeps the
 * map across server restarts. A failed build keeps the last good map, answered with the failure beside it until a
 * build succeeds, and fails a request only when there is none.
 */
export function createKeptMap(build: () => Promise<string>, file: string | null, { freshMs = FRESH_MS, now = Date.now } = {}): () => Promise<KeptAnswer> {
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
  const refresh = () => {
    building ??= build().then((text) => {
      kept = { text, at: now() };
      error = null;
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
  return () => {
    if (!kept) return refresh().then((text) => ({ text, error: null }));
    // A failure reaches the requests after it, as `error`.
    if (now() - kept.at > freshMs) refresh().catch(() => {});
    return Promise.resolve({ text: kept.text, error });
  };
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

/** What a tenant route asks the CLI: its map, or one area's defects; null for a tenant there is none of. */
export function tenantArgs(tenants: readonly DashTenant[], name: string, what: 'map' | 'area', area: string | null): string[] | null {
  const t = tenants.find((x) => x.name === name);
  if (!t) return null;
  // Options first, so an area id the CLI would read as a flag is never placed before them.
  const pick = t.registered ? ['--tenant', t.name] : [];
  return what === 'map' ? ['map', ...pick] : ['defects', ...pick, area ?? ''];
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
export function createRoutes(options: SkulkrRunnerOptions, cli: SkulkrRunner = createSkulkrRunner(options), log: (text: string) => void = console.error) {
  const run: SkulkrRunner = (args) => cli(args).catch((e: Error) => {
    log(`skulkr ${args.join(' ')} failed:\n${e.message}`);
    throw e;
  });
  const maps = new Map<string, { kept: () => Promise<KeptAnswer>; ids: (text: string) => ReadonlySet<string> }>();
  const mapOf = (tenant: string, args: readonly string[]) => {
    const key = args.join('\n');
    if (!maps.has(key)) {
      maps.set(key, { kept: createKeptMap(createMapBuilder(run, args), options.cache === false ? null : mapCachePath(tenant)), ids: createAreaIds() });
    }
    return maps.get(key)!;
  };
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
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.end('GET only');
      return;
    }
    // The registry is kept like a map, so a tenant added while the server runs shows up within FRESH_MS.
    const tenants = keptTenants().then(({ text }) => JSON.parse(text) as DashTenant[]);
    if (listing) return void json(res, tenants.then((list) => JSON.stringify(list.map(({ name }) => ({ name })))));
    const { tenant, what } = route!;
    void json(res, tenants.then(async (list) => {
      const mapArgs = tenantArgs(list, tenant, 'map', null);
      if (!mapArgs) throw new Refusal(400, `no tenant ${tenant}; this dashboard reads ${list.map((t) => t.name).join(', ')}`);
      const map = mapOf(tenant, mapArgs);
      if (what === 'map') return map.kept();
      const id = new URLSearchParams(query).get('id') ?? '';
      if (id.startsWith('-') || !map.ids((await map.kept()).text).has(id)) throw new Refusal(400, `no area ${JSON.stringify(id)} in ${tenant}`);
      return run(tenantArgs(list, tenant, 'area', id)!);
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

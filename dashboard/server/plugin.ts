/**
 * Dev-server Vite plugin serving the dashboard's data: the tenants it reads at `<base>api/tenants`, and for each,
 * the JSON `skulk map` prints at `<base>api/t/<name>/map` and one area's defects at `<base>api/t/<name>/area?id=<area>`,
 * from `skulk defects <area>`. It runs the pipeline's CLI in a child process, since building a map asks the runner
 * for its jobs and may wait seconds on it, and the server must keep answering meanwhile; requests for one tenant's
 * map that arrive while its build runs share it.
 *
 * The tenants are the registry's (`skulk tenants ls`, `SKULK_TENANTS` passing through). With none registered, the
 * one project the CLI finds by itself is the only tenant: `SKULK_CONFIG` and `SKULK_ROOT` from this server's
 * environment, else `skulk.config.mjs` in the directory the child runs in.
 */
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { TENANTS_PATH, parseTenantPath } from '../shared/routes.ts';

/** The pipeline's CLI, beside the dashboard in its repository. */
export const SKULK_BIN = fileURLToPath(new URL('../../bin/skulk.mjs', import.meta.url));

/** Runs the CLI with `args` and answers its stdout. */
export type SkulkRunner = (args: readonly string[]) => Promise<string>;

export interface SkulkRunnerOptions {
  readonly bin?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  /** How a child is started; tests swap it. */
  readonly exec?: typeof execFile;
}

/** A runner for the CLI at `bin`, in `cwd`, with `env`: the server's own unless given. */
export function createSkulkRunner({ bin = SKULK_BIN, env = process.env, cwd, exec = execFile }: SkulkRunnerOptions = {}): SkulkRunner {
  const dir = cwd ?? env.SKULK_ROOT ?? process.cwd();
  return (args) => new Promise((done, fail) => {
    exec(process.execPath, [bin, ...args], { cwd: dir, env, maxBuffer: 32 * 1024 * 1024, timeout: 60_000 },
      (error, stdout, stderr) => (error ? fail(new Error(String(stderr).trim() || error.message)) : done(String(stdout))));
  });
}

/** Builds a map JSON with `args` (`['map']`, or a tenant's), one build at a time; a call during a build gets that build's answer. */
export function createMapBuilder(run: SkulkRunner = createSkulkRunner(), args: readonly string[] = ['map']): () => Promise<string> {
  let pending: Promise<string> | null = null;
  return () => {
    pending ??= run(args).finally(() => {
      pending = null;
    });
    return pending;
  };
}

/** One tenant the dashboard reads: its name, and whether the CLI names it with `--tenant` (a registered one). */
export interface DashTenant {
  readonly name: string;
  readonly registered: boolean;
}

/** The tenants now: the registry's, or the one project the CLI finds by itself when none is registered. */
export async function listTenants(run: SkulkRunner): Promise<DashTenant[]> {
  const registered = JSON.parse(await run(['tenants', 'ls', '--json'])) as { name: string }[];
  if (registered.length) return registered.map((t) => ({ name: t.name, registered: true }));
  const cfg = JSON.parse(await run(['config'])) as { name: string };
  return [{ name: cfg.name, registered: false }];
}

/** What a tenant route asks the CLI: its map, or one area's defects; null for a tenant there is none of. */
export function tenantArgs(tenants: readonly DashTenant[], name: string, what: 'map' | 'area', area: string | null): string[] | null {
  const t = tenants.find((x) => x.name === name);
  if (!t) return null;
  const pick = t.registered ? ['--tenant', t.name] : [];
  return what === 'map' ? ['map', ...pick] : ['defects', area ?? '', ...pick];
}

export function skulkMapPlugin(options: SkulkRunnerOptions = {}): Plugin {
  return {
    name: 'skulk:map',
    apply: 'serve',
    configureServer(server) {
      const run = createSkulkRunner(options);
      const builds = new Map<string, () => Promise<string>>();
      const json = (res: import('node:http').ServerResponse, body: Promise<string>) => body.then((text) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(text);
      }, (e: Error) => {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain');
        res.end(e.message);
      });
      server.middlewares.use((req, res, next) => {
        const [path, query = ''] = (req.url ?? '').split('?') as [string, string?];
        const route = parseTenantPath(path);
        const listing = path.endsWith(`/${TENANTS_PATH}`);
        if (!route && !listing) return next();
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end('GET only');
          return;
        }
        // The registry is read on every request, so a tenant added while the server runs shows up.
        const tenants = listTenants(run);
        if (listing) return void json(res, tenants.then((list) => JSON.stringify(list.map(({ name }) => ({ name })))));
        void json(res, tenants.then((list) => {
          const args = tenantArgs(list, route!.tenant, route!.what, new URLSearchParams(query).get('id'));
          if (!args) throw new Error(`no tenant ${route!.tenant}; this dashboard reads ${list.map((t) => t.name).join(', ')}`);
          if (route!.what === 'area') return run(args);
          const key = args.join('\n');
          if (!builds.has(key)) builds.set(key, createMapBuilder(run, args));
          return builds.get(key)!();
        }));
      });
    },
  };
}

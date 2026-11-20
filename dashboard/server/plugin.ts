/**
 * Dev-server Vite plugin serving the dashboard's data at `<base>__skulk/map`, the JSON `skulk map` prints, and one
 * area's defects at `<base>__skulk/area?id=<area>`, from `skulk defects <area>`. It runs the pipeline's CLI in a
 * child process, since building the map asks `onto jobs` and may wait seconds on it, and the server must keep
 * answering meanwhile; requests that arrive while one build runs share it.
 *
 * Which project it reads is the CLI's to find: `SKULK_CONFIG` and `SKULK_ROOT` reach it from this server's
 * environment, and with neither it reads `skulk.config.mjs` in the directory the child runs in, `SKULK_ROOT` when
 * set and the server's own working directory otherwise.
 */
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { SKULK_AREA_PATH, SKULK_MAP_PATH } from '../shared/routes.ts';

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

/** Builds the map JSON, one build at a time; a call during a build gets that build's answer. */
export function createMapBuilder(run: SkulkRunner = createSkulkRunner()): () => Promise<string> {
  let pending: Promise<string> | null = null;
  return () => {
    pending ??= run(['map']).finally(() => {
      pending = null;
    });
    return pending;
  };
}

export function skulkMapPlugin(options: SkulkRunnerOptions = {}): Plugin {
  return {
    name: 'skulk:map',
    apply: 'serve',
    configureServer(server) {
      const run = createSkulkRunner(options);
      const build = createMapBuilder(run);
      server.middlewares.use((req, res, next) => {
        const [path, query = ''] = (req.url ?? '').split('?') as [string, string?];
        const area = path.endsWith(`/${SKULK_AREA_PATH}`) ? new URLSearchParams(query).get('id') : null;
        if (!path.endsWith(`/${SKULK_MAP_PATH}`) && area === null) return next();
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end('GET only');
          return;
        }
        (area === null ? build() : run(['defects', area])).then((json) => {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(json);
        }, (e: Error) => {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'text/plain');
          res.end(e.message);
        });
      });
    },
  };
}

/**
 * The onto runner: each job is one `onto do` from the frozen tree, in a node tree named by the job, with what the job
 * writes under `out` brought back to `to`. onto's own README covers `do`, `status` and `jobs`.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';

const BUSY = /working tree .* is busy/;
const REFUSED = /\bquiet\b|refuses|is offline|not reachable|unavailable/i;

const ICONS = { fix: 'wrench.and.screwdriver', review: 'doc.text.magnifyingglass' };

/** `onto do`'s arguments for `job`; see `createOntoRunner`'s `run`. */
export const ontoArgs = (job) => [
  'do', ...(job.gui ? ['--gui'] : []), '--kind', job.kind,
  ...(job.node ? ['--node', job.node] : []), '--in', job.tree, ...(job.ref ? ['--ref', job.ref] : []), '--force',
  '--timeout', job.timeout, '--expect', job.expect, '--task', job.task, '--about', job.about,
  '--icon', job.icon ?? ICONS[job.kind] ?? ICONS.review,
  '--out', job.out, '--to', job.to,
  ...Object.entries(job.env ?? {}).flatMap(([k, v]) => ['--env', `${k}=${v}`]),
  '--', 'bash', '-lc', job.shell,
];

/** Runs onto once with `args` from `cwd`, its output appended to `log`. Answers `{ status, stderr }`. */
export const ontoOnce = (args, cwd, log) =>
  new Promise((done) => {
    const child = spawn('onto', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stdout.pipe(log, { end: false });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      log.write(chunk);
    });
    child.on('error', (error) => done({ status: 1, stderr: String(error) }));
    child.on('close', (status) => done({ status: status ?? 1, stderr }));
  });

/** Each task's first progress counter anywhere in `onto top --json`'s answer, by task. */
export const progressOfTop = (top) => {
  const found = new Map();
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    const first = Array.isArray(o.progress) ? o.progress[0] : null;
    if (typeof o.task === 'string' && first && Number.isFinite(first.done) && Number.isFinite(first.total)) {
      found.set(o.task, { done: first.done, total: first.total });
    }
    Object.values(o).forEach(walk);
  };
  walk(top);
  return found;
};

/**
 * The runner interface, as onto answers it:
 *
 * - `run(job, { cwd, log })` launches one job and answers `{ status, busy, refused }`: `busy` when the node's tree is
 *   in use and nothing ran (the caller waits and tries again); `refused` when the node turned it away as quiet or
 *   unavailable before anything ran (the caller tries another node). `job` is `{ kind, node?, tree, ref?, task,
 *   about, expect, timeout, icon?, gui?, out, to, env?, shell }`: `kind` `review` | `fix` | `test`; `tree` the node
 *   tree's name; `ref` the commit the tree syncs against; `expect` a duration or `none`; `timeout` a duration;
 *   `out` the directory in the tree brought back into the local directory `to`; `shell` a bash script.
 * - `unavailableNodes()` answers the nodes the runner reports as quiet or unavailable now, as a Set.
 * - `jobs(sinceIso)` answers the runner's jobs running now or started since then, each
 *   `{ task, node, state, started, finished? }`, or `[]` when it cannot say.
 * - `progress()` (optional) answers each running job's own count of its work by its task, a Map of `{ done, total }`
 *   (its first counter: a reviewer's files read, a fixer's commits of its findings), empty when it cannot say.
 */
export const createOntoRunner = () => ({
  run: async (job, { cwd, log }) => {
    const r = await ontoOnce(ontoArgs(job), cwd, log);
    return {
      status: r.status,
      busy: BUSY.test(r.stderr),
      refused: r.status !== 0 && REFUSED.test(r.stderr) && !/job .* (failed|exited)/.test(r.stderr),
    };
  },
  unavailableNodes: () => {
    const run = spawnSync('onto', ['status', '--json'], { encoding: 'utf8', timeout: 30_000 });
    if (run.status !== 0) return new Set();
    try {
      const rows = JSON.parse(run.stdout);
      const list = Array.isArray(rows) ? rows : Object.entries(rows).map(([name, row]) => ({ name, ...row }));
      return new Set(list.filter((r) => r.quiet || r.available === false || r.online === false).map((r) => r.name ?? r.node));
    } catch {
      return new Set();
    }
  },
  progress: () => {
    try {
      const out = execFileSync('onto', ['top', '--json', '--once'], { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] });
      return progressOfTop(JSON.parse(out));
    } catch {
      return new Map();
    }
  },
  jobs: (since) => {
    const hours = Math.max(1, Math.ceil((Date.now() - Date.parse(since)) / 3_600_000) + 1);
    try {
      const out = execFileSync('onto', ['jobs', '--json', '--since', `${Number.isFinite(hours) ? hours : 24}h`, '--limit', '1000'],
        { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'ignore'] });
      return (JSON.parse(out).jobs ?? []).filter((j) => j.state === 'running' || j.finished);
    } catch {
      return [];
    }
  },
});

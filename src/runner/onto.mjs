/**
 * The onto runner: each job is one `onto do` from the frozen tree, in a node tree named by the job, with what the job
 * writes under `out` brought back to `to`. onto's own README covers `do`, `status` and `jobs`.
 */
import { execFileSync, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readJson, writeJson } from '../json.mjs';

const BUSY = /working tree .* is busy/;
const REFUSED = /\bquiet\b|refuses|is offline|not reachable|unavailable/i;
/**
 * onto's own error from `onto do`'s stderr: from its last `onto do: ` line on, or empty. The job's own output shares
 * the stream, so a fixer that printed "unavailable" is never read as onto refusing it.
 */
export const ontoErrorOf = (stderr) => {
  const at = stderr.lastIndexOf('onto do: ');
  return at < 0 || (at > 0 && stderr[at - 1] !== '\n') ? '' : stderr.slice(at);
};

/** What one `onto do`'s `{ status, stderr, tail }` says happened, as `run` answers it. */
export const launchOf = (r) => {
  const error = ontoErrorOf(r.stderr);
  return {
    status: r.status,
    busy: r.status !== 0 && BUSY.test(error),
    refused: r.status !== 0 && REFUSED.test(error) && !/job .* (failed|exited)/.test(error),
    noRoom: r.status !== 0 && NO_ROOM.test(r.tail),
    node: nodeOfLaunch(r.tail),
  };
};

/** The node onto started a job on, from its `job <id> on <node>` line. */
export const nodeOfLaunch = (text) => /^\s*job\s+\S+\s+on\s+(\S+)/m.exec(text)?.[1];

/** onto's answer when every node it tried is at its ceiling of working trees. */
export const NO_ROOM = /at or over this node's [\d.]+ \w+ ceiling|will not take a new tree/;

const ICONS = { fix: 'wrench.and.screwdriver', review: 'doc.text.magnifyingglass' };

/** `onto do`'s arguments for `job`; see `createOntoRunner`'s `run`. */
export const ontoArgs = (job) => [
  'do', ...(job.gui ? ['--gui'] : []), '--kind', job.kind,
  ...(job.node ? ['--node', job.node] : []), ...(job.tree ? ['--in', job.tree] : []), ...(job.ref ? ['--ref', job.ref] : []), '--force',
  '--timeout', job.timeout, '--expect', job.expect, '--task', job.task, '--about', job.about,
  '--icon', job.icon ?? ICONS[job.kind] ?? ICONS.review,
  '--out', job.out, '--to', job.to,
  ...Object.entries(job.env ?? {}).flatMap(([k, v]) => ['--env', `${k}=${v}`]),
  '--', 'bash', '-lc', job.shell,
];

/** Runs onto once with `args` from `cwd`, its output appended to `log`. Answers `{ status, stderr, tail }`, `tail` the
 *  last 4000 characters of both streams. */
export const ontoOnce = (args, cwd, log) =>
  new Promise((done) => {
    const child = spawn('onto', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let tail = '';
    const keep = (chunk) => {
      tail = (tail + chunk).slice(-4000);
    };
    child.stdout.on('data', (chunk) => {
      keep(chunk);
      log.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      keep(chunk);
      log.write(chunk);
    });
    child.on('error', (error) => done({ status: 1, stderr: String(error), tail: String(error) }));
    child.on('close', (status) => done({ status: status ?? 1, stderr, tail }));
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
 * - `places` (optional), true when the runner picks each job's node itself as the job starts: skulkr then names no
 *   node, bounds only how many jobs run at once (`concurrency`), and reads where each ran from `run`'s `node`.
 * - `run(job, { cwd, log })` launches one job and answers `{ status, busy, refused, noRoom, node? }`: `busy` when the node's
 *   tree is in use and nothing ran (the caller waits and tries again); `refused` when the node turned it away as quiet
 *   or unavailable before anything ran (the caller tries another node); `noRoom` when no node had room for a tree and
 *   nothing ran (the caller waits a minute, without counting it as a failed launch); `node`, where it ran, when the
 *   runner placed it. `job` is `{ kind, node?, tree, ref?, task,
 *   about, expect, timeout, icon?, gui?, out, to, env?, shell }`: `kind` `review` | `fix` | `test`; `tree` the node
 *   tree's name; `ref` the commit the tree syncs against; `expect` a duration or `none`; `timeout` a duration;
 *   `out` the directory in the tree brought back into the local directory `to`; `shell` a bash script.
 * - `unavailableNodes()` answers the nodes the runner reports as quiet or unavailable now, as a Set.
 * - `jobs(sinceIso)` answers the runner's jobs running now or started since then, each
 *   `{ task, node, state, started, finished? }`, or `[]` when it cannot say.
 * - `progress()` (optional) answers each running job's own count of its work by its task, a Map of `{ done, total }`
 *   (its first counter: a reviewer's files read, a fixer's commits of its findings), empty when it cannot say.
 */
/** How long one job listing answers for: the dashboard asks on every poll, and onto takes seconds to list. */
export const JOBS_TTL_MS = 10_000;

/**
 * `fetch(hours)`, onto's job listing for the last `hours`, answered from its last call for {@link JOBS_TTL_MS} when that
 * call covered as much, and from its last good answer when a call throws: a listing that times out under load would
 * otherwise blank every running lane.
 */
export const keptJobs = (fetch, { now = Date.now, store = memoryStore() } = {}) => (hours) => {
  const last = store.read();
  if (last && last.hours >= hours && now() - last.at < JOBS_TTL_MS) return last.jobs;
  try {
    const jobs = fetch(hours);
    store.write({ hours, at: now(), jobs });
    return jobs;
  } catch {
    return last?.jobs ?? [];
  }
};

/** A store for {@link keptJobs} that lives as long as the process. */
export const memoryStore = () => {
  let kept = null;
  return { read: () => kept, write: (v) => { kept = v; } };
};

/**
 * A store for {@link keptJobs} in one file, so the `skulkr map` a dashboard spawns per build keeps the last listing past
 * its own exit. One file, overwritten on every good listing.
 */
export const fileStore = (path) => ({
  read: () => readJson(path) ?? null,
  write: (v) => {
    try {
      writeJson(path, v);
    } catch {
      // A listing that cannot be kept is still answered.
    }
  },
});

/** Where the onto runner keeps its last job listing. */
const JOBS_CACHE = join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'skulkr', 'onto-jobs.json');

export const createOntoRunner = () => {
  const listed = keptJobs((hours) => {
    const out = execFileSync('onto', ['jobs', '--json', '--since', `${hours}h`, '--limit', '1000'],
      { encoding: 'utf8', timeout: 45_000, stdio: ['ignore', 'pipe', 'ignore'] });
    return (JSON.parse(out).jobs ?? []).filter((j) => j.state === 'running' || j.finished);
  }, { store: fileStore(JOBS_CACHE) });
  return {
  // Unpinned, a job waits in onto's queue and starts on whichever node has room first, so no one busy machine
  // holds it; each node's own policy (`onto set --refuse`, `--quiet`, `--weight`) says what it takes.
  places: true,
  run: async (job, { cwd, log }) => launchOf(await ontoOnce(ontoArgs(job), cwd, log)),
  // onto places each job where there is room, so no node needs ruling out here.
  unavailableNodes: () => new Set(),
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
    return listed(Number.isFinite(hours) ? hours : 24);
  },
  };
};

/**
 * The git half of a night: fixer patches onto `audit<N>-<area>` branches, those merged into
 * `batch/<date>-audit<N>`, the round's record committed there, the gate run on its tip, and `main`
 * fast-forwarded when it is green. The names come from the config's `naming`.
 */
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configBaseOf } from './config.mjs';
import { partitionAt, writePartition } from './partition.mjs';
import { appendRecordRow, roundReadme } from './record.mjs';

export const gitIn = (cwd) => (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/**
 * The checkout runs work from: the config's `root`, else the main worktree of the repository holding the config
 * file (or the working directory when there is none).
 */
export const mainCheckout = (cfg) => {
  if (cfg.root) return cfg.root;
  const here = configBaseOf(cfg.file);
  return gitIn(here)('worktree', 'list', '--porcelain').split('\n')[0].replace(/^worktree /, '');
};

const tryGit = (git, ...args) => {
  try {
    return { ok: true, out: git(...args) };
  } catch (error) {
    return { ok: false, out: String(error.stderr || error.message) };
  }
};

/** A detached worktree at `ref` under the main checkout's `.worktrees/`. */
export const addWorktree = (root, name, ref, branch) => {
  const path = join(root, '.worktrees', name);
  if (existsSync(path)) removeWorktree(root, path);
  // -B: a resumed round makes its branches again from the same commit and patches.
  gitIn(root)('worktree', 'add', ...(branch ? ['-B', branch] : ['--detach']), path, ref);
  return path;
};

export const removeWorktree = (root, path) => {
  tryGit(gitIn(root), 'worktree', 'remove', '--force', path);
  rmSync(path, { recursive: true, force: true });
  tryGit(gitIn(root), 'worktree', 'prune');
};

/**
 * `audit<N>-<area>` at the frozen commit with the fixer's mbox applied. Answers the commits it holds,
 * or `{ error }` with the branch deleted when the patches do not apply.
 */
export const applyFix = (cfg, root, { round, area, commit, mbox }) => {
  const branch = cfg.names.area(round, area);
  const tree = addWorktree(root, cfg.names.am(round, area), commit, branch);
  const git = gitIn(tree);
  try {
    const am = tryGit(git, 'am', '--3way', '--keep-cr', mbox);
    if (!am.ok) {
      tryGit(git, 'am', '--abort');
      removeWorktree(root, tree);
      tryGit(gitIn(root), 'branch', '-D', branch);
      return { branch, error: am.out.split('\n').slice(0, 3).join(' ') };
    }
    const commits = git('rev-list', '--reverse', `${commit}..HEAD`).split('\n').filter(Boolean);
    return { branch, commits };
  } finally {
    removeWorktree(root, tree);
  }
};

/** How long a merge that met another git's lock waits before each retry. */
export const LOCK_RETRY_MS = [500, 1000, 2000];
const LOCKED = /\.lock'?: File exists/;
/** @param {number} ms */
const sleep = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};
const firstLines = (text, n = 2) => text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, n).join(' ');
const unmergedIn = (git) => {
  const run = tryGit(git, 'diff', '--name-only', '--diff-filter=U');
  return run.ok ? run.out.split('\n').filter(Boolean) : [];
};

/**
 * `git merge <args>`, retried after `retryMs` while another git holds a lock. Answers `{ ok: true }`, `{ conflict }`
 * with the unmerged paths and the merge left in progress, or `{ error }`, git's first lines, with any half-state aborted.
 */
export const mergeIn = (git, args, { retryMs = LOCK_RETRY_MS, wait = sleep } = {}) => {
  for (let attempt = 0; ; attempt++) {
    const run = tryGit(git, 'merge', ...args);
    if (run.ok) return { ok: true };
    const conflict = unmergedIn(git);
    if (conflict.length) return { ok: false, conflict };
    tryGit(git, 'merge', '--abort');
    if (!LOCKED.test(run.out) || attempt >= retryMs.length) return { ok: false, error: firstLines(run.out) };
    wait(retryMs[attempt]);
  }
};

/**
 * Merges each branch into a new batch branch at `commit`, its name and worktree's ending in `suffix`. One that conflicts is left out in `conflicted` with its
 * unmerged `paths`; one whose merge failed otherwise, in `failed` with git's `error`.
 */
export const makeBatch = (cfg, root, { round, date, commit, branches, suffix = '', retryMs = LOCK_RETRY_MS, wait = sleep }) => {
  const name = `${cfg.names.batch(date, round)}${suffix}`;
  // On main as it is now, so whatever landed since the round froze is in from the start and a branch that conflicts
  // with it is left out here, alone, rather than failing the whole batch's catch-up later.
  const main = cfg.git.main;
  const base = tryGit(gitIn(root), 'merge-base', '--is-ancestor', commit, main).ok ? main : commit;
  const tree = addWorktree(root, `${cfg.names.batchTree(date, round)}${suffix}`, base, name);
  const git = gitIn(tree);
  const merged = [];
  const conflicted = [];
  const failed = [];
  for (const branch of branches) {
    const run = mergeIn(git, ['--no-ff', '--no-edit', '-m', `Merge branch '${branch}' into ${name}`, branch], { retryMs, wait });
    if (run.ok) merged.push(branch);
    else if (run.conflict) {
      tryGit(git, 'merge', '--abort');
      conflicted.push({ branch, paths: run.conflict });
    } else failed.push({ branch, error: run.error });
  }
  return { name, tree, merged, conflicted, failed };
};

/** Writes the round's raw lists, README, partition and ledger row into the batch, and commits them. */
export const commitRecord = (cfg, tree, { round, commit, date, nightDir, areas, sweep, outcomes }) => {
  const recordDir = cfg.record.dir;
  const dir = join(tree, recordDir, `round-${round}`);
  mkdirSync(dir, { recursive: true });
  for (const area of areas) {
    const to = join(dir, area.id);
    mkdirSync(to, { recursive: true });
    for (const file of ['files.txt', 'A.md', 'B.md', 'match.json', 'fix.md', 'carried.json']) {
      const from = join(nightDir, 'areas', area.id, file);
      if (existsSync(from)) cpSync(from, join(to, file));
    }
    writeFileSync(join(to, 'area.json'), `${JSON.stringify(area, null, 1)}\n`);
  }
  if (existsSync(join(nightDir, 'usage.jsonl'))) cpSync(join(nightDir, 'usage.jsonl'), join(dir, 'usage.jsonl'));
  const plugin = cfg.sweep;
  if (plugin && sweep?.ran) {
    const to = join(dir, plugin.id);
    mkdirSync(to, { recursive: true });
    for (const [from, name] of [...(plugin.recordFiles ?? []), ['findings.md', 'findings.md'], ['fix.md', 'fix.md']]) {
      if (existsSync(join(nightDir, plugin.id, from))) cpSync(join(nightDir, plugin.id, from), join(to, name));
    }
  }
  writeFileSync(join(dir, 'README.md'), roundReadme(cfg, { round, commit, date, areas, sweep, outcomes }));
  // The batch's own tree, not the round's commit: it holds whatever landed on main while the round ran.
  writePartition(cfg, tree, partitionAt(cfg, tree, 'HEAD'));
  const paths = [recordDir];
  const ledger = cfg.record.ledger;
  if (ledger) {
    const at = join(tree, ledger.path);
    writeFileSync(at, appendRecordRow(readFileSync(at, 'utf8'), ledger.row({ round, date, areas }), ledger));
    paths.push(ledger.path);
  }
  const git = gitIn(tree);
  git('add', '--', ...paths);
  const trailer = cfg.record.trailer ? `\n\n${cfg.record.trailer}` : '';
  git('commit', '-q', '-m', `record audit round ${round}: ${areas.length} areas' raw findings, estimates and fixes${trailer}`);
  return git('rev-parse', 'HEAD');
};

/**
 * Runs the config's gate on the batch: its command with `{ref}` as the batch branch, from the main checkout or the
 * batch's worktree as `gate.cwd` says, its output to `logPath`. Answers its exit status.
 */
export const runGate = (cfg, { root, batch, logPath, extra = [] }) =>
  new Promise((done) => {
    const log = createWriteStream(logPath, { flags: 'a' });
    const [cmd, ...args] = [...cfg.gate.command.map((a) => a.replaceAll('{ref}', batch.name)), ...extra];
    const child = spawn(cmd, args, { cwd: cfg.gate.cwd === 'root' ? root : batch.tree, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.on('error', () => log.end(() => done(1)));
    // Answered once the log is flushed: a red gate's log is read back for its failures.
    child.on('close', (status) => log.end(() => done(status ?? 1)));
  });

/** Merges `main` into the batch checked out at `tree` unless it already holds it. Answers whether it moved, the new tip, a
 *  conflict, or a merge that `failed` otherwise, with git's message.
 *  A conflict only in `ledger` (the config's `record.ledger`, which every round appends a row to) is two rounds' rows
 *  at one spot: it takes main's copy and appends the batch's own rows to it again.
 * @param {string} tree
 * @param {string} [main]
 * @param {{ path: string, section?: string } | null} [ledger]
 * @param {{ retryMs?: number[], wait?: (ms: number) => void }} [retry]
 */
export const catchUpWithMain = (tree, main = 'main', ledger = null, retry = {}) => {
  const git = gitIn(tree);
  if (tryGit(git, 'merge-base', '--is-ancestor', main, 'HEAD').ok) return { moved: false };
  const run = mergeIn(git, ['--no-edit', '-m', `Merge branch '${main}' into the batch`, main], retry);
  if (run.error) return { moved: false, failed: run.error };
  if (run.conflict) {
    const unmerged = run.conflict;
    if (ledger && unmerged.length === 1 && unmerged[0] === ledger.path && rejoinLedger(git, tree, main, ledger)) {
      return { moved: true, tip: git('rev-parse', 'HEAD') };
    }
    tryGit(git, 'merge', '--abort');
    return { moved: false, conflict: true };
  }
  return { moved: true, tip: git('rev-parse', 'HEAD') };
};

/** Mid-merge, writes main's ledger with the rows only the batch added appended, and commits the merge. Answers whether it did. */
const rejoinLedger = (git, tree, main, ledger) => {
  const show = (rev) => tryGit(git, 'show', `${rev}:${ledger.path}`).out ?? '';
  const rows = (text) => new Set(text.split('\n').filter((l) => l.startsWith('|')));
  const base = rows(show(tryGit(git, 'merge-base', 'HEAD', main).out?.trim() ?? main));
  const theirs = show(main);
  const had = rows(theirs);
  const ours = show('HEAD').split('\n').filter((l) => l.startsWith('|') && !base.has(l) && !had.has(l));
  try {
    const joined = ours.reduce((text, row) => appendRecordRow(text, row, ledger), theirs);
    // `git show` comes back trimmed; a ledger ends with its newline.
    writeFileSync(join(tree, ledger.path), joined.endsWith('\n') ? joined : `${joined}\n`);
  } catch {
    return false;
  }
  return tryGit(git, 'add', ledger.path).ok && tryGit(git, 'commit', '--no-edit', '-q').ok;
};

/**
 * Moves `main` to `tip` when that is a fast-forward and the main checkout is on `main` and clean.
 * Answers what happened, in a sentence for the report.
 */
export const fastForwardMain = (root, tip, main = 'main', { retryMs = LOCK_RETRY_MS, wait = sleep } = {}) => {
  const git = gitIn(root);
  if (git('rev-parse', '--abbrev-ref', 'HEAD') !== main) return `not fast-forwarded: the main checkout is not on ${main}`;
  if (git('status', '--porcelain', '--untracked-files=no')) return 'not fast-forwarded: the main checkout has uncommitted changes';
  const run = mergeIn(git, ['--ff-only', tip], { retryMs, wait });
  return run.ok ? `${main} fast-forwarded to ${tip.slice(0, 10)}` : `not fast-forwarded: ${run.error ?? run.conflict.join(', ')}`;
};

/** Pushes `main` to `remote`. Answers what happened, in a clause for the report; a failure leaves `main` as it is. */
export const pushMain = (root, main = 'main', remote = 'origin') => {
  const run = tryGit(gitIn(root), 'push', '-q', remote, `${main}:${main}`);
  return run.ok ? `pushed to ${remote}` : `not pushed: ${run.out.split('\n').find(Boolean) ?? 'git push failed'}`;
};

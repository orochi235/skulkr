/**
 * How many lines of an area's files changed since its last pass: the changes of every commit after the pass's commit
 * that is not one of the pass's own fixes, counted as `git log --numstat` counts them (added plus deleted). Merges are
 * left out, so a change counts once, in the commit that made it.
 *
 * A commit's counts never change, so they are kept in `~/.cache/skulkr/<name>/churn.json` (outside the project's state,
 * which another service may own) and git is asked only for commits not there yet; the file holds only commits after
 * the oldest pass asked about, rewritten on each build that adds one. The counts hold only the paths `keep` accepted,
 * so the file carries the caller's `cacheKey` for that filter and is dropped when it differs.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** `git log --format=%H %P` lines → each commit's parents. */
const parentsOf = (text) => new Map(text.split('\n').filter(Boolean).map((line) => {
  const [sha, ...parents] = line.split(' ');
  return [sha, parents];
}));

/** The commits in `graph` (each commit's parents) that `from` does not reach: `from..HEAD` within it. */
export const commitsAfter = (graph, from) => {
  const behind = new Set();
  const stack = [from];
  while (stack.length) {
    const sha = stack.pop();
    if (behind.has(sha)) continue;
    behind.add(sha);
    for (const p of graph.get(sha) ?? []) if (graph.has(p)) stack.push(p);
  }
  return [...graph.keys()].filter((sha) => !behind.has(sha));
};

/** `git show --numstat --format=@%H` output → each commit's lines changed by path, for paths `keep` accepts. */
export const parseNumstat = (text, keep = () => true) => {
  const out = {};
  let at = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('@')) {
      at = line.slice(1).trim();
      out[at] = {};
      continue;
    }
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!m || !at || !keep(m[3])) continue;
    out[at][m[3]] = (m[1] === '-' ? 0 : Number(m[1])) + (m[2] === '-' ? 0 : Number(m[2]));
  }
  return out;
};

/** The cached counts at `path`, when they were kept under `key`; none otherwise. */
const readCache = (path, key) => {
  try {
    const file = JSON.parse(readFileSync(path, 'utf8'));
    return file.key === key && file.commits ? file.commits : {};
  } catch {
    return {};
  }
};

const CHUNK = 400;

/**
 * Lines changed since each entry's pass: `entries` are `{ id, files, commit, exclude }` (the area's files now, its
 * last pass's commit, and that pass's fix commits). `git` runs git in the project; `keep(path)` says which paths are
 * worth counting, and `cacheKey` names that filter; `cacheFile` holds the counts between builds, or null for none. Answers a Map id → lines; an entry
 * whose commit git does not know counts 0.
 */
/** @param {(...args: string[]) => string} git @param {{ id: string, files: string[], commit: string, exclude?: string[] }[]} entries @param {{ keep?: (path: string) => boolean, cacheKey?: string, cacheFile?: string | null, root?: string | null }} [opts] */
export const churnSince = (git, entries, { keep = () => true, cacheKey = '', cacheFile = null, root = null } = {}) => {
  const out = new Map(entries.map((e) => [e.id, 0]));
  const asked = [...new Set(entries.map((e) => e.commit).filter(Boolean))];
  if (!asked.length) return out;
  // Every commit after any of them, with its parents, is one walk from their common ancestor. Only when git cannot
  // find that, because a pass names a commit it lacks, is each one checked.
  let known = asked;
  let base;
  try {
    base = asked.length === 1 ? git('rev-parse', '--verify', `${asked[0]}^{commit}`) : git('merge-base', '--octopus', ...asked);
  } catch {
    known = root ? commitsKnown(root, asked) : [];
    if (!known.length) return out;
    base = known.length === 1 ? known[0] : git('merge-base', '--octopus', ...known);
  }
  const graph = parentsOf(git('log', '--format=%H %P', `${base}..HEAD`));
  graph.set(base, []);
  const merges = new Set([...graph].filter(([, ps]) => ps.length > 1).map(([sha]) => sha));

  const cache = cacheFile ? readCache(cacheFile, cacheKey) : {};
  const wanted = [...graph.keys()].filter((sha) => sha !== base && !merges.has(sha));
  const missing = wanted.filter((sha) => !(sha in cache));
  for (let i = 0; i < missing.length; i += CHUNK) {
    Object.assign(cache, parseNumstat(git('show', '--numstat', '--no-renames', '--format=@%H', ...missing.slice(i, i + CHUNK)), keep));
  }
  if (cacheFile && (missing.length || Object.keys(cache).length > wanted.length)) {
    const kept = Object.fromEntries(wanted.map((sha) => [sha, cache[sha] ?? {}]));
    mkdirSync(dirname(cacheFile), { recursive: true });
    writeFileSync(`${cacheFile}.tmp`, JSON.stringify({ key: cacheKey, commits: kept }));
    renameSync(`${cacheFile}.tmp`, cacheFile);
  }

  // Per pass commit, every later commit's lines summed by path; a pass's own fixes are taken back out after.
  const after = new Map();
  for (const c of known) {
    const later = new Set(commitsAfter(graph, c).filter((sha) => !merges.has(sha)));
    const byPath = new Map();
    for (const sha of later) for (const [path, n] of Object.entries(cache[sha] ?? {})) byPath.set(path, (byPath.get(path) ?? 0) + n);
    after.set(c, { later, byPath });
  }
  for (const e of entries) {
    const since = after.get(e.commit);
    if (!since) continue;
    let lines = 0;
    for (const f of e.files) lines += since.byPath.get(f) ?? 0;
    for (const sha of new Set(e.exclude ?? [])) {
      if (!since.later.has(sha)) continue;
      for (const f of e.files) lines -= cache[sha]?.[f] ?? 0;
    }
    out.set(e.id, lines);
  }
  return out;
};

/** Which of `shas` the repository at `root` holds as commits, asked in one `git cat-file --batch-check`. */
const commitsKnown = (root, shas) => {
  if (!shas.length) return [];
  const out = execFileSync('git', ['cat-file', '--batch-check=%(objectname) %(objecttype)'], { cwd: root, input: `${shas.join('\n')}\n`, encoding: 'utf8' });
  const ok = new Set(out.split('\n').flatMap((l) => (l.endsWith(' commit') ? [l.split(' ')[0]] : [])));
  return shas.filter((s) => ok.has(s));
};

/** Where project `name`'s churn counts are kept. */
export const churnCacheOf = (name) => join(homedir(), '.cache', 'skulkr', name, 'churn.json');

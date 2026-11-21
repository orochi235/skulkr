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
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readJson, writeJson } from './json.mjs';

/** `git log --format=%H %P` lines → each commit's parents. */
const parentsOf = (text) => new Map(text.split('\n').filter(Boolean).map((line) => {
  const [sha, ...parents] = line.split(' ');
  return [sha, parents];
}));

/**
 * For each commit of `graph` (each commit's parents, children listed before parents), which of `from` reach it: a
 * bitmask by index into `from`, set for a commit `from[k]` is or descends from. Built in one walk, parents taking
 * their children's bits.
 */
export const reachedBy = (graph, from) => {
  const index = new Map(from.map((sha, k) => [sha, k]));
  const words = Math.max(1, Math.ceil(from.length / 32));
  const masks = new Map();
  const maskOf = (sha) => {
    let m = masks.get(sha);
    if (!m) masks.set(sha, (m = new Uint32Array(words)));
    return m;
  };
  for (const [sha, parents] of graph) {
    const m = maskOf(sha);
    const k = index.get(sha);
    if (k !== undefined) m[k >> 5] |= 1 << (k & 31);
    for (const p of parents) {
      if (!graph.has(p)) continue;
      const pm = maskOf(p);
      for (let w = 0; w < words; w++) pm[w] |= m[w];
    }
  }
  return { masks, index };
};

/** The commits in `graph` (each commit's parents, children listed first) that `from` does not reach: `from..HEAD` within it. */
export const commitsAfter = (graph, from) => {
  const { masks } = reachedBy(graph, [from]);
  return [...graph.keys()].filter((sha) => !(masks.get(sha)[0] & 1));
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
  const file = readJson(path);
  return file?.key === key && file.commits ? file.commits : {};
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
  const graph = parentsOf(git('log', '--topo-order', '--format=%H %P', `${base}..HEAD`));
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
    writeJson(cacheFile, { key: cacheKey, commits: kept });
  }

  // One walk marks which pass commits reach each commit; each entry then sums only its own files' changes.
  const { masks, index } = reachedBy(graph, known);
  const later = (sha, k) => !(masks.get(sha)?.[k >> 5] & (1 << (k & 31)));
  const files = new Set(entries.flatMap((e) => (index.has(e.commit) ? e.files : [])));
  const touches = new Map();
  for (const sha of wanted) {
    for (const [path, n] of Object.entries(cache[sha] ?? {})) {
      if (!files.has(path)) continue;
      if (!touches.has(path)) touches.set(path, []);
      touches.get(path).push([sha, n]);
    }
  }
  for (const e of entries) {
    const k = index.get(e.commit);
    if (k === undefined) continue;
    let lines = 0;
    for (const f of e.files) for (const [sha, n] of touches.get(f) ?? []) if (later(sha, k)) lines += n;
    for (const sha of new Set(e.exclude ?? [])) {
      if (!graph.has(sha) || merges.has(sha) || !later(sha, k)) continue;
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

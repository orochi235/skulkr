/**
 * The rounds whose record recut the partition: the areas each one added, and those it took their files from, as the
 * areas now holding those files. Read from `partition.json` in each round's record commit, against the round before.
 */
import { execFileSync } from 'node:child_process';

/** A chunked directory's part (`partition.mjs`'s `chunk`), and the id it was cut from. */
const PART = /^(.*)\.part\d+$/;

const escapeRe =(s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The commit that recorded each round, by round: the one adding its `README.md` under any of `recordDirs` (the record
 * directory, then those it was moved from). The oldest directory is read first and a round keeps its first commit,
 * since under a pathspec git reads the commit moving the record as adding every round again.
 */
const recordCommitsIn = (git, recordDirs) => {
  const out = new Map();
  for (const recordDir of [...recordDirs].reverse()) {
    const re = new RegExp(`^${escapeRe(recordDir)}/round-(\\d+)/README\\.md$`);
    for (const block of git('log', '--format=%x00%H', '--name-only', '--diff-filter=A', '--', `:(glob)${recordDir}/round-*/README.md`).split('\0').filter(Boolean)) {
      const [sha, ...paths] = block.split('\n').filter(Boolean);
      for (const p of paths) {
        const round = Number(re.exec(p)?.[1]);
        if (round && !out.has(round)) out.set(round, sha);
      }
    }
  }
  return out;
};

/** Each of `specs` (`<rev>:<path>`) as parsed JSON, null where it does not exist, read in one `git cat-file --batch`. */
const jsonAt = (root, specs) => {
  const raw = execFileSync('git', ['cat-file', '--batch'], { cwd: root, input: `${specs.join('\n')}\n`, maxBuffer: 1 << 28 });
  const out = [];
  let at = 0;
  while (at < raw.length && out.length < specs.length) {
    const nl = raw.indexOf(10, at);
    const header = raw.subarray(at, nl).toString();
    if (header.endsWith(' missing')) { out.push(null); at = nl + 1; continue; }
    const n = Number(header.split(' ')[2]);
    try { out.push(JSON.parse(raw.subarray(nl + 1, nl + 1 + n).toString('utf8'))); } catch { out.push(null); }
    at = nl + 1 + n + 1;
  }
  return out;
};

/**
 * The areas `after` added to `before` (two partitions, `[{ id, files }]`) and those that held any of their files in
 * `before`; empty when no id is new.
 */
export const recutIn = (before, after) => {
  const had = new Set(before.map((a) => a.id));
  const added = after.filter((a) => !had.has(a.id));
  if (added.length === 0) return [];
  const heldBy = new Map(before.flatMap((a) => a.files.map((f) => [f, a.id])));
  const from = new Set(added.flatMap((a) => a.files.flatMap((f) => heldBy.get(f) ?? [])));
  // A directory cut into one more part reshuffles every part's files, so each of its parts is recut.
  const chunked = new Set(added.flatMap((a) => PART.exec(a.id)?.[1] ?? []));
  const parts = after.filter((a) => chunked.has(PART.exec(a.id)?.[1])).map((a) => a.id);
  return [...new Set([...added.map((a) => a.id), ...from, ...parts])];
};

/** `ids`, areas of `after` or else `before`, as the areas of `areas` (the partition now) holding any of their files, or
 *  the same id. */
const nowHolding = (ids, before, after, areas) => {
  const byFile = new Map(areas.flatMap((a) => a.files.map((f) => [f, a.id])));
  const now = new Set(areas.map((a) => a.id));
  const files = new Map([...before, ...after].map((a) => [a.id, a.files]));
  const out = new Set();
  for (const id of ids) {
    if (now.has(id)) out.add(id);
    for (const f of files.get(id) ?? []) if (byFile.has(f)) out.add(byFile.get(f));
  }
  return [...out].sort();
};

/** The map's `recuts`: `{ round, areas }` for each recorded round whose partition added an area to the last recorded
 *  round's, `areas` named as `areas` (the partition now) holds them; rounds ascending. */
export const recutsIn = (cfg, git, root, areas) => {
  const commits = [...recordCommitsIn(git, cfg.record.dirs)].sort(([x], [y]) => x - y);
  if (commits.length < 2) return [];
  // A round recorded before the record moved holds its partition where the record was then.
  const paths = cfg.record.dirs.map((d) => (d === cfg.record.dir ? cfg.partition.path : `${d}/partition.json`));
  const found = jsonAt(root, commits.flatMap(([, sha]) => paths.map((p) => `${sha}:${p}`)));
  const parts = commits.map((_, i) => found.slice(i * paths.length, (i + 1) * paths.length).find((p) => p !== null) ?? null);
  const out = [];
  for (let i = 1; i < commits.length; i++) {
    const before = parts[i - 1], after = parts[i];
    if (!Array.isArray(before) || !Array.isArray(after)) continue;
    const ids = recutIn(before, after);
    if (ids.length) out.push({ round: commits[i][0], areas: nowHolding(ids, before, after, areas) });
  }
  return out;
};

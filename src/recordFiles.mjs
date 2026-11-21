/**
 * The per-area round records a project holds: `<record.dir>/round-<N>/<area>/` on disk, and the same paths on the
 * batch branches `main` has not merged, for rounds not on disk. Every reader of earlier rounds walks them through here.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The files of an area's record any reader takes. */
const FILES = new Set(['area.json', 'files.txt', 'A.md', 'B.md', 'match.json', 'fix.md', 'carried.json']);

const ROUND_DIR = /^round-(\d+)$/;

/**
 * Every area record on disk under `recordDir`, rounds ascending: `{ round, id, read }`, `read(name)` answering a file's
 * text or null. Only directories holding an `area.json` count, and round numbers start at 1.
 */
export const diskRecords = (root, recordDir) => {
  const dir = join(root, recordDir);
  if (!existsSync(dir)) return [];
  const rounds = readdirSync(dir).flatMap((name) => Number(ROUND_DIR.exec(name)?.[1]) || []).sort((x, y) => x - y);
  return rounds.flatMap((round) => readdirSync(join(dir, `round-${round}`), { withFileTypes: true }).flatMap((e) => {
    const at = join(dir, `round-${round}`, e.name);
    if (!e.isDirectory() || !existsSync(join(at, 'area.json'))) return [];
    return [{ round, id: e.name, read: (f) => (existsSync(join(at, f)) ? readFileSync(join(at, f), 'utf8') : null) }];
  }));
};

/** The text of each blob in `shas`, by sha, read in one `git cat-file --batch`. */
const blobsIn = (root, shas) => {
  const out = new Map();
  if (shas.length === 0) return out;
  const raw = execFileSync('git', ['cat-file', '--batch'], { cwd: root, input: `${shas.join('\n')}\n`, maxBuffer: 1 << 28 });
  let at = 0;
  while (at < raw.length) {
    const nl = raw.indexOf(10, at);
    const [sha, , size] = raw.subarray(at, nl).toString().split(' ');
    const n = Number(size);
    out.set(sha, raw.subarray(nl + 1, nl + 1 + n).toString('utf8'));
    at = nl + 1 + n + 1;
  }
  return out;
};

/**
 * The area records on each of `refs` for rounds not in `known` (round numbers), each round from the first ref holding
 * it: `{ round, id, read, ref }`, with an `area.json`. Every file is read in one `git cat-file --batch`.
 */
export const refRecords = (git, root, recordDir, refs, known = new Set()) => {
  const re = new RegExp(`^${recordDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/round-(\\d+)/([^/]+)/([^/]+)$`);
  const found = new Map();
  const taken = new Set(known);
  for (const ref of refs) {
    const rounds = new Set();
    for (const line of git('ls-tree', '-r', ref, '--', recordDir).split('\n')) {
      const [meta, path] = line.split('\t');
      const m = path && re.exec(path);
      if (!m || !Number(m[1]) || taken.has(Number(m[1])) || !FILES.has(m[3])) continue;
      rounds.add(Number(m[1]));
      const key = `${m[1]}/${m[2]}`;
      if (!found.has(key)) found.set(key, { round: Number(m[1]), id: m[2], ref, shas: new Map() });
      found.get(key).shas.set(m[3], meta.split(' ')[2]);
    }
    for (const r of rounds) taken.add(r);
  }
  const blobs = blobsIn(root, [...new Set([...found.values()].flatMap((f) => [...f.shas.values()]))]);
  return [...found.values()].filter((f) => f.shas.has('area.json')).sort((x, y) => x.round - y.round)
    .map(({ round, id, ref, shas }) => ({ round, id, ref, read: (f) => (shas.has(f) ? blobs.get(shas.get(f)) : null) }));
};

/** The batch branches not yet merged into `main`, newest name first. */
export const unlandedBatches = (git, batchPrefix, main) =>
  git('for-each-ref', `--no-merged=${main}`, '--sort=-refname', '--format=%(refname:short)', `refs/heads/${batchPrefix}/`)
    .split('\n').filter(Boolean);

const NIGHT = /^\d{4}-\d{2}-\d{2}T.*-round(\d+)$/;

/**
 * The rounds given up for good: those whose latest night directory under `state`'s `nights/` (`<started>-round<N>`)
 * holds an `abandoned` file (its reason). Such a round never lands.
 */
export const abandonedRounds = (state) => {
  const dir = join(state, 'nights');
  if (!existsSync(dir)) return new Set();
  const latest = new Map();
  for (const name of readdirSync(dir).sort()) {
    const m = NIGHT.exec(name);
    if (m) latest.set(Number(m[1]), name);
  }
  return new Set([...latest].flatMap(([round, name]) => (existsSync(join(dir, name, 'abandoned')) ? [round] : [])));
};

/**
 * Every area record `cfg`'s project holds (`diskRecords`, then `refRecords` over its unlanded batches, less those of
 * abandoned rounds). A batch record carries `ref`, its branch.
 */
export const recordsFor = (cfg, git, root) => {
  const disk = diskRecords(root, cfg.record.dir);
  const abandoned = abandonedRounds(cfg.state);
  const refs = unlandedBatches(git, cfg.naming.batchPrefix, cfg.git.main)
    .filter((ref) => !abandoned.has(Number(cfg.names.roundIn.exec(ref)?.[1])));
  return [...disk, ...refRecords(git, root, cfg.record.dir, refs, new Set(disk.map((r) => r.round)))];
};

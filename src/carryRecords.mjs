/**
 * Every round's per-area record that `carry.mjs` reads: under `<record.dir>/round-<N>/<area>/` on disk, and on the
 * batches `main` has not merged, for rounds not on disk.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openFindings } from './carry.mjs';
import { unlandedBatches } from './rounds.mjs';

const FILES = ['A.md', 'B.md', 'match.json', 'fix.md', 'area.json', 'carried.json'];

const json = (text) => {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** One area's record from `read(name)`, which answers a file's text or null. */
export const recordOf = (round, id, read) => {
  const area = json(read('area.json'));
  return {
    round, id, A: read('A.md') ?? '', B: read('B.md') ?? '', fix: read('fix.md') ?? '',
    match: json(read('match.json')), area, carried: json(read('carried.json'))?.findings ?? [],
  };
};

const onDisk = (root, recordDir) => {
  const dir = join(root, recordDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const round = Number(/^round-(\d+)$/.exec(name)?.[1]);
    if (!round) return [];
    return readdirSync(join(dir, name), { withFileTypes: true }).flatMap((e) => {
      const at = join(dir, name, e.name);
      if (!e.isDirectory() || !existsSync(join(at, 'area.json'))) return [];
      return [recordOf(round, e.name, (f) => (existsSync(join(at, f)) ? readFileSync(join(at, f), 'utf8') : null))];
    });
  });
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

const onRefs = (git, root, recordDir, refs, known) => {
  const re = new RegExp(`^${recordDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/round-(\\d+)/([^/]+)/([^/]+)$`);
  const found = new Map();
  for (const ref of refs) {
    const rounds = new Set();
    for (const line of git('ls-tree', '-r', ref, '--', recordDir).split('\n')) {
      const [meta, path] = line.split('\t');
      const m = path && re.exec(path);
      if (!m || known.has(Number(m[1])) || !FILES.includes(m[3])) continue;
      rounds.add(Number(m[1]));
      const key = `${m[1]}/${m[2]}`;
      if (!found.has(key)) found.set(key, { round: Number(m[1]), id: m[2], shas: new Map() });
      found.get(key).shas.set(m[3], meta.split(' ')[2]);
    }
    for (const r of rounds) known.add(r);
  }
  const blobs = blobsIn(root, [...new Set([...found.values()].flatMap((f) => [...f.shas.values()]))]);
  return [...found.values()].flatMap(({ round, id, shas }) =>
    (shas.has('area.json') ? [recordOf(round, id, (f) => (shas.has(f) ? blobs.get(shas.get(f)) : null))] : []));
};

/** The subject of each of a record's applied fix commits, where `git` still has them. */
const withSubjects = (git, rec) => {
  const shas = rec.area?.fixCommits ?? [];
  if (!shas.length || rec.fix) return rec;
  try {
    return { ...rec, subjects: git('show', '-s', '--format=%s', ...shas).split('\n').filter(Boolean) };
  } catch {
    return rec;
  }
};

/** Every area record the project holds, on disk and on unlanded batches. */
export const recordsIn = (cfg, git, root) => {
  const disk = onDisk(root, cfg.record.dir);
  const known = new Set(disk.map((r) => r.round));
  const refs = onRefs(git, root, cfg.record.dir, unlandedBatches(git, cfg.naming.batchPrefix, cfg.git.main), known);
  return [...disk, ...refs].map((r) => withSubjects(git, r));
};

/** The project's open findings by area id (`openFindings`'). */
export const openFindingsIn = (cfg, git, root) => openFindings(recordsIn(cfg, git, root), { cited: cfg.citedRe });

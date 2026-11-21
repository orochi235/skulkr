/**
 * Every round's per-area record that `carry.mjs` reads: under `<record.dir>/round-<N>/<area>/` on disk, and on the
 * batches `main` has not merged, for rounds not on disk.
 */
import { openFindings } from './carry.mjs';
import { recordsFor } from './recordFiles.mjs';

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

/** Every area record the project holds, on disk and on unlanded batches (`recordsFor`). */
export const recordsIn = (cfg, git, root, records = recordsFor(cfg, git, root)) =>
  records.map((r) => withSubjects(git, recordOf(r.round, r.id, r.read)));

/** The project's open findings by area id (`openFindings`'); `records` as `recordsIn`'s. */
export const openFindingsIn = (cfg, git, root, records) => openFindings(recordsIn(cfg, git, root, records), { cited: cfg.citedRe });

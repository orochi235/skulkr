/**
 * The defects each round found in one area, for the audit page: from the round's record where it has landed, or else
 * from its night directory, each with what was broken, what became of it and what the fix changed.
 *
 *   skulkr defects <area>     the area's rounds as JSON, newest first; an area not in the partition is refused
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitIn } from './batch.mjs';
import { reportItems } from './findings.mjs';
import { partitionAt } from './partition.mjs';
import { abandonedRounds, nightsByRound, recordsFor } from './recordFiles.mjs';
import { coveringRounds, inheritPasses, passesFrom } from './rounds.mjs';

const readIf = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null);

/**
 * The findings a match paired, as items no fixer has answered yet: shared ones once, then each reviewer's own. With
 * `whereOf(claim, side)`, each also has its `where`, a shared one's from A, else from B.
 */
export const openItems = (match, whereOf = null) => {
  const a = match.a ?? [], b = match.b ?? [], pairs = match.pairs ?? [];
  const pairedA = new Set(pairs.map(([i]) => i)), pairedB = new Set(pairs.map(([, j]) => j));
  const open = (claim, from, where) => ({ claim, from, verdict: 'open', note: '', ...(whereOf ? { where: where() || '' } : {}) });
  return [
    ...pairs.map(([i, j]) => open(a[i], 'A+B', () => whereOf(a[i], 'A') || whereOf(b[j], 'B'))),
    ...a.flatMap((c, i) => (pairedA.has(i) ? [] : [open(c, 'A', () => whereOf(c, 'A'))])),
    ...b.flatMap((c, j) => (pairedB.has(j) ? [] : [open(c, 'B', () => whereOf(c, 'B'))])),
  ];
};

/** The subject of each commit in a fixer's mbox, a folded subject joined back into one line. */
export const commitSubjects = (mbox) =>
  [...mbox.matchAll(/^Subject: (?:\[PATCH[^\]]*\] )?(.*(?:\n[ \t].*)*)/gm)].map((m) => m[1].replace(/\n[ \t]+/g, ' ').trim());

/**
 * One round's items for an area from `read(name)`, which answers one of its files' text or null: the fixer's report,
 * or else the match, with the commits of a fixer that left some but no report, as one stopped partway does. A report
 * that gives no verdict (a usage-limit refusal written in its place) counts as none.
 */
const itemsOf = (read) => {
  const report = read('fix.md');
  const answered = report === null ? [] : reportItems(report);
  if (answered.length) return { fixed: true, items: answered };
  const match = read('match.json');
  if (match === null) return null;
  const mbox = read('fix.mbox');
  return { fixed: false, items: openItems(JSON.parse(match)), ...(mbox ? { commits: commitSubjects(mbox) } : {}) };
};

/** Several records' items (`itemsOf`') for one round as one: items and commits joined, fixed once all were. */
const joinedOf = (got) => ({
  fixed: got.every((g) => g.fixed), items: got.flatMap((g) => g.items),
  ...(got.some((g) => g.commits) ? { commits: got.flatMap((g) => g.commits ?? []) } : {}),
});

/**
 * Every round that has read area `id` of `areas`, newest first: `{ round, recorded, fixed, items, commits? }`.
 * `records` are `recordFiles.mjs`' (`recordsFor`'s, abandoned rounds left out). An area's rounds are its covering
 * rounds (`coveringRounds` of its `inheritPasses` history), so they follow its files across a recut, and every round
 * holding a record of its own id; a round's records are joined. A round with no record at all, unless abandoned, is
 * read from its night directory under `state`, unrecorded.
 */
export const areaDefects = ({ records, areas, id, state }) => {
  const byKey = new Map(records.map((r) => [`${r.round}\n${r.id}`, r]));
  const history = inheritPasses(areas, passesFrom(records)).history.get(id) ?? [];
  const keys = new Set([
    ...coveringRounds(history).flatMap((r) => r.passes.map((p) => `${p.round}\n${p.id}`)),
    ...records.filter((r) => r.id === id).map((r) => `${r.round}\n${r.id}`),
  ]);
  const byRound = new Map();
  for (const key of keys) {
    const rec = byKey.get(key);
    const got = rec && itemsOf(rec.read);
    if (!got) continue;
    if (!byRound.has(rec.round)) byRound.set(rec.round, { recorded: !rec.ref, got: [] });
    byRound.get(rec.round).got.push(got);
  }
  const found = [...byRound].map(([round, { recorded, got }]) => ({ round, recorded, ...joinedOf(got) }));
  const recordedRounds = new Set(records.map((r) => r.round));
  const nights = nightsByRound(state);
  const abandoned = abandonedRounds(state, nights);
  for (const { round, dir } of nights.values()) {
    if (recordedRounds.has(round) || abandoned.has(round)) continue;
    const got = itemsOf((f) => readIf(join(dir, 'areas', id, f)));
    if (got) found.push({ round, recorded: false, ...got });
  }
  return found.sort((x, y) => y.round - x.round);
};

/**
 * `areaDefects` for `cfg`'s project, for an `id` among `areas` (the partition at HEAD) only: the id comes from the
 * dashboard and becomes a path, so any other is refused.
 */
export const defectsFor = (cfg, root, id, areas = partitionAt(cfg, root, 'HEAD'), git = gitIn(root)) => {
  if (!areas.some((a) => a.id === id)) throw new Error(`no area named ${JSON.stringify(id)}; see ${cfg.partition.path}`);
  return areaDefects({ records: recordsFor(cfg, git, root), areas, id, state: cfg.state });
};

/**
 * The defects each round found in one area, for the audit page: from the round's record where it has landed, or else
 * from its night directory, each with what was broken, what became of it and what the fix changed.
 *
 *   skulkr defects <area>     the area's rounds as JSON, newest first; an area not in the partition is refused
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { reportItems } from './findings.mjs';
import { partitionAt } from './partition.mjs';
import { ROUND_DIR, nightsByRound } from './recordFiles.mjs';

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
 * One round's items for an area, from the directory holding its files: the fixer's report, or else the match, with
 * the commits of a fixer that left some but no report, as one stopped partway does.
 */
const itemsIn = (dir) => {
  const report = readIf(join(dir, 'fix.md'));
  if (report !== null) return { fixed: true, items: reportItems(report) };
  const match = readIf(join(dir, 'match.json'));
  if (match === null) return null;
  const mbox = readIf(join(dir, 'fix.mbox'));
  return { fixed: false, items: openItems(JSON.parse(match)), ...(mbox ? { commits: commitSubjects(mbox) } : {}) };
};

/**
 * Every round that has read `id`, newest first: `{ round, recorded, fixed, items, commits? }`, from the records under
 * `recordDir` (the config's `record.dir`) and the night directories under `state`.
 */
export const areaDefects = (root, id, state, recordDir) => {
  const found = new Map();
  const audits = join(root, recordDir);
  for (const name of existsSync(audits) ? readdirSync(audits) : []) {
    const m = ROUND_DIR.exec(name);
    const got = m && itemsIn(join(audits, name, id));
    if (got) found.set(Number(m[1]), { round: Number(m[1]), recorded: true, ...got });
  }
  for (const { round, dir } of nightsByRound(state).values()) {
    if (found.get(round)?.recorded) continue;
    const got = itemsIn(join(dir, 'areas', id));
    if (got) found.set(round, { round, recorded: false, ...got });
  }
  return [...found.values()].sort((x, y) => y.round - x.round);
};

/**
 * `areaDefects` for `cfg`'s project, for an `id` among `areas` (the partition at HEAD) only: the id comes from the
 * dashboard and becomes a path, so any other is refused.
 */
export const defectsFor = (cfg, root, id, areas = partitionAt(cfg, root, 'HEAD')) => {
  if (!areas.some((a) => a.id === id)) throw new Error(`no area named ${JSON.stringify(id)}; see ${cfg.partition.path}`);
  return areaDefects(root, id, cfg.state, cfg.record.dir);
};

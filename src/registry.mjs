/**
 * The defect registry: `<record.dir>/defects/<area>.jsonl`, one line per defect the project's rounds and landed
 * saturation ledgers found, filed under the area now holding its cited files. Written from the record by
 * `defectGraph.mjs`'s rule, never by hand, whenever a round's record or a saturation ledger is committed; `skulkr
 * registry` writes it again. README.md, "The defect registry", is its documentation.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { recordsIn } from './carryRecords.mjs';
import { defectGraphOf } from './defectGraph.mjs';
import { diskRecords } from './recordFiles.mjs';
import { landedLedgersUnder } from './scourPaths.mjs';

/** The registry's directory, relative to the project's root. */
export const registryDirOf = (cfg) => `${cfg.record.dir}/defects`;

/** A defect's id from the key of its first sighting: stable, and given out with no counter to collide on. */
const idFor = (key) => `d-${createHash('sha1').update(key).digest('hex').slice(0, 10)}`;

/** A fixer's verdict as a status. */
const STATUS = { fixed: 'fixed', 'not a defect': 'dismissed', duplicate: 'duplicate', question: 'question', 'not fixed': 'declined' };

/** A defect of the graph as a registry line. */
export const entryOf = (o) => ({
  id: idFor(o.round === null ? `saturation:${o.id}` : `round:${o.round}/${o.area}/${o.id}`),
  area: o.to,
  claim: o.claim,
  where: o.where,
  files: o.paths,
  severity: o.severity,
  ...(o.triage ? { triage: o.triage } : {}),
  status: o.acted ? STATUS[o.resolved?.verdict] ?? 'closed' : 'open',
  ...(o.acted && o.resolved ? { resolved: o.resolved } : {}),
  first: o.first,
  sightings: [
    ...o.rounds.map((round, i) => ({ round, ...(i === 0 && o.round !== null ? { area: o.area, from: o.from } : {}) })),
    ...o.saturation,
  ],
});

/**
 * The landed saturation ledgers under `root`, each placed ahead of the first round in `records` reviewed at or after
 * its commit (`before`; Infinity for none), as `defectGraphOf` reads them.
 */
export const landedLedgersIn = (cfg, git, root, records) => {
  const landed = landedLedgersUnder(cfg, root);
  if (landed.length === 0) return [];
  const commits = [...new Map(records.filter((r) => r.area?.commit).map((r) => [r.round, r.area.commit]))].sort(([x], [y]) => x - y);
  const after = new Map();
  const isAfter = (base, commit) => {
    const key = `${base} ${commit}`;
    if (!after.has(key)) {
      try {
        git('merge-base', '--is-ancestor', base, commit);
        after.set(key, true);
      } catch {
        after.set(key, false);
      }
    }
    return after.get(key);
  };
  return landed.map(({ short, ledger }) => {
    const before = commits.find(([, commit]) => isAfter(ledger.commit, commit))?.[0] ?? Infinity;
    return { key: `${ledger.area}@${short}`, area: ledger.area, commit: ledger.commit, before, defects: ledger.defects };
  });
};

/** Every registry line the project's record under `root` gives, by id. */
export const registryOf = (cfg, git, root) => {
  const records = recordsIn(cfg, git, root, diskRecords(root, cfg.record.dir));
  const partition = join(root, cfg.partition.path);
  const areas = existsSync(partition) ? JSON.parse(readFileSync(partition, 'utf8')) : undefined;
  const ledgers = landedLedgersIn(cfg, git, root, records);
  return defectGraphOf(records, { cited: cfg.citedRe, areas, ledgers }).map(entryOf).sort((x, y) => (x.id < y.id ? -1 : 1));
};

/**
 * Writes the registry under `root`: a file per area, a line per defect, and no file for an area with none. Answers
 * its directory, relative to `root`, for `git add`.
 */
export const writeRegistry = (cfg, git, root) => {
  const rel = registryDirOf(cfg);
  const dir = join(root, rel);
  const byArea = new Map();
  for (const e of registryOf(cfg, git, root)) {
    if (!byArea.has(e.area)) byArea.set(e.area, []);
    byArea.get(e.area).push(JSON.stringify(e));
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [area, lines] of byArea) writeFileSync(join(dir, `${area}.jsonl`), `${lines.join('\n')}\n`);
  return rel;
};

/** The registry as committed under `root`: every line of every area's file. */
export const readRegistry = (cfg, root) => {
  const dir = join(root, registryDirOf(cfg));
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort().flatMap((f) =>
    readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)));
};

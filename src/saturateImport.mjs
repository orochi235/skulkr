/**
 * `skulkr scour import <area> <dir> --at <sha>`: a ledger built from a saturation experiment run by hand, every
 * occasion a Claude review. `<dir>` holds `reviews/NN.md`, `occasions.json` (`{ "1": [findings, costUsd, minutes] }`),
 * `sightings.json` (`{ "1": ["V1", …] }`, the defects each occasion reported) and `defects.json`
 * (`[{ id, claim, where, severity, source? }]`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freezeCommitOf, keepReview, requireAreaFilesAt, reviewFileOf, requireSameCommit, withLedgerHeld, writeLedger } from './ledger.mjs';
import { scourRuleOf } from './scourPrice.mjs';
import { writeReport } from './saturationReport.mjs';

const SOURCE = 'claude';

const readJsonIn = (dir, name) => {
  const path = join(dir, name);
  if (!existsSync(path)) throw new Error(`import: no ${name} in ${dir}`);
  return JSON.parse(readFileSync(path, 'utf8'));
};

/** The number in an id such as `V12`, for ordering ids as numbers rather than text. */
const idNumber = (id) => Number(/(\d+)$/.exec(id)?.[1] ?? Number.MAX_SAFE_INTEGER);

/**
 * The ledger an experiment's files describe, at `commit` over `files`, with `reviewFile(n)` the kept report's path.
 * Occasions run 1…m with no gap; each sighting names an occasion and a defect `defects` lists. Defects take ledger ids
 * D1… in the order of their own ids' numbers; one no occasion sighted keeps empty sightings, and its `source`.
 */
export const importedLedgerOf = ({ area, commit, files, occasions, sightings, defects, reviewFile, at }) => {
  const ns = Object.keys(occasions).map(Number).sort((a, b) => a - b);
  if (ns.some((n, i) => n !== i + 1)) throw new Error(`import: occasions must run 1…${ns.length} with no gap, not ${ns.join(', ')}`);
  const known = new Map(defects.map((d) => [d.id, d]));
  if (known.size !== defects.length) throw new Error('import: defects.json lists an id twice');
  const seenAt = new Map(defects.map((d) => [d.id, []]));
  for (const [key, ids] of Object.entries(sightings)) {
    const n = Number(key);
    if (!ns.includes(n)) throw new Error(`import: sightings.json names occasion ${key}, which occasions.json lacks`);
    for (const id of new Set(ids)) {
      if (!known.has(id)) throw new Error(`import: occasion ${n} sights ${id}, which defects.json lacks`);
      seenAt.get(id).push(n);
    }
  }
  const ordered = [...defects].sort((a, b) => idNumber(a.id) - idNumber(b.id));
  return {
    area, commit, files,
    occasions: ns.map((n) => {
      const [findings, costUsd, minutes] = occasions[String(n)];
      return { n, source: SOURCE, kind: 'review', file: reviewFile(n), findings, costUsd, minutes, at };
    }),
    defects: ordered.map((d, i) => {
      const seen = seenAt.get(d.id).sort((a, b) => a - b);
      return {
        id: `D${i + 1}`, claim: d.claim, where: d.where ?? '', severity: String(d.severity ?? '').toLowerCase(),
        firstOccasion: seen[0] ?? null, sightings: seen, sources: seen.length ? { [SOURCE]: seen } : {},
        imported: d.id, ...(seen.length === 0 && d.source ? { source: d.source } : {}),
      };
    }),
  };
};

/** Builds `id`'s ledger from the experiment in `dir`, at `--at`. Answers the ledger. */
export const importLedger = async (cfg, root, id, dir, args, say) => {
  if (args.at === undefined) throw new Error('import wants --at <sha>: the commit the experiment reviewed');
  const commit = freezeCommitOf(cfg, root, args.at);
  const occasions = readJsonIn(dir, 'occasions.json');
  const sightings = readJsonIn(dir, 'sightings.json');
  const defects = readJsonIn(dir, 'defects.json');
  const reviewPath = (n) => join(dir, 'reviews', `${String(n).padStart(2, '0')}.md`);
  for (const n of Object.keys(occasions)) if (!existsSync(reviewPath(n))) throw new Error(`import: no ${reviewPath(n)}`);
  return withLedgerHeld(cfg, id, { fresh: args.fresh }, async (held) => {
    requireSameCommit(held, args.at, commit);
    if (held) throw new Error(`${id} already has a ledger; --fresh sets it aside first`);
    const ledger = importedLedgerOf({
      area: id, commit, files: requireAreaFilesAt(cfg, root, id, commit), occasions, sightings, defects, at: new Date().toISOString(),
      reviewFile: (n) => reviewFileOf(n, SOURCE),
    });
    for (const o of ledger.occasions) keepReview(cfg, id, o.n, SOURCE, readFileSync(reviewPath(o.n), 'utf8'));
    writeLedger(cfg, ledger);
    say(`imported ${ledger.occasions.length} occasions and ${ledger.defects.length} defects into ${id}'s ledger at ${commit.slice(0, 10)}`);
    say(`saturate ${id}: report at ${writeReport(cfg, id, ledger, scourRuleOf(cfg, root, args))}`);
    return ledger;
  });
};

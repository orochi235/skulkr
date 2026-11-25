/**
 * `skulkr scour ls`: every saturation ledger in the state directory, summed up with its defects, for the dashboard's
 * saturation page (`--json`) or a terminal.
 */
import { existsSync, readdirSync } from 'node:fs';
import { gitIn } from './batch.mjs';
import { ledgerOf } from './ledger.mjs';
import { queryIndex } from './recordIndex.mjs';
import { chao2, sourcesOf, stopReason, stopRuleOf } from './saturation.mjs';
import { landedLedgersUnder, scourStateDirOf } from './scourPaths.mjs';

/**
 * One ledger's summary and defects; `id` is its directory, an area or a set-aside `<area>.<commit>`. `registered`
 * answers, for a landed ledger's key, each of its defects' registry line by defect id (`{ id, status, sha }`).
 */
export const ledgerSummaryOf = (cfg, id, ledger, registered = () => new Map()) => {
  const inRegistry = registered(`${ledger.area}@${ledger.commit.slice(0, 10)}`);
  const stats = chao2(ledger.occasions, ledger.defects);
  const costUsd = ledger.occasions.reduce((sum, o) => sum + (o.costUsd ?? 0), 0);
  return {
    id,
    area: ledger.area,
    commit: ledger.commit,
    files: ledger.files.length,
    occasions: ledger.occasions.length,
    sources: Object.fromEntries(sourcesOf(ledger).map((s) => [s, ledger.occasions.filter((o) => o.source === s).length])),
    costUsd,
    distinct: ledger.defects.length,
    total: stats.total ?? null,
    unseen: stats.f0 ?? null,
    nextNew: stats.nextNew ?? null,
    stopped: ledger.occasions.length ? stopReason(stats, stopRuleOf(cfg, cfg.saturate.max)) : null,
    updated: ledger.occasions.at(-1)?.at ?? null,
    defects: ledger.defects.map((d) => ({
      id: d.id,
      claim: d.claim,
      where: d.where,
      severity: d.severity ?? '',
      sightings: d.sightings.length,
      firstOccasion: d.firstOccasion ?? null,
      sources: Object.keys(d.sources ?? {}).filter((s) => d.sources[s].length),
      onlyBy: d.sightings.length ? null : d.source ?? null,
      registry: inRegistry.get(d.id) ?? null,
    })),
  };
};

/** For a landed ledger's key, its defects' registry lines by defect id, read from the index of the record under `root`. */
const registeredIn = (cfg, root) => {
  let rows = [];
  try {
    rows = queryIndex(cfg, gitIn(root), root, 'select s.ledger, s.ledger_defect, d.id, d.status, d.resolved_sha from sightings s join defects d on d.id = s.defect where s.ledger is not null');
  } catch { /* no record to index */ }
  const byLedger = new Map();
  for (const r of rows) {
    if (!byLedger.has(r.ledger)) byLedger.set(r.ledger, new Map());
    byLedger.get(r.ledger).set(r.ledger_defect, { id: r.id, status: r.status, sha: r.resolved_sha });
  }
  return (key) => byLedger.get(key) ?? new Map();
};

/** Every ledger in `cfg`'s state directory, summed up, by id; each landed one's defects with their registry lines from `root`'s record. */
export const ledgerListOf = (cfg, root) => {
  const dir = scourStateDirOf(cfg);
  if (!existsSync(dir)) return [];
  const registered = root ? registeredIn(cfg, root) : undefined;
  return readdirSync(dir).sort().flatMap((id) => {
    const ledger = ledgerOf(cfg, id);
    return ledger ? [ledgerSummaryOf(cfg, id, ledger, registered)] : [];
  });
};

const fixed = (n, digits) => (n === null ? '–' : n.toFixed(digits));

/** The list as terminal lines, one per ledger, the numbers right-aligned. */
export const ledgerListLines = (list) => {
  const width = Math.max(4, ...list.map((l) => l.id.length));
  return [
    `${'area'.padEnd(width)}  occ  distinct  unseen  next-new     cost`,
    ...list.map((l) => `${l.id.padEnd(width)}  ${String(l.occasions).padStart(3)}  ${String(l.distinct).padStart(8)}  ${fixed(l.unseen, 1).padStart(6)}  ${(l.nextNew === null ? '–' : `${(l.nextNew * 100).toFixed(1)}%`).padStart(8)}  ${`$${l.costUsd.toFixed(2)}`.padStart(7)}`),
  ];
};

/**
 * The areas with a ledger, in the state directory or landed under `root`, holding an occasion from `source` (any
 * source when it is undefined). Names only: a reviewer that must stay blind to a ledger can ask it.
 */
export const scouredAreasOf = (cfg, root, source) => {
  const has = (ledger) => ledger.occasions.some((o) => source === undefined || o.source === source);
  const dir = scourStateDirOf(cfg);
  const kept = existsSync(dir) ? readdirSync(dir).flatMap((id) => {
    const ledger = ledgerOf(cfg, id);
    return ledger && has(ledger) ? [ledger.area] : [];
  }) : [];
  const landed = root ? landedLedgersUnder(cfg, root).filter(({ ledger }) => has(ledger)).map(({ ledger }) => ledger.area) : [];
  return [...new Set([...kept, ...landed])].sort();
};

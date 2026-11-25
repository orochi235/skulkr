/**
 * `skulkr saturate ls`: every saturation ledger in the state directory, summed up with its defects, for the dashboard's
 * saturation page (`--json`) or a terminal.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ledgerOf } from './ledger.mjs';
import { chao2, sourcesOf, stopReason, stopRuleOf } from './saturation.mjs';

/** One ledger's summary and defects; `id` is its directory, an area or a set-aside `<area>.<commit>`. */
export const ledgerSummaryOf = (cfg, id, ledger) => {
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
    })),
  };
};

/** Every ledger in `cfg`'s state directory, summed up, by id. */
export const ledgerListOf = (cfg) => {
  const dir = join(cfg.state, 'saturation');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().flatMap((id) => {
    const ledger = ledgerOf(cfg, id);
    return ledger ? [ledgerSummaryOf(cfg, id, ledger)] : [];
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

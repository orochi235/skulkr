/**
 * `skulkr scour ls`: every saturation ledger in the state directory, summed up with its defects, for the dashboard's
 * saturation page (`--json`) or a terminal.
 */
import { existsSync, readdirSync } from 'node:fs';
import { gitIn } from './batch.mjs';
import { liveScourOf } from './delveLive.mjs';
import { ledgerOf } from './ledger.mjs';
import { queryIndex } from './recordIndex.mjs';
import { chao2, limitText, sourcesOf, stopReason } from './saturation.mjs';
import { partitionAt } from './partition.mjs';
import { nextPriceOf, passRowsOf, pricingOf, scourRuleOf } from './scourPrice.mjs';
import { candidatePricesOf, scourQueueOf } from './scourQueue.mjs';
import { ledgerLinesOf, perKloc } from './scourLines.mjs';
import { landedLedgersUnder, scourStateDirOf } from './scourPaths.mjs';

/**
 * One ledger's summary and defects; `id` is its directory, an area or a set-aside `<area>.<commit>`. `registered`
 * answers, for a landed ledger's key, each of its defects' registry line by defect id (`{ id, status, sha }`).
 */
export const ledgerSummaryOf = (cfg, id, ledger, registered = () => new Map(), rule = scourRuleOf(cfg, undefined)) => {
  const inRegistry = registered(`${ledger.area}@${ledger.commit.slice(0, 10)}`);
  const stats = chao2(ledger.occasions, ledger.defects);
  const price = nextPriceOf(ledger, rule.factor);
  const costUsd = ledger.occasions.reduce((sum, o) => sum + (o.costUsd ?? 0), 0);
  return {
    id,
    area: ledger.area,
    commit: ledger.commit,
    files: ledger.files.length,
    lines: ledger.lines ?? null,
    occasions: ledger.occasions.length,
    sources: Object.fromEntries(sourcesOf(ledger).map((s) => [s, ledger.occasions.filter((o) => o.source === s).length])),
    costUsd,
    distinct: ledger.defects.length,
    total: stats.total ?? null,
    unseen: stats.f0 ?? null,
    nextNew: stats.nextNew ?? null,
    nextUsd: price.usd === undefined || !Number.isFinite(price.usd) ? null : price.usd,
    limit: { usd: rule.stopUsdPerDefect, times: rule.limit?.times ?? null, goingUsd: rule.limit?.goingUsd ?? null, text: limitText(rule) },
    defectsPerKloc: perKloc(ledger.defects.length, ledger.lines),
    unseenPerKloc: perKloc(stats.f0, ledger.lines),
    usdPerKloc: perKloc(costUsd, ledger.lines),
    passes: passRowsOf(ledger, rule.factor),
    stopped: ledger.occasions.length ? stopReason(stats, rule, { price, lines: ledger.lines }) : null,
    updated: ledger.occasions.at(-1)?.at ?? null,
    defects: ledger.defects.map((d) => ({
      id: d.id,
      claim: d.claim,
      where: d.where,
      severity: d.severity ?? '',
      sightings: d.sightings.length,
      seenAt: [...d.sightings],
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

/**
 * Every ledger in `cfg`'s state directory, summed up, by id; each landed one's defects with their registry lines from
 * `root`'s record, and `running`, what a live scour process holding it is doing (`liveScourOf`), else null.
 */
export const ledgerListOf = (cfg, root) => {
  const dir = scourStateDirOf(cfg);
  if (!existsSync(dir)) return [];
  const registered = root ? registeredIn(cfg, root) : undefined;
  const ledgers = readdirSync(dir).sort().flatMap((id) => {
    const ledger = ledgerOf(cfg, id);
    return ledger ? [[id, ledger.lines === undefined ? { ...ledger, lines: ledgerLinesOf(cfg, root, ledger, id) } : ledger]] : [];
  });
  const rule = scourRuleOf(cfg, root, {}, ledgers.map(([, ledger]) => ledger));
  return ledgers.map(([id, ledger]) => ({ ...ledgerSummaryOf(cfg, id, ledger, registered, rule), running: liveScourOf(cfg, id) }));
};

/**
 * Every area of the partition at `main`'s tip that `scour run` would delve, in the order it would take them; `list` is
 * `ledgerListOf`'s, whose `running` ledgers are left out.
 */
export const scourQueueIn = (cfg, root, list) => {
  const held = new Set(list.filter((l) => l.running).map((l) => l.area));
  const ids = partitionAt(cfg, root, cfg.git.main).map((a) => a.id);
  return scourQueueOf(candidatePricesOf(cfg, root, ids, scourRuleOf(cfg, root), pricingOf(cfg)), (id) => held.has(id)).map((c) => c.id);
};

const fixed = (n, digits) => (n === null ? '–' : n.toFixed(digits));

/** The list as terminal lines, one per ledger, the numbers right-aligned. */
export const ledgerListLines = (list) => {
  const width = Math.max(4, ...list.map((l) => l.id.length));
  const usd = (n) => (n === null ? '–' : `$${n.toFixed(2)}`);
  const cells = (l) => [
    l.id.padEnd(width),
    String(l.lines ?? '–').padStart(6),
    String(l.occasions).padStart(3),
    String(l.distinct).padStart(8),
    fixed(l.defectsPerKloc, 1).padStart(6),
    fixed(l.unseen, 1).padStart(6),
    fixed(l.unseenPerKloc, 1).padStart(6),
    (l.nextNew === null ? '–' : `${(l.nextNew * 100).toFixed(1)}%`).padStart(8),
    usd(l.nextUsd).padStart(6),
    usd(l.costUsd).padStart(7),
    usd(l.usdPerKloc).padStart(7),
  ].join('  ');
  return [
    `${'area'.padEnd(width)}   lines  occ  distinct  /kloc  unseen  /kloc  next-new  next $     cost    /kloc`,
    ...list.map(cells),
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

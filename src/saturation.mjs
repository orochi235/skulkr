/**
 * Capture–recapture over a saturation ledger (`ledger.mjs`): each occasion is one sample, each defect's sightings its
 * incidence. README "Scour" says what each figure means and when to trust it.
 */
import { chapman } from './rounds.mjs';

/** The occasion numbers of `occasions`, whether given as numbers or as the ledger's occasion records. */
const numbersOf = (occasions) => new Set(occasions.map((o) => (typeof o === 'number' ? o : o.n)));

/**
 * Chao2 over `occasions` (numbers or records) and `defects` (each with `sightings`, occasion numbers): `m` samples,
 * `S` defects seen, `Q1`/`Q2` those seen exactly once/twice, `U` all sightings, `f0` the unseen estimate (bias-corrected
 * when Q2 is 0), `total` S + f0, `coverage` the sample coverage, and `nextNew` the chance the next occasion's finding is
 * new. With fewer than two occasions, every estimate is undefined.
 */
export const chao2 = (occasions, defects) => {
  const at = numbersOf(occasions);
  const m = at.size;
  const counts = defects.map((d) => new Set(d.sightings.filter((n) => at.has(n))).size).filter((y) => y > 0);
  const S = counts.length;
  const Q1 = counts.filter((y) => y === 1).length;
  const Q2 = counts.filter((y) => y === 2).length;
  const U = counts.reduce((s, y) => s + y, 0);
  if (m < 2) return { m, S, Q1, Q2, U, f0: undefined, total: undefined, coverage: undefined, nextNew: undefined };
  const k = (m - 1) / m;
  const f0 = Q2 > 0 ? k * Q1 * Q1 / (2 * Q2) : k * Q1 * Math.max(0, Q1 - 1) / 2;
  const coverage = Q1 === 0 ? 1 : 1 - (Q1 / U) * (((m - 1) * Q1) / ((m - 1) * Q1 + 2 * Q2));
  return { m, S, Q1, Q2, U, f0, total: S + f0, coverage, nextNew: 1 - coverage };
};

/** The sources a ledger's occasions came from, in the order each first appears. */
export const sourcesOf = (ledger) => [...new Set(ledger.occasions.map((o) => o.source))];

/** Chao2 per source, over that source's occasions alone: `{ source: stats }`. */
export const perSource = (ledger) => Object.fromEntries(sourcesOf(ledger).map((s) => [s, chao2(ledger.occasions.filter((o) => o.source === s), ledger.defects)]));

/**
 * Chapman between each pair of sources, each source's union of defects one list: `{ a, b, n1, n2, overlap, total }`.
 * Empty with fewer than two sources.
 */
export const chapmanPairs = (ledger) => {
  const sources = sourcesOf(ledger);
  const seenBy = (s) => new Set(ledger.defects.filter((d) => d.sources?.[s]?.length).map((d) => d.id));
  return sources.flatMap((a, i) => sources.slice(i + 1).map((b) => {
    const [x, y] = [seenBy(a), seenBy(b)];
    const overlap = [...x].filter((id) => y.has(id)).length;
    return { a, b, n1: x.size, n2: y.size, overlap, total: chapman(x.size, y.size, overlap) };
  }));
};

/** Every estimate over the whole ledger: `combined` Chao2, `perSource`, and `chapman` between sources. */
export const estimatesOf = (ledger) => ({ combined: chao2(ledger.occasions, ledger.defects), perSource: perSource(ledger), chapman: chapmanPairs(ledger) });

/**
 * The yield table: one row per occasion, in order, with what it found (`findings`, `new`), the combined estimate over
 * the occasions up to it, what they have cost (`spentUsd`), and that per distinct defect so far (`usdPerDefect`,
 * undefined while none is found).
 */
export const yieldRows = (ledger) => {
  const occasions = [...ledger.occasions].sort((a, b) => a.n - b.n);
  let spentUsd = 0;
  return occasions.map((o, i) => {
    spentUsd += o.costUsd ?? 0;
    const stats = chao2(occasions.slice(0, i + 1), ledger.defects);
    return {
      ...o,
      new: ledger.defects.filter((d) => d.firstOccasion === o.n).length,
      stats,
      spentUsd,
      usdPerDefect: stats.S > 0 ? spentUsd / stats.S : undefined,
    };
  });
};

/**
 * The stop rule `stopReason` takes: `max` occasions, the config's `saturate.stopNextNew`, the most the next defect may
 * cost (`perDefect`, else `saturate.stopUsdPerDefect`), `usd`, the most one command may spend, if any, and `factor`,
 * the pricing calibration (`scourPrice.mjs`).
 */
export const stopRuleOf = (cfg, max, { perDefect, usd, factor = 1 } = {}) => ({
  max,
  stopNextNew: cfg.saturate.stopNextNew,
  stopUnseenPerKloc: cfg.saturate.stopUnseenPerKloc,
  stopUsdPerDefect: perDefect ?? cfg.saturate.stopUsdPerDefect,
  usd,
  factor,
});

/**
 * Why saturation should stop, given the combined estimate `stats`, the rule (`stopRuleOf`), the next defect's `price`
 * (`nextPriceOf`), `spentUsd`, what this command has spent, and `lines`, the area's lines; null to go on. Unseen
 * defects are held to `stopUnseenPerKloc` per thousand lines, or under one where the lines are not known.
 */
export const stopReason = (stats, { max, stopNextNew, stopUnseenPerKloc, stopUsdPerDefect, usd }, { price, spentUsd, lines } = {}) => {
  if (stats.m >= max) return `reached the limit of ${max} occasions`;
  if (stats.f0 !== undefined && lines && stopUnseenPerKloc !== undefined) {
    const density = (stats.f0 * 1000) / lines;
    if (density < stopUnseenPerKloc) return `fewer than ${stopUnseenPerKloc} ${stopUnseenPerKloc === 1 ? 'defect' : 'defects'} per thousand lines estimated unseen (${density.toFixed(2)})`;
  } else if (stats.f0 !== undefined && stats.f0 < 1) return `fewer than one defect estimated unseen (${stats.f0.toFixed(2)})`;
  if (stats.nextNew !== undefined && stats.nextNew < stopNextNew) return `the next occasion's chance of a new finding is under ${Math.round(stopNextNew * 100)}% (${(stats.nextNew * 100).toFixed(1)}%)`;
  if (stopUsdPerDefect !== undefined && price?.usd !== undefined && price.usd > stopUsdPerDefect) {
    return `the next defect would cost about $${price.usd.toFixed(2)}, over the $${stopUsdPerDefect.toFixed(2)} limit`;
  }
  if (usd !== undefined && spentUsd !== undefined && spentUsd + (price?.passUsd ?? 0) > usd) {
    return `another pass would take spending past the $${usd.toFixed(2)} limit ($${spentUsd.toFixed(2)} spent)`;
  }
  return null;
};

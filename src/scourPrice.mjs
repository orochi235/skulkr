/**
 * What the next defect a scour finds should cost, from the ledgers in the state directory: README "Scour", "The price
 * of the next defect".
 */
import { existsSync, readdirSync } from 'node:fs';
import { ledgerOf } from './ledger.mjs';
import { partitionAt } from './partition.mjs';
import { chao2, stopRuleOf, yieldRows } from './saturation.mjs';
import { perKloc } from './scourLines.mjs';
import { scourStateDirOf } from './scourPaths.mjs';

/** Passes the pass cost averages over, and the passes a ledger's opening price is taken from. */
const WINDOW = 5;
/** Passes measured before a project's own calibration replaces 1. */
const CALIBRATE_FROM = 20;

const inOrder = (ledger) => [...ledger.occasions].sort((a, b) => a.n - b.n);
const newAt = (ledger, n) => ledger.defects.filter((d) => d.firstOccasion === n).length;
const costOf = (occasions) => occasions.reduce((sum, o) => sum + (o.costUsd ?? 0), 0);

/** Chao2's expected new defects on the next pass: the chance a finding is new, times the sightings a pass makes. */
const expectedNewOf = (stats) => (stats.nextNew === undefined ? undefined : (stats.nextNew * stats.U) / stats.m);

/**
 * How many new defects a pass finds for each one Chao2 expected, over every pass of `ledgers` from the fourth on:
 * `{ factor, passes }`, the factor 1 until `CALIBRATE_FROM` passes give one.
 */
export const calibrationOf = (ledgers) => {
  let expected = 0;
  let found = 0;
  let passes = 0;
  for (const ledger of ledgers) {
    const occasions = inOrder(ledger);
    for (let k = 3; k < occasions.length; k++) {
      const e = expectedNewOf(chao2(occasions.slice(0, k), ledger.defects));
      if (e === undefined) continue;
      expected += e;
      found += newAt(ledger, occasions[k].n);
      passes += 1;
    }
  }
  return { factor: passes >= CALIBRATE_FROM && expected > 0 ? found / expected : 1, passes };
};

/** What a new defect cost over the first passes of every ledger that has had them, pooled; `fallback` with none. */
export const openingPriceOf = (ledgers, fallback) => {
  let spent = 0;
  let found = 0;
  for (const ledger of ledgers) {
    const first = inOrder(ledger).slice(0, WINDOW);
    if (first.length < WINDOW) continue;
    spent += costOf(first);
    found += first.reduce((sum, o) => sum + newAt(ledger, o.n), 0);
  }
  return found > 0 ? spent / found : fallback;
};

/** The ledgers in `cfg`'s state directory, set-aside ones included. */
export const stateLedgersOf = (cfg) => {
  const dir = scourStateDirOf(cfg);
  return existsSync(dir) ? readdirSync(dir).flatMap((id) => ledgerOf(cfg, id) ?? []) : [];
};

/** The pricing every price in a command goes by: the calibration `factor` and `openingUsd`, a fresh area's price. */
export const pricingOf = (cfg, ledgers = stateLedgersOf(cfg)) => ({
  factor: calibrationOf(ledgers).factor,
  openingUsd: openingPriceOf(ledgers, cfg.saturate.openingUsdPerDefect),
});

/**
 * A per-defect limit as the config or `--per-defect` gives it: dollars (`2.5`, `'$2.5'`) as `{ usd }`, or a multiple
 * of the going rate (`{ times: 4 }`, `'4x'`) as `{ times }`. Throws on anything else.
 */
export const limitSpecOf = (given) => {
  const times = typeof given === 'object' && given !== null ? given.times : /^\s*(\d+(?:\.\d+)?)\s*[x×]\s*$/i.exec(String(given))?.[1];
  if (times !== undefined) {
    if (!(Number(times) > 0)) throw new Error(`a per-defect limit's multiple must be over 0, not ${times}`);
    return { times: Number(times) };
  }
  const usd = Number(String(given).replace(/^\s*\$/, ''));
  if (!(usd > 0)) throw new Error(`a per-defect limit is dollars (2.5) or a multiple of the going rate (4x), not ${given}`);
  return { usd };
};

/**
 * The going rate: the cheapest next defect in the project, among its areas' own ledgers with two passes or more and,
 * while any area of the partition under `root` has fewer, the opening price (with no `root`, assumed so).
 */
export const goingRateOf = (cfg, root, { factor, openingUsd }) => {
  const dir = scourStateDirOf(cfg);
  const deep = (existsSync(dir) ? readdirSync(dir) : []).flatMap((id) => {
    const ledger = ledgerOf(cfg, id);
    return ledger && ledger.area === id && ledger.occasions.length >= 2 ? [ledger] : [];
  });
  let fresh = true;
  if (root) {
    try {
      const delved = new Set(deep.map((l) => l.area));
      fresh = partitionAt(cfg, root, cfg.git.main).some((a) => !delved.has(a.id));
    } catch { /* no partition to read: assumed fresh */ }
  }
  const prices = deep.map((l) => nextPriceOf(l, factor).usd).filter((p) => p !== undefined && Number.isFinite(p));
  return Math.min(...prices, ...(fresh ? [openingUsd] : []), Infinity);
};

/**
 * The stop rule for a scour command's flags (`max`, `perDefect`, `usd`), priced by `cfg`'s ledgers; `root` is the
 * project, whose partition says whether fresh areas remain. Its `limit` says how the per-defect limit was set:
 * `{ usd }`, or `{ usd, times, goingUsd }` for a multiple of the going rate.
 * @param {any} cfg @param {string | undefined} root
 * @param {{ max?: number, perDefect?: string | number | { times: number }, usd?: number }} [flags] @param {any[]} [ledgers]
 */
export const scourRuleOf = (cfg, root, { max = cfg.saturate.max, perDefect, usd } = {}, ledgers = undefined) => {
  const pricing = pricingOf(cfg, ledgers);
  const spec = limitSpecOf(perDefect ?? cfg.saturate.stopUsdPerDefect);
  const limit = spec.times === undefined ? spec : (() => {
    const goingUsd = goingRateOf(cfg, root, pricing);
    return { usd: spec.times * goingUsd, times: spec.times, goingUsd };
  })();
  return { ...stopRuleOf(cfg, max, { perDefect: limit.usd, usd, factor: pricing.factor }), limit };
};


/**
 * The price of `ledger`'s next defect: `usd`, the average cost of its last five passes over the new defects its next
 * pass should find (`expectedNew`, Chao2's expectation times `factor`), and `passUsd`, that average. `usd` is
 * undefined under two passes and Infinity when no new defect is expected.
 */
export const nextPriceOf = (ledger, factor = 1) => {
  const occasions = inOrder(ledger);
  const last = occasions.slice(-WINDOW);
  const passUsd = last.length ? costOf(last) / last.length : undefined;
  const e = expectedNewOf(chao2(occasions, ledger.defects));
  if (e === undefined || passUsd === undefined) return { usd: undefined, expectedNew: undefined, passUsd };
  const expectedNew = e * factor;
  return { usd: expectedNew > 0 ? passUsd / expectedNew : Infinity, expectedNew, passUsd };
};

const orNull = (n) => (n === undefined || !Number.isFinite(n) ? null : n);

/**
 * The ledger's yield by pass, for the dashboard: each pass's findings, new defects and cost, and the estimates, spend,
 * next defect's price and per-kloc figures (from `ledger.lines`) as they stood after it; null where one has no value.
 */
export const passRowsOf = (ledger, factor = 1) => yieldRows(ledger).map((r) => ({
  n: r.n,
  source: r.source,
  findings: r.findings,
  new: r.new,
  distinct: r.stats.S,
  unseen: orNull(r.stats.f0),
  nextNew: orNull(r.stats.nextNew),
  costUsd: r.costUsd ?? 0,
  spentUsd: r.spentUsd,
  usdPerDefect: orNull(r.usdPerDefect),
  nextUsd: orNull(nextPriceOf({ ...ledger, occasions: ledger.occasions.filter((o) => o.n <= r.n) }, factor).usd),
  defectsPerKloc: perKloc(r.stats.S, ledger.lines),
  unseenPerKloc: perKloc(r.stats.f0, ledger.lines),
  costPerKloc: perKloc(r.costUsd ?? 0, ledger.lines),
  at: r.at ?? null,
}));
